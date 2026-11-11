import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync,appendFileSync,closeSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {Engine18RawRecorder,replayRaw,deterministicReplayBytes,SCHEMA} from '../logic/engine18/gate1RawRecorder.js';

const withDir=fn=>{const root=mkdtempSync(join(tmpdir(),'e18-gate1-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const files=root=>readdirSync(root,{recursive:true}).map(x=>join(root,x));
const clock=(wall='1794350000000000000')=>({wallNs:()=>wall,monoNs:(()=>{let n=0;return ()=>String(++n)})()});
const create=root=>new Engine18RawRecorder({root,clock:clock()});
const statuses=events=>events.map(e=>e.statusCode||e.raw);
const market=events=>events.filter(e=>e.msgClass==='market'||e.msgClass==='unknown');
const roundtrip=(root,raw,rawEncoding='utf8')=>{
 const r=create(root);r.append({raw,rawEncoding,msgClass:'market'});r.close();
 return market(replayRaw(root))[0];
};

test('v2 envelope preserves exact unparsed UTF8 text including unusual number notation',()=>withDir(root=>{
 const raw=' { "p": 7560.2500, "sz": 01, "str": "\\u263A" } ';
 const e=roundtrip(root,raw);assert.equal(e.raw,raw);assert.equal(e.rawEncoding,'utf8');assert.equal(e.schemaVersion,SCHEMA);
 assert.match(e.runId,/^[a-f0-9-]{36}$/);
}));
test('binary payload preserves every byte in base64 and subsequent event order',()=>withDir(root=>{
 const r=create(root),bytes=Buffer.from([0,255,1,10,13,128,192,0,42]);
 r.append({raw:bytes,rawEncoding:'base64',msgClass:'market'});
 r.append({raw:'text',msgClass:'market'});r.close();
 const events=replayRaw(root);
 assert.deepEqual(Buffer.from(events.find(e=>e.rawEncoding==='base64').raw,'base64'),bytes);
 assert.deepEqual(market(events).map(e=>e.rawEncoding),['base64','utf8']);
 assert.deepEqual(events.map(e=>e.localSeq),[1,2,3,4]);
}));
test('reject invalid base64, encoding, and mismatched UTF8 input',()=>withDir(root=>{
 const r=create(root);
 assert.throws(()=>r.append({raw:'!',rawEncoding:'base64'}),/base64/);
 assert.throws(()=>r.append({raw:'abcd',rawEncoding:'binary'}),/rawEncoding/);
 assert.throws(()=>r.append({raw:Buffer.from('abc'),rawEncoding:'utf8'}),/utf8/);
 r.close();
}));
test('clean restart records STOP then next START with distinct run IDs and continuous seq',()=>withDir(root=>{
 const a=create(root);const firstId=a.runId;a.append({raw:'one',msgClass:'market'});a.close();
 const b=create(root);assert.notEqual(firstId,b.runId);b.append({raw:'two',msgClass:'market'});b.close();
 const e=replayRaw(root);
 assert.deepEqual(statuses(e),['RECORDER_START','one','RECORDER_STOP','RECORDER_START','two','RECORDER_STOP']);
 assert.equal(new Set(e.slice(0,3).map(x=>x.runId)).size,1);
 assert.equal(new Set(e.slice(3).map(x=>x.runId)).size,1);
 assert.deepEqual(e.map(x=>x.localSeq),[1,2,3,4,5,6]);
 assert.equal(e.filter(x=>x.statusCode==='GAP').length,0);
}));
test('unexpected writer termination records GAP before next START',()=>withDir(root=>{
 const r=create(root);r.append({raw:'before',msgClass:'market'});
 const active=files(root).find(p=>p.endsWith('.jsonl.open'));
 appendFileSync(active,'{"incomplete":');
 closeSync(r.fd);r.fd=null;r.releaseLock();
 const next=create(root);assert.equal(next.health().gaps,1);
 next.append({raw:'after',msgClass:'market'});next.close();
 assert.deepEqual(statuses(replayRaw(root)),['RECORDER_START','before','GAP','RECORDER_START','after','RECORDER_STOP']);
}));
test('crash immediately after successful hourly rotation still emits GAP',()=>withDir(root=>{
 const r=create(root);r.append({raw:'first',msgClass:'market',at:new Date('2026-11-10T21:00:00Z')});
 r.append({raw:'second',msgClass:'market',at:new Date('2026-11-10T22:00:00Z')});
 r.rotate();r.releaseLock();
 const b=create(root);b.close();
 assert.deepEqual(statuses(replayRaw(root)),['RECORDER_START','first','second','GAP','RECORDER_START','RECORDER_STOP']);
}));
test('GAP count increases for explicit GAP even after recovered prior crash',()=>withDir(root=>{
 const a=create(root);a.append({raw:'x'});a.rotate();a.releaseLock();
 const b=create(root);assert.equal(b.health().gaps,1);
 b.append({raw:'',msgClass:'control',statusCode:'GAP'});
 assert.equal(b.health().gaps,2);b.close();
 assert.equal(replayRaw(root).filter(e=>e.statusCode==='GAP').length,2);
}));
test('receipt timestamp captured before artificial disk delay and determines partition',()=>withDir(root=>{
 let t=Date.parse('2026-11-08T23:30:00Z')*1e6,mono=1;
 const injected={wallNs:()=>String(t),monoNs:()=>String(mono++)};
 const r=new Engine18RawRecorder({root,clock:injected});
 t=Date.parse('2026-11-08T23:59:59Z')*1e6;
 const receipt=r.capture({raw:'delayed',msgClass:'market'});
 const firstWall=receipt.receivedWallNs,firstMono=receipt.receivedMonoNs;
 t=Date.parse('2026-11-09T01:02:00Z')*1e6;
 r.appendReceived(receipt);r.close();
 const e=market(replayRaw(root)).find(x=>x.raw==='delayed');
 assert.equal(e.receivedWallNs,firstWall);assert.equal(e.receivedMonoNs,firstMono);
 assert.ok(BigInt(e.writtenMonoNs)>BigInt(firstMono));
 const archives=files(root).filter(x=>x.endsWith('.jsonl.gz'));
 assert.ok(archives.some(x=>x.includes('2026-11-09/2026-11-08-23')),'receipt hour and CME date used');
}));
test('monotonic timestamps are checked inside a run, not across restarts',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock:{wallNs:()=> '1000000000000000000',monoNs:(()=>{let n=900;return ()=>String(n++)})()}});
 a.append({raw:'a'});a.close();
 const b=new Engine18RawRecorder({root,clock:{wallNs:()=> '1000000000000000001',monoNs:(()=>{let n=1;return ()=>String(n++)})()}});
 b.append({raw:'b'});b.close();
 assert.deepEqual(market(replayRaw(root)).map(e=>e.raw),['a','b']);
}));
test('monotonic clock regression within single run rejected',()=>withDir(root=>{
 let m=10;const c={wallNs:()=> '1794350000000000000',monoNs:()=>String(m--)};
 assert.throws(()=>new Engine18RawRecorder({root,clock:c}),/monotonic/);
}));
test('hourly rotations produce valid SHA-256 manifests and replay stable ordering',()=>withDir(root=>{
 const a=create(root);a.append({raw:'early',at:new Date('2026-11-10T21:00:00Z')});
 a.append({raw:'late',at:new Date('2026-11-10T22:00:00Z')});a.close();
 const archive=files(root).filter(x=>x.endsWith('.jsonl.gz'));
 assert.ok(archive.length>=2);
 for(const p of archive){
  const manifest=JSON.parse(readFileSync(p+'.manifest.json','utf8'));
  assert.equal(manifest.sha256,createHash('sha256').update(readFileSync(p)).digest('hex'));
 }
 assert.deepEqual(market(replayRaw(root)).map(e=>e.raw),['early','late']);
}));
test('detect tampered archive',()=>withDir(root=>{
 const a=create(root);a.close();const p=files(root).find(x=>x.endsWith('.jsonl.gz'));
 writeFileSync(p,'corruption');assert.throws(()=>replayRaw(root),/sha256/);
}));
test('missing original manifest marks integrity UNVERIFIED, never self-certifies',()=>withDir(root=>{
 const a=create(root);a.close();const p=files(root).find(x=>x.endsWith('.manifest.json'));
 unlinkSync(p);assert.throws(()=>create(root),/UNVERIFIED/);
 assert.ok(files(root).some(x=>x.endsWith('.integrity-unverified.json')));
}));
test('orphan gzip temporary file safely recovered when source exists',()=>withDir(root=>{
 const a=create(root);a.append({raw:'safe'});const p=files(root).find(x=>x.endsWith('.jsonl.open'));
 writeFileSync(p.replace('.jsonl.open','.jsonl.gz.tmp'),'garbage');
 closeSync(a.fd);a.fd=null;a.releaseLock();
 const b=create(root);b.close();assert.ok(statuses(replayRaw(root)).includes('GAP'));
}));
test('unverified orphan manifest temp does not grant trust',()=>withDir(root=>{
 const a=create(root);a.close();const p=files(root).find(x=>x.endsWith('.manifest.json'));
 writeFileSync(p+'.tmp','partial');unlinkSync(p);
 assert.throws(()=>create(root),/UNVERIFIED/);
}));
test('replay refuses unfinished archive',()=>withDir(root=>{
 const a=create(root);assert.throws(()=>replayRaw(root),/unfinalized/);a.close();
}));
test('missing first segment rejected',()=>withDir(root=>{
 const a=create(root);a.append({raw:'a',at:new Date('2026-11-10T21:00:00Z')});
 a.append({raw:'b',at:new Date('2026-11-10T22:00:00Z')});a.close();
 const p=files(root).filter(x=>x.endsWith('.jsonl.gz')).sort()[0];
 unlinkSync(p);unlinkSync(p+'.manifest.json');assert.throws(()=>replayRaw(root),/missing initial/);
}));
test('missing highest sequence archive detected by high-watermark',()=>withDir(root=>{
 const a=create(root);a.append({raw:'a',at:new Date('2026-11-10T21:00:00Z')});
 a.append({raw:'b',at:new Date('2026-11-10T22:00:00Z')});a.close();
 const p=files(root).filter(x=>x.endsWith('.jsonl.gz')).sort().at(-1);
 unlinkSync(p);unlinkSync(p+'.manifest.json');
 assert.throws(()=>replayRaw(root),/high-watermark/);
 assert.throws(()=>create(root),/high-watermark/);
}));
test('provider denies licensed input, health never exposes raw',()=>withDir(root=>{
 assert.throws(()=>new Engine18RawRecorder({root,provider:'IRONBEAM_V2',clock:clock()}),/disabled/);
 assert.throws(()=>new Engine18RawRecorder({root,physicalContract:'../secret',clock:clock()}),/identifier/);
 const a=create(root);a.append({raw:'SENSITIVE'});assert.ok(!JSON.stringify(a.health()).includes('SENSITIVE'));a.close();
}));
test('independent known fixture validates exact canonical binary replay bytes in subprocess',()=>withDir(root=>{
 const a=create(root);a.append({raw:Buffer.from([0,255,10]),rawEncoding:'base64',msgClass:'market'});a.close();
 const events=replayRaw(root);
 const expectedPayload='AP8K';
 const binary=events.find(e=>e.msgClass==='market');
 assert.equal(binary.raw,expectedPayload);
 assert.deepEqual(events.map(e=>e.statusCode),['RECORDER_START',null,'RECORDER_STOP']);
 const bytes=deterministicReplayBytes(root);
 const expected=Buffer.from(events.map(e=>JSON.stringify({
  schemaVersion:'engine18.raw.v2',localSeq:e.localSeq,runId:e.runId,receivedWallNs:e.receivedWallNs,
  receivedMonoNs:e.receivedMonoNs,writtenMonoNs:e.writtenMonoNs,streamGeneration:e.streamGeneration,
  msgClass:e.msgClass,statusCode:e.statusCode,rawEncoding:e.rawEncoding,raw:e.raw
 })).join('\n')+'\n');
 assert.deepEqual(bytes,expected);
 const moduleUrl=new URL('../logic/engine18/gate1RawRecorder.js',import.meta.url).href;
 const code="import{deterministicReplayBytes}from "+JSON.stringify(moduleUrl)+";import{createHash}from'node:crypto';process.stdout.write(createHash('sha256').update(deterministicReplayBytes(process.argv[1])).digest('hex'));";
 const run=spawnSync(process.execPath,['--input-type=module','-e',code,root],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 assert.equal(run.stdout,createHash('sha256').update(expected).digest('hex'));
}));
test('real SIGKILL and restart preserves acknowledged message once and emits GAP',async()=>{
 const root=mkdtempSync(join(tmpdir(),'e18-kill-'));
 try{
  const url=new URL('../logic/engine18/gate1RawRecorder.js',import.meta.url).href;
  const script="import{Engine18RawRecorder}from "+JSON.stringify(url)+";let n=1;const a=new Engine18RawRecorder({root:process.argv[1],clock:{wallNs:()=> '1794350000000000000',monoNs:()=>String(n++)}});a.append({raw:'ACK',msgClass:'market'});process.stdout.write('READY\\n');setInterval(()=>{},1000);";
  const child=spawn(process.execPath,['--input-type=module','-e',script,root],{stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
   child.stdout.on('data',d=>{if(d.toString().includes('READY'))resolve();});
   child.on('error',reject);child.on('exit',code=>reject(new Error('early exit '+code)));
  });
  child.kill('SIGKILL');await once(child,'exit');
  const b=create(root);b.append({raw:'AFTER',msgClass:'market'});b.close();
  const e=replayRaw(root);
  assert.deepEqual(market(e).map(x=>x.raw),['ACK','AFTER']);
  assert.deepEqual(statuses(e),['RECORDER_START','ACK','GAP','RECORDER_START','AFTER','RECORDER_STOP']);
  assert.deepEqual(e.map(x=>x.localSeq),[1,2,3,4,5,6]);
 }finally{rmSync(root,{recursive:true,force:true});}
});