import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,appendFileSync,closeSync,writeFileSync,unlinkSync,writeSync,fsyncSync,renameSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {Engine18RawRecorder,replayRaw} from '../logic/engine18/gate1RawRecorder.js';
import {Engine18BufferedRecorder} from '../logic/engine18/engine18BufferedRecorder.js';
import {Engine18SyntheticArchiveBackup,MockPrivateEncryptedStore} from '../logic/engine18/engine18Phase4Backup.js';
import {Engine18SyntheticWorkerBridge} from '../logic/engine18/engine18Phase4WorkerBridge.js';
import {scanEngine18ReplayBounded} from '../logic/engine18/engine18BoundedReplayScan.js';
const temp=fn=>{const root=mkdtempSync(join(tmpdir(),'engine18-p4-'));return Promise.resolve().then(()=>fn(root)).finally(()=>rmSync(root,{recursive:true,force:true}));};
const clock=()=>({wallNs:()=>String(BigInt(Date.parse('2026-11-10T21:00:00Z'))*1000000n),monoNs:(()=>{let n=0n;return ()=>String(++n);})()});
const allFiles=root=>readdirSync(root,{recursive:true}).map(p=>join(root,p));
const make=async root=>Engine18BufferedRecorder.openBounded({root,clock:clock(),batchSize:64,flushDelayMs:0});
const rawEvents=events=>events.filter(e=>e.msgClass==='market');
const store=()=>new MockPrivateEncryptedStore({key:randomBytes(32)});

