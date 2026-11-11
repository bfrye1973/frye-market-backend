import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Engine18BufferedRecorder} from '../logic/engine18/engine18BufferedRecorder.js';
import {replayRaw} from '../logic/engine18/gate1RawRecorder.js';
import {Engine18SyntheticArchiveBackup,MockPrivateEncryptedStore} from '../logic/engine18/engine18Phase4Backup.js';
import {Engine18ContinuousBackup} from '../logic/engine18/engine18ContinuousBackup.js';
import {Engine18SyntheticWorkerBridge} from '../logic/engine18/engine18Phase4WorkerBridge.js';
import {createEngine18ReceiptClock} from '../logic/engine18/engine18ReceiptClock.js';
import {Engine18S3PrivateStore} from '../logic/engine18/engine18S3PrivateStore.js';
import {Engine18S3ArchiveCoordinator} from '../logic/engine18/engine18Phase5S3Coordinator.js';

const withRoot=async fn=>{
 const root=mkdtempSync(join(tmpdir(),'e18-phase5-'));
 try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}
};
const fakeClock=()=>({wallNs:()=>String(BigInt(Date.parse('2026-11-10T21:10:00Z'))*1000000n),
 monoNs:(()=>{let i=0n;return()=>String(++i)})()});
const writer=root=>new Engine18BufferedRecorder({root,clock:fakeClock(),batchSize:16,flushDelayMs:0});
const files=root=>readdirSync(root,{recursive:true}).map(x=>join(root,x));

test('closed hours are backed up while next .jsonl.open remains active and keeps growing',()=>withRoot(async root=>{
 const w=writer(root),store=new MockPrivateEncryptedStore({key:randomBytes(32)});
 const backup=new Engine18SyntheticArchiveBackup({root,store,maxRetries:4});
 const scheduled=new Engine18ContinuousBackup({backup,intervalMs:100});
 await w.offer({raw:'hour-1',msgClass:'market',at:new Date('2026-11-10T21:59:58Z')});
 await w.offer({raw:'hour-2-early',msgClass:'market',at:new Date('2026-11-10T22:00:00Z')});
 assert.ok(files(root).some(x=>x.endsWith('.jsonl.open')));
 const [result,liveAck]=await Promise.all([
  scheduled.tick(),
  w.offer({raw:'hour-2-during-backup',msgClass:'market',at:new Date('2026-11-10T22:00:01Z')})
 ]);
 assert.ok(liveAck.localSeq>=4);
 assert.equal(result.remoteArchiveCount,1);
 assert.ok(files(root).some(x=>x.endsWith('.jsonl.open')));
 const archived=store.listInventory()[0];
 assert.equal(archived.lastSeq,2);
 const before=await store.getBytes(archived.objectId);
 await w.offer({raw:'hour-2-more',msgClass:'market',at:new Date('2026-11-10T22:00:02Z')});
 assert.deepEqual(await store.getBytes(archived.objectId),before);
 await w.close();
 await scheduled.tick();
 assert.equal(store.listInventory().at(-1).lastSeq,w.writer.seq);
 assert.equal(scheduled.health().failures,0);
 await scheduled.stop();
}));

test('backup remote fault does not block current-hour intake, reports lag/failure, retries sealed files',()=>withRoot(async root=>{
 const w=writer(root),store=new MockPrivateEncryptedStore({key:randomBytes(32)});
 const backup=new Engine18SyntheticArchiveBackup({root,store,maxRetries:2});
 await w.offer({raw:'old',msgClass:'market',at:new Date('2026-11-10T21:59:00Z')});
 await w.offer({raw:'new',msgClass:'market',at:new Date('2026-11-10T22:00:01Z')});
 store.failNext(2);let signals=0;
 const background=new Engine18ContinuousBackup({backup,onFailure:()=>signals++});
 await assert.rejects(background.tick(),/closed-hour backup failed/);
 assert.equal(background.health().failures,1);assert.equal(signals,1);
 assert.equal(background.health().backupLagMs,null);
 const newAck=await w.offer({raw:'during-network-outage',msgClass:'market',at:new Date('2026-11-10T22:00:02Z')});
 assert.ok(newAck.localSeq>0);
 const result=await background.tick();assert.equal(result.remoteArchiveCount,1);
 assert.ok(background.health().backupLagMs>=0);
 await w.close();await background.stop();
}));

