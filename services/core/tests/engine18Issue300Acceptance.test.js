import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,readdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {randomBytes,createHash} from 'node:crypto';
import {Engine18RawRecorder,replayRaw} from '../logic/engine18/gate1RawRecorder.js';
import {Engine18BufferedRecorder} from '../logic/engine18/engine18BufferedRecorder.js';
import {Engine18ContinuousBackup} from '../logic/engine18/engine18ContinuousBackup.js';
import {Engine18S3ArchiveCoordinator} from '../logic/engine18/engine18Phase5S3Coordinator.js';
import {Engine18S3PrivateStore,canonicalQueryRFC3986,rfc3986Encode} from '../logic/engine18/engine18S3PrivateStore.js';
import {createEngine18ReceiptClock} from '../logic/engine18/engine18ReceiptClock.js';

async function temp(fn){
 const root=mkdtempSync(join(tmpdir(),'engine18-final-'));
 try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}
}
function clock(){
 let t=BigInt(Date.parse('2026-11-10T21:58:59Z'))*1000000n,n=0n;
 return {wallNs:()=>String(t),monoNs:()=>String(++n),set:(iso)=>{t=BigInt(Date.parse(iso))*1000000n;}};
}
function mockS3({getDelayMs=0}={}){
 const objects=new Map(),calls=[];
 const fetchImpl=async(url,req)=>{
  calls.push({method:req.method,path:url.pathname,query:url.search,headers:req.headers});
  const key=url.pathname.replace(/^\/private-test\//,'');
  if(req.method==='PUT'){
   if(objects.has(key))return new Response(null,{status:412});
   const parts=[];for await(const part of req.body)parts.push(Buffer.from(part));
   objects.set(key,Buffer.concat(parts));return new Response(null,{status:200});
  }
  if(req.method==='GET'&&url.searchParams.get('list-type')==='2'){
   const prefix=url.searchParams.get('prefix')||'';
   const keys=[...objects.keys()].filter(k=>k.startsWith(prefix)).sort();
   const body='<ListBucketResult><IsTruncated>false</IsTruncated>'+
    keys.map(k=>'<Contents><Key>'+k+'</Key></Contents>').join('')+'</ListBucketResult>';
   return new Response(body,{status:200});
  }
  if(req.method==='GET'&&objects.has(key)){
   if(getDelayMs)await new Promise(r=>setTimeout(r,getDelayMs));
   return new Response(objects.get(key),{status:200});
  }
  return new Response(null,{status:404});
 };
 return {objects,calls,fetchImpl};
}
function setup(root,opts={}){
 const mock=mockS3(opts),c=clock();
 const store=new Engine18S3PrivateStore({endpoint:'https://mock.s3.example',
  bucket:'private-test',region:'auto',accessKeyId:'TESTKEY',secretAccessKey:'TESTSECRETKEY',
  keyId:'synthetic-key-01',encryptionKey:randomBytes(32),fetchImpl:mock.fetchImpl,
  stagingRoot:root});
 return {mock,c,store,coordinator:new Engine18S3ArchiveCoordinator({root,store})};
}

test('Issue300 scheduler runs S3 coordinator automatically across hours without blocking active open',()=>temp(async root=>{
 const {mock,c,coordinator}=setup(root);
 const w=new Engine18BufferedRecorder({root,clock:c,batchSize:16,flushDelayMs:0});
 const scheduled=new Engine18ContinuousBackup({backup:coordinator,intervalMs:12});
 await w.offer({raw:'hour-1 raw',msgClass:'market',at:new Date('2026-11-10T21:59:50Z')});
 c.set('2026-11-10T22:00:01Z');
 await w.offer({raw:'hour-2 active',msgClass:'market',at:new Date('2026-11-10T22:00:01Z')});
 scheduled.start();
 let backedUp=false;
 for(let i=0;i<100;i++){
  await new Promise(r=>setTimeout(r,15));
  if((await coordinator.inventory()).entries.length===1){backedUp=true;break;}
 }
 assert.ok(backedUp,'scheduled upload of closed hour');
 assert.ok(readdirSync(root,{recursive:true}).some(x=>x.endsWith('.jsonl.open')));
 assert.ok(w.health().recordingActive);
 await w.offer({raw:'hour-2 after backup',msgClass:'market',at:new Date('2026-11-10T22:00:03Z')});
 c.set('2026-11-10T22:00:05Z');
 await w.close();await scheduled.stop();await scheduled.tick();
 const head=await coordinator.inventory();
 assert.equal(head.entries.length,2);
 assert.equal(head.lastSeq,w.writer.seq);
 assert.equal(scheduled.health().failures,0);
 const restoreRoot=root+'-restored';
 try{
  const result=await coordinator.restore({destination:restoreRoot,expectedLastSeq:head.lastSeq});
  assert.equal(result.lastSeq,w.writer.seq);
  assert.deepEqual(replayRaw(restoreRoot),replayRaw(root));
 }finally{rmSync(restoreRoot,{recursive:true,force:true});}
 assert.ok(mock.objects.size>=6);
}));

test('Issue300 archive rename-to-manifest race skips recent incomplete gzip and retries post-recovery',()=>temp(async root=>{
 const {c,coordinator}=setup(root);
 const fault=stage=>{if(stage==='AFTER_ARCHIVE_RENAME_BEFORE_MANIFEST')throw Error('SIMULATED_RENAME_WINDOW');};
 const first=await Engine18RawRecorder.openBounded({root,clock:c,testFault:fault});
 first.append({raw:'intact source',msgClass:'market'});
 await assert.rejects(first.rotateStreaming(),/SIMULATED_RENAME_WINDOW/);
 first.releaseLock();
 const backup=new Engine18ContinuousBackup({backup:coordinator});
 const before=await backup.tick();
 assert.equal(before.pendingRotationArchives,1);
 assert.equal(before.added,0);
 assert.equal(backup.health().failures,0);
 const revived=await Engine18RawRecorder.openBounded({root,clock:c});
 const after=await backup.tick();
 assert.equal(after.pendingRotationArchives,0);assert.ok(after.added>=1);
 revived.close();await backup.stop();
 assert.deepEqual(replayRaw(root).filter(x=>x.msgClass==='market').map(x=>x.raw),['intact source']);
}));
test('Issue300 missing original for unmanifested gzip and corrupt acknowledged gzip fail closed',()=>temp(async root=>{
 const {c,coordinator}=setup(root);
 const first=await Engine18RawRecorder.openBounded({root,clock:c,testFault:stage=>{
  if(stage==='AFTER_ARCHIVE_RENAME_BEFORE_MANIFEST')throw Error('RENAME_FAULT');
 }});
 first.append({raw:'intact',msgClass:'market'});
 await assert.rejects(first.rotateStreaming(),/RENAME_FAULT/);first.releaseLock();
 const archived=readdirSync(root,{recursive:true}).find(x=>x.endsWith('.jsonl.gz'));
 const full=join(root,archived);
 const source=full.replace(/\.jsonl\.gz$/,'.jsonl.open');
 unlinkSync(source);
 await assert.rejects(coordinator.syncClosed(),/private sealed-hour backup failed/);
 assert.equal(coordinator.health().failures,1);
}));
test('Issue300 RFC3986 query never signs plus for spaces or leaves star unescaped',()=>{
 const url=new URL('https://mock.s3.example/private-test?prefix=hour+one&marker=x*y&z=~&bang=%21&prefix=hour%20two');
 const value=canonicalQueryRFC3986(url);
 assert.equal(value,'bang=%21&marker=x%2Ay&prefix=hour%20one&prefix=hour%20two&z=~');
 assert.equal(rfc3986Encode("! ' ( ) * ~"),'%21%20%27%20%28%20%29%20%2A%20~');
});
test('Issue300 raw host wall observation remains independent from sub-ms estimated wall',()=>{
 let mono=10000000000n,wall=1794350000000;
 const clock=createEngine18ReceiptClock({wallMs:()=>wall,monotonicNs:()=>mono});
 const a=clock.capture();mono+=345678n;wall+=1;
 const b=clock.capture();
 assert.equal(BigInt(b.receivedWallNs)-BigInt(a.receivedWallNs),345678n);
 assert.equal(BigInt(b.rawHostWallObservedNs)-BigInt(a.rawHostWallObservedNs),1000000n);
 assert.equal(b.clockQuality,'UNVERIFIED');
});
test('Issue300 S3 authentication failure leaves no partial restore file',()=>temp(async root=>{
 const {mock,store}=setup(root),body=Buffer.from('signed archive with AES-256-GCM');
 const source=join(root,'source.gz');writeFileSync(source,body);
 const sha=createHash('sha256').update(body).digest('hex');
 const receipt=await store.uploadClosed({path:source,key:'sealed/test.gz',plaintextSha256:sha,expectedSize:body.length});
 const obj=mock.objects.get('sealed/test.gz');
 const corrupt=Buffer.from(obj);corrupt[22]^=1;mock.objects.set('sealed/test.gz',corrupt);
 const expected={...receipt,cipherSha256:createHash('sha256').update(corrupt).digest('hex')};
 const out=join(root,'restored');
 await assert.rejects(store.restoreClosed({key:receipt.key,destination:out,expected}),/authentication|checksum/);
 assert.equal(existsSync(out+'.restore.tmp'),false);
}));