test('bounded recovery restores unclosed multi-megabyte open archive and preserves acknowledged order',()=>temp(async root=>{
 const first=await make(root);
 const prefix='Synthetic depth with exact numeric text p=7500.2500 l=0 sz=0 '+('a'.repeat(4096));
 let ack=0;
 for(let batch=0;batch<64;batch++){
  const offers=Array.from({length:64},(_,i)=>first.offer({raw:prefix+(batch*64+i),msgClass:'market'}));
  ack+=(await Promise.all(offers)).length;
 }
 assert.equal(ack,4096);
 const active=allFiles(root).find(x=>x.endsWith('.jsonl.open'));
 assert.ok(active);
 // Simulate killed recorder: a torn trailing unacknowledged JSONL line.
 appendFileSync(active,'{"truncated":"partial');
 closeSync(first.writer.fd);first.writer.fd=null;first.writer.releaseLock();
 const before=process.memoryUsage().rss;
 const second=await make(root);
 const metrics=second.writer.recoveryMetrics;
 assert.ok(metrics.recoveredOpen>=1);
 assert.ok(metrics.truncatedBytes>0);
 assert.ok(metrics.maxBufferedBytes<16*1024*1024);
 await second.offer({raw:'AFTER_CRASH',msgClass:'market'});await second.close();
 const after=process.memoryUsage().rss;
 const out=rawEvents(replayRaw(root));
 assert.equal(out.length,4097);
 assert.equal(new Set(out.map(e=>e.localSeq)).size,out.length);
 assert.deepEqual(out.map(x=>x.raw).slice(0,2),[prefix+'0',prefix+'1']);
 assert.equal(out.at(-1).raw,'AFTER_CRASH');
 assert.equal(replayRaw(root).filter(x=>x.statusCode==='GAP').length,1);
 const check=await scanEngine18ReplayBounded(root);
 assert.equal(check.records,4101);
 console.log(JSON.stringify({phase4RecoveryBenchmark:{frames:4096,rawPayloadBytes:prefix.length*4096,
  bufferedRemainderBytes:metrics.maxBufferedBytes,truncatedBytes:metrics.truncatedBytes,
  rssBeforeMiB:+(before/1048576).toFixed(1),rssAfterMiB:+(after/1048576).toFixed(1)}}));
}));
test('bounded recovery fails closed on tail archive deletion and SHA256 corruption',()=>temp(async root=>{
 const rec=await make(root);
 await rec.offer({raw:'first',msgClass:'market',at:new Date('2026-11-10T21:00:00Z')});
 await rec.offer({raw:'second',msgClass:'market',at:new Date('2026-11-10T22:00:00Z')});
 await rec.close();
 const gz=allFiles(root).filter(p=>p.endsWith('.jsonl.gz')).sort();
 const tail=gz.at(-1),tailBytes=readFileSync(tail);
 writeFileSync(tail,Buffer.from('bad-gzip'));
 await assert.rejects(make(root),/SHA256/);
 writeFileSync(tail,tailBytes);
 unlinkSync(tail);unlinkSync(tail+'.manifest.json');
 await assert.rejects(make(root),/high-watermark|sequence/);
}));
test('encrypted mock backup retries, durable inventory, and deterministic restored replay',()=>temp(async root=>{
 const writer=await make(root);
 for(let i=0;i<100;i++)await writer.offer({raw:'{"d":[{"s":"XCME:ES.Z26","b":[{"sz":0,"l":0}],"a":[]}],"i":'+i+'}',msgClass:'market'});
 await writer.close();
 const remote=store();remote.failNext(2);
 const backup=new Engine18SyntheticArchiveBackup({root,store:remote,maxRetries:4});
 const result=await backup.backupClosed();
 assert.equal(result.retries,2);assert.ok(result.remoteArchiveCount>0);
 const id=remote.listInventory()[0];assert.ok(!remote.objects.get(id.objectId).plaintext);
 const again=await backup.backupClosed();assert.equal(again.remoteArchiveCount,result.remoteArchiveCount);
 const restoreRoot=root+'-restore';
 try{
  const restored=await backup.restore({destination:restoreRoot});
  assert.equal(restored.lastSeq,writer.writer.seq);
  const originalHash=createHash('sha256').update(JSON.stringify(replayRaw(root))).digest('hex');
  const restoredHash=createHash('sha256').update(JSON.stringify(replayRaw(restoreRoot))).digest('hex');
  assert.equal(originalHash,restoredHash);
  const scan=await scanEngine18ReplayBounded(restoreRoot);
  assert.equal(scan.lastSeq,writer.writer.seq);
 }finally{rmSync(restoreRoot,{recursive:true,force:true});}
}));
test('mock backup detects missing/corrupted remote object or inventory conflict',()=>temp(async root=>{
 const writer=await make(root);await writer.offer({raw:'test',msgClass:'market'});await writer.close();
 const remote=store();const backup=new Engine18SyntheticArchiveBackup({root,store:remote});
 await backup.backupClosed();
 const entry=remote.listInventory()[0];remote.tamperForFault(entry.objectId);
 await assert.rejects(backup.backupClosed(),/corrupt|auth|authenticate|decrypt/i);
 assert.throws(()=>remote.commitInventory({...entry,lastSeq:entry.lastSeq+1}),/conflict/);
}));
test('synthetic worker process is independent, ACKs after fsync, measured callback latency and 20k bursts',()=>temp(async root=>{
 const bridge=new Engine18SyntheticWorkerBridge({root,maxInflight:128});
 await bridge.start();
 let acks=0;const begin=performance.now();
 for(let group=0;group<200;group++){
  const promises=Array.from({length:100},(_,i)=>bridge.submit('frame-'+(group*100+i),{msgClass:'market'}));
  const result=await Promise.all(promises);acks+=result.length;
 }
 await bridge.close();
 const ms=performance.now()-begin;
 assert.equal(acks,20000);assert.equal(bridge.health().acked,20000);
 const events=rawEvents(replayRaw(root));
 assert.equal(events.length,20000);
 assert.equal(events[0].raw,'frame-0');
 assert.equal(events.at(-1).raw,'frame-19999');
 const h=bridge.health();
 assert.ok(Number.isFinite(h.callbackUsP95)&&Number.isFinite(h.callbackUsP99));
 console.log(JSON.stringify({phase4WorkerBenchmark:{frames:acks,elapsedMs:+ms.toFixed(1),
  framesPerSecond:+(acks*1000/ms).toFixed(0),callbackUsP95:+h.callbackUsP95.toFixed(1),
  callbackUsP99:+h.callbackUsP99.toFixed(1),scope:'synthetic child IPC only'}}));
}));
test('worker IPC overflow fails closed without blocking caller or fabricating acknowledged events',()=>temp(async root=>{
 const bridge=new Engine18SyntheticWorkerBridge({root,maxInflight:1});
 await bridge.start();
 let a=bridge.submit('first',{msgClass:'market'});
 await assert.rejects(bridge.submit('overflow',{msgClass:'market'}),/overflow/i);
 await assert.rejects(a,/unacknowledged/);
 assert.equal(bridge.health().active,false);
 await bridge.close();
 // Restart with new bounded recorder; unknown unACKed first frame may or may not survive,
 // but recovered sequence and explicit GAP must be correct.
 const recovered=await make(root);await recovered.close();
 const events=replayRaw(root);
 assert.equal(events.filter(e=>e.statusCode==='GAP').length,1);
 assert.equal(new Set(events.map(e=>e.localSeq)).size,events.length);
}));
test('missing backup archive is detected on restore; no silent certified replay',()=>temp(async root=>{
 const writer=await make(root);await writer.offer({raw:'a'});await writer.close();
 const remote=store(),backup=new Engine18SyntheticArchiveBackup({root,store:remote});
 await backup.backupClosed();
 const first=remote.listInventory()[0];remote.removeForFault(first.objectId);
 await assert.rejects(backup.restore({destination:root+'-bad'}),/remote object missing|restore failed/);
 rmSync(root+'-bad',{recursive:true,force:true});
}));