test('high-resolution receipt anchor resolves sub-ms deltas and does not claim verified NTP',()=>{
 let mono=50000000000n;
 const c=createEngine18ReceiptClock({wallMs:()=>1794350000000,monotonicNs:()=>mono,reanchorMs:1000});
 const a=c.capture();mono+=123456n;const b=c.capture();
 assert.equal(BigInt(b.receivedWallNs)-BigInt(a.receivedWallNs),123456n);
 assert.equal(BigInt(b.receivedMonoNs)-BigInt(a.receivedMonoNs),123456n);
 assert.equal(a.receiptPrecision,'SUBMILLISECOND_ESTIMATE');
 assert.equal(b.clockQuality,'UNVERIFIED');
 assert.throws(()=>{mono=1n;c.capture();},/regression/);
});

test('Node child.send false is queued pressure, not automatically lost, when callback eventually ACKs',()=>withRoot(async root=>{
 const b=new Engine18SyntheticWorkerBridge({root,maxInflight:64});
 await b.start();
 const send=b.child.send.bind(b.child);
 b.child.send=(message,...rest)=>{
  const ok=send(message,...rest);
  return message?.type==='FRAME'?false:ok;
 };
 const seq=await b.submit('QUEUED_BUT_PERSISTED',{msgClass:'market'});
 assert.equal(seq,2);
 assert.equal(b.health().ipcQueuedSignals,1);
 assert.equal(b.health().acked,1);
 await b.close();
 assert.deepEqual(replayRaw(root).filter(x=>x.msgClass==='market').map(x=>x.raw),['QUEUED_BUT_PERSISTED']);
}));

test('worker whose parent dies exits instead of collecting orphaned frames; restart emits GAP',()=>withRoot(async root=>{
 const fixture=new URL('./fixtures/engine18Phase5Parent.js',import.meta.url);
 const parent=spawn(process.execPath,[fixture.pathname,root],{stdio:['ignore','pipe','pipe']});
 let pid=null,output='',stderr='';
 parent.stderr.on('data',b=>{stderr+=b.toString();});
 await new Promise((resolve,reject)=>{
  parent.stdout.on('data',b=>{output+=b.toString();const m=output.match(/PID (\d+)/);if(m){pid=+m[1];resolve();}});
  parent.on('error',reject);parent.on('exit',(code)=>reject(Error('parent exited before READY, exit '+code+', stderr '+stderr.slice(0,300))));
 });
 parent.kill('SIGKILL');await once(parent,'exit');
 // Worker must die on IPC disconnect; do not leave an orphan.
 let gone=false;
 for(let n=0;n<40;n++){
  await new Promise(r=>setTimeout(r,30));
  try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){gone=true;break;}}
 }
 assert.ok(gone,'orphan worker must terminate');
 const w=await Engine18BufferedRecorder.openBounded({root,clock:fakeClock(),batchSize:16,flushDelayMs:0});
 await w.close();
 const e=replayRaw(root);
 assert.deepEqual(e.filter(x=>x.msgClass==='market').map(x=>x.raw),['BEFORE_PARENT_DEATH']);
 assert.equal(e.filter(x=>x.statusCode==='GAP').length,1);
}));

test('S3-compatible mock SigV4 encrypted immutable object round trip with key ID and no exposed plaintext',()=>withRoot(async root=>{
 const body=Buffer.from('Synthetic ES message with unchanged 7500.2500 and binary \0\xff');
 const archive=join(root,'archive.gz');writeFileSync(archive,body);
 const sha=createHash('sha256').update(body).digest('hex');
 const objects=new Map();let auth=null;
 const fetchImpl=async(url,opts)=>{
  auth=opts.headers.authorization;
  const key=url.pathname;
  if(opts.method==='PUT'){
   assert.equal(opts.headers['if-none-match'],'*');
   if(objects.has(key))return new Response(null,{status:412});
   const chunks=[];for await(const c of opts.body)chunks.push(Buffer.from(c));
   objects.set(key,Buffer.concat(chunks));return new Response(null,{status:200});
  }
  if(opts.method==='GET'){
   if(!objects.has(key))return new Response(null,{status:404});
   return new Response(objects.get(key),{status:200});
  }
  return new Response(null,{status:500});
 };
 const s3=new Engine18S3PrivateStore({endpoint:'https://test.r2.example',bucket:'private-test',
  region:'auto',accessKeyId:'TESTKEY',secretAccessKey:'FAKE_TEST_SECRET',keyId:'key-v1',
  encryptionKey:randomBytes(32),fetchImpl});
 const m=await s3.uploadClosed({path:archive,key:'sealed/2026-11-10-21.jsonl.gz',
  plaintextSha256:sha,expectedSize:body.length});
 assert.equal(m.keyId,'key-v1');assert.ok(auth.startsWith('AWS4-HMAC-SHA256'));
 assert.equal(objects.size,1);
 assert.ok(![...objects.values()][0].includes(body));
 const result=await s3.restoreClosed({key:m.key,destination:join(root,'restored'),expected:m});
 assert.equal(result.sha256,sha);
 assert.deepEqual(readFileSync(result.tempPath),body);
 const retried=await s3.uploadClosed({path:archive,key:m.key,
  plaintextSha256:sha,expectedSize:body.length});
 assert.deepEqual(retried,m,'duplicate source with new encryption nonce must re-use immutable remote ciphertext');
 const other=join(root,'conflict.gz'),otherBytes=Buffer.from('different archive content');
 writeFileSync(other,otherBytes);
 await assert.rejects(s3.uploadClosed({path:other,key:m.key,
  plaintextSha256:createHash('sha256').update(otherBytes).digest('hex'),expectedSize:otherBytes.length}),/conflicts/);
 await assert.rejects(s3.restoreClosed({key:m.key,destination:join(root,'wrong'),
  expected:{...m,keyId:'other-key'}}),/versioned restore key/);
}));

test('isolated existing recorder phase2/3/4 behavior remains synthetic only',()=>withRoot(async root=>{
 const w=writer(root);await w.offer({raw:'synthetic-only',msgClass:'market'});await w.close();
 assert.ok(files(root).some(x=>x.endsWith('.manifest.json')));
}));

test('backup uploaded but ACK lost is idempotently verified without overwriting',()=>withRoot(async root=>{
 const w=writer(root);await w.offer({raw:'archived-value',msgClass:'market'});await w.close();
 const remote=new MockPrivateEncryptedStore({key:randomBytes(32)});
 remote.loseAckNext(1);
 const backup=new Engine18SyntheticArchiveBackup({root,store:remote,maxRetries:3});
 const a=await backup.backupClosed();
 assert.equal(a.remoteArchiveCount,1);
 const object=remote.listInventory()[0];
 const content=await remote.getBytes(object.objectId);
 await backup.backupClosed();
 assert.deepEqual(await remote.getBytes(object.objectId),content);
 assert.equal(remote.objects.size,2);
}));

test('isolated slow-storage worker does not block parent receipt callbacks and preserves every ACK',()=>withRoot(async root=>{
 const bridge=new Engine18SyntheticWorkerBridge({root,maxInflight:128,syntheticSlowDiskMs:30});
 await bridge.start();
 const begin=performance.now();
 const promises=[];
 for(let i=0;i<96;i++)promises.push(bridge.submit('SLOW_FSYNC_'+i,{msgClass:'market'}));
 const submitElapsedMs=performance.now()-begin;
 const ack=await Promise.all(promises);
 assert.equal(ack.length,96);
 assert.ok(submitElapsedMs<1000,'parent must not wait for simulated fsync before submitting');
 const h=bridge.health();
 assert.equal(h.acked,96);
 assert.ok(h.callbackUsP99<100000,'synthetic callback cannot block on disk');
 await bridge.close();
 assert.deepEqual(replayRaw(root).filter(x=>x.msgClass==='market').map(x=>x.raw),
  Array.from({length:96},(_,i)=>'SLOW_FSYNC_'+i));
}));