test('large 96+ MiB synthetic open log recovers without whole-file loading and legacy sync path refuses',()=>temp(async root=>{
 const recorder=await make(root),originalRun=recorder.writer.runId;
 const active=allFiles(root).find(x=>x.endsWith('.jsonl.open'));
 assert.ok(active);
 const size=24576,raw='X'.repeat(4096);
 for(let i=0;i<size;i++){
  const item={schemaVersion:'engine18.raw.v2',localSeq:i+2,runId:originalRun,
   receivedWallNs:'1794350000000000000',receivedMonoNs:String(i*2+100),
   writtenMonoNs:String(i*2+101),streamGeneration:1,msgClass:'market',
   statusCode:null,rawEncoding:'utf8',raw};
  const frame=Buffer.from(JSON.stringify(item)+'\n');
  let n=0;while(n<frame.length){const k=writeSync(recorder.writer.fd,frame,n,frame.length-n);assert.ok(k>0);n+=k;}
 }
 fsyncSync(recorder.writer.fd);
 const totalBytes=statSync(active).size;
 assert.ok(totalBytes>96*1024*1024);
 const cp=join(root,'.engine18-highwater.json'),tmp=cp+'.fixture';
 writeFileSync(tmp,JSON.stringify({schemaVersion:'engine18.checkpoint.v1',lastSeq:size+1})+'\n');renameSync(tmp,cp);
 closeSync(recorder.writer.fd);recorder.writer.fd=null;recorder.writer.releaseLock();
 assert.throws(()=>new Engine18RawRecorder({root,clock:clock()}),/bounded recovery factory/);
 const before=process.memoryUsage().rss,begin=performance.now();
 const recovered=await make(root);
 const elapsed=performance.now()-begin,after=process.memoryUsage().rss;
 assert.equal(recovered.writer.recoveryMetrics.recoveredOpen,1);
 assert.ok(recovered.writer.recoveryMetrics.maxBufferedBytes<16*1024*1024);
 await recovered.close();
 const scan=await scanEngine18ReplayBounded(root);
 assert.equal(scan.records,size+4);
 assert.equal(scan.lastSeq,size+4);
 console.log(JSON.stringify({phase4LargeRecovery:{
  rawMiB:+(totalBytes/1048576).toFixed(1),frames:size,elapsedMs:+elapsed.toFixed(1),
  sampledRssBeforeMiB:+(before/1048576).toFixed(1),
  sampledRssAfterMiB:+(after/1048576).toFixed(1),
  bufferedRemainderBytes:recovered.writer.recoveryMetrics.maxBufferedBytes
 }}));
}));
test('independent mock inventory high-watermark detects removal of final remote entry',()=>temp(async root=>{
 const w=await make(root);
 await w.offer({raw:'hour1',at:new Date('2026-11-10T21:59:00Z')});
 await w.offer({raw:'hour2',at:new Date('2026-11-10T22:01:00Z')});
 await w.close();
 const remote=store(),backup=new Engine18SyntheticArchiveBackup({root,store:remote});
 await backup.backupClosed();
 const entries=remote.listInventory();
 assert.ok(entries.length>=2);
 remote.inventory.delete(entries.at(-1).archiveId);
 assert.throws(()=>remote.listInventory(),/high-watermark/);
 await assert.rejects(backup.restore({destination:root+'-restore'}),/high-watermark/);
 rmSync(root+'-restore',{recursive:true,force:true});
}));