test('sustained 24000 mixed synthetic ES depth/quote/trade frames across three hours with concurrent backup',()=>withRoot(async root=>{
 const w=new Engine18BufferedRecorder({root,clock:fakeClock(),batchSize:64,maxQueued:256,flushDelayMs:0});
 const remote=new MockPrivateEncryptedStore({key:randomBytes(32)});
 const backup=new Engine18SyntheticArchiveBackup({root,store:remote,maxRetries:3});
 const background=new Engine18ContinuousBackup({backup});
 const total=24000,begin=performance.now();let accepted=0;
 for(let group=0;group<total/64;group++){
  const promises=[];
  for(let k=0;k<64;k++){
   const i=group*64+k;
   const hour=Math.floor(i/8000);
   const at=new Date(Date.UTC(2026,10,10,21+hour,0,0));
   const raw=i%3===0?
    '{"d":[{"s":"XCME:ES.Z26","b":[{"p":7500.2500,"sz":0,"l":0}],"a":[]}],"i":'+i+'}':
    i%3===1?'{"q":{"symbol":"XCME:ES.Z26","seq":'+i+'}}':
    '{"tr":[{"s":"XCME:ES.Z26","p":7500.2500,"sz":1}],"i":'+i+'}';
   promises.push(w.offer({raw,at,msgClass:'market'}));
  }
  const a=await Promise.all(promises);accepted+=a.length;
  if(group===125||group===250)await background.tick();
 }
 await w.close();
 await background.tick();
 const elapsed=performance.now()-begin;
 assert.equal(accepted,total);
 const originals=replayRaw(root).filter(e=>e.msgClass==='market');
 assert.equal(originals.length,total);
 assert.deepEqual(originals.map(e=>e.localSeq),Array.from({length:total},(_,i)=>i+2));
 assert.equal(backup.store.listInventory().at(-1).lastSeq,w.writer.seq);
 const recoveredRoot=root+'-restored';
 try{
  const b=await backup.restore({destination:recoveredRoot});
  assert.equal(b.lastSeq,w.writer.seq);
  const a=createHash('sha256').update(JSON.stringify(replayRaw(root))).digest('hex');
  const z=createHash('sha256').update(JSON.stringify(replayRaw(recoveredRoot))).digest('hex');
  assert.equal(a,z);
 }finally{rmSync(recoveredRoot,{recursive:true,force:true});}
 const mem=process.memoryUsage();
 console.log(JSON.stringify({phase5SustainedSynthetic:{
  frames:total,elapsedMs:+elapsed.toFixed(1),
  framesPerSecond:+(total*1000/elapsed).toFixed(0),
  rssMiB:+(mem.rss/1048576).toFixed(1),
  completedArchives:remote.listInventory().length,backupFailures:background.health().failures
 }}));
 await background.stop();
}));

test('S3 retry verifies remote exact ciphertext after PUT succeeds but ACK is lost',()=>withRoot(async root=>{
 const body=Buffer.from('closed gzip fixture original bytes');
 const path=join(root,'sealed.gz');writeFileSync(path,body);
 const plain=createHash('sha256').update(body).digest('hex');
 const objects=new Map();let first=true;
 const fetchImpl=async(url,init)=>{
  const key=url.pathname;
  if(init.method==='PUT'){
   if(objects.has(key))return new Response(null,{status:412});
   const chunks=[];for await(const c of init.body)chunks.push(Buffer.from(c));
   objects.set(key,Buffer.concat(chunks));
   if(first){first=false;return new Response(null,{status:503});}
   return new Response(null,{status:200});
  }
  if(init.method==='GET')return objects.has(key)?
   new Response(objects.get(key),{status:200}):new Response(null,{status:404});
  return new Response(null,{status:400});
 };
 const store=new Engine18S3PrivateStore({endpoint:'https://mock-private.r2.example',bucket:'private',
  accessKeyId:'mock-key',secretAccessKey:'mock-secret-key',keyId:'version-2',
  encryptionKey:randomBytes(32),fetchImpl,maxRetries:3});
 const record=await store.uploadClosed({path,key:'sealed/test.gz',plaintextSha256:plain,expectedSize:body.length});
 assert.equal(objects.size,1);
 assert.equal(record.keyId,'version-2');
 const restored=await store.restoreClosed({key:record.key,destination:join(root,'output'),expected:record});
 assert.deepEqual(readFileSync(restored.tempPath),body);
}));

test('mock S3 lifecycle: independent encrypted inventory, current-hour concurrent backup, pinned complete restoration',()=>withRoot(async root=>{
 const objectMap=new Map();
 const fakeS3=async(url,init)=>{
  const key=url.pathname.replace(/^\/private-recordings\//,'');
  if(init.method==='PUT'){
   if(objectMap.has(key))return new Response(null,{status:412});
   const chunks=[];for await(const c of init.body)chunks.push(Buffer.from(c));
   objectMap.set(key,Buffer.concat(chunks));return new Response(null,{status:200});
  }
  if(init.method==='GET'&&url.searchParams.has('list-type')){
   const prefix=url.searchParams.get('prefix')||'';
   const keys=[...objectMap.keys()].filter(k=>k.startsWith(prefix)).sort();
   const xml='<ListBucketResult><IsTruncated>false</IsTruncated>'+
    keys.map(k=>'<Contents><Key>'+k+'</Key></Contents>').join('')+'</ListBucketResult>';
   return new Response(xml,{status:200,headers:{'content-type':'application/xml'}});
  }
  if(init.method==='GET')return objectMap.has(key)?
   new Response(objectMap.get(key),{status:200}):new Response(null,{status:404});
  return new Response(null,{status:405});
 };
 const s3=new Engine18S3PrivateStore({endpoint:'https://mock.r2.example',bucket:'private-recordings',
  accessKeyId:'synthetic-access',secretAccessKey:'synthetic-secret-for-tests',
  keyId:'synthetic-key-v1',encryptionKey:randomBytes(32),fetchImpl:fakeS3});
 const coordinator=new Engine18S3ArchiveCoordinator({root,store:s3});
 const w=writer(root);
 await w.offer({raw:'{"d":{"sz":0,"l":1},"original":7500.2500}',msgClass:'market',at:new Date('2026-11-10T21:59:50Z')});
 await w.offer({raw:'{"q":{"seq":2}}',msgClass:'market',at:new Date('2026-11-10T22:00:00Z')});
 assert.ok(files(root).some(x=>x.endsWith('.jsonl.open')));
 const [backup,receipt]=await Promise.all([coordinator.syncClosed(),
  w.offer({raw:'while-S3-remote-backup-is-active',msgClass:'market',at:new Date('2026-11-10T22:00:01Z')})]);
 assert.equal(backup.added,1);assert.ok(receipt.localSeq>=4);
 assert.equal((await coordinator.inventory()).entries.length,1);
 assert.ok(files(root).some(x=>x.endsWith('.jsonl.open')));
 await w.close();
 const completed=await coordinator.syncClosed();
 assert.equal(completed.added,1);
 const knownLast=w.writer.seq;
 assert.equal((await coordinator.inventory({expectedLastSeq:knownLast})).entries.length,2);
 const restoreRoot=root+'-from-r2';
 try{
  const restored=await coordinator.restore({destination:restoreRoot,expectedLastSeq:knownLast});
  assert.equal(restored.lastSeq,knownLast);
  const origHash=createHash('sha256').update(JSON.stringify(replayRaw(root))).digest('hex');
  const cloneHash=createHash('sha256').update(JSON.stringify(replayRaw(restoreRoot))).digest('hex');
  assert.equal(origHash,cloneHash);
 }finally{rmSync(restoreRoot,{recursive:true,force:true});}
 const previous=await coordinator.syncClosed();
 assert.equal(previous.added,0,'idempotent remote inventory sync');
 assert.equal(coordinator.health().failures,0);
 const lastInventoryKey=[...objectMap.keys()].filter(k=>k.startsWith('engine18/inventory/')).sort().at(-1);
 objectMap.delete(lastInventoryKey);
 await assert.rejects(coordinator.inventory({expectedLastSeq:knownLast}),/high-watermark/);
}));
