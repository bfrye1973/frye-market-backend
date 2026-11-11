import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,closeSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {Engine18BufferedRecorder} from '../logic/engine18/engine18BufferedRecorder.js';
import {classifyIronbeamRawFrame,IronbeamFrameShapeDiagnostics,SyntheticIronbeamRecorderTap,createSyntheticRecorderWebSocketImpl} from '../logic/engine18/ironbeamV2RecorderAdapter.js';
import {replayRaw,deterministicReplayBytes} from '../logic/engine18/gate1RawRecorder.js';
const dir=fn=>{const root=mkdtempSync(join(tmpdir(),'e18-phase2-'));return Promise.resolve().then(()=>fn(root)).finally(()=>rmSync(root,{recursive:true,force:true}));};
const clock=()=>({wallNs:()=>String(BigInt(Date.parse('2026-11-10T21:10:00Z'))*1000000n),monoNs:(()=>{let i=0n;return ()=>String(++i)})()});
const files=root=>readdirSync(root,{recursive:true}).map(x=>join(root,x));
const recorder=root=>new Engine18BufferedRecorder({root,clock:clock(),batchSize:32,flushDelayMs:0});
const market=all=>all.filter(e=>e.msgClass==='market'||e.msgClass==='unknown');
test('synthetic depth quote trade retain identical raw frames and ordering',()=>dir(async root=>{
 const r=recorder(root),tap=new SyntheticIronbeamRecorderTap({recorder:r});
 const frames=[
 '{"d":{"bids":[{"p":7500,"sz":0,"l":1},{"p":7499.75,"sz":10,"l":2}],"asks":[{"p":7500.25,"sz":3,"l":1}]}}',
 '{"q":{"bp":7500,"ap":7500.25}}',
 '{"tr":[{"p":7500.25,"sz":2}]}',
 '{"d":{"bids":[],"asks":[{"p":7500.5,"sz":0}]}}',
 'not-json', '{"unexpected":true}'
 ];
 const acknowledgments=await Promise.all(frames.map(f=>tap.onFrame(f)));
 assert.equal(new Set(acknowledgments.map(x=>x.localSeq)).size,frames.length);
 await r.close();
 const all=replayRaw(root);
 assert.deepEqual(all.filter(e=>e.msgClass!=='control').map(e=>e.raw),frames);
 assert.deepEqual(all.filter(e=>e.msgClass!=='control').map(e=>e.localSeq),[2,3,4,5,6,7]);
 const stats=tap.safeDiagnostics();
 assert.equal(stats.counts.depth,2);assert.equal(stats.counts.zeroSize,2);
 assert.equal(stats.counts.malformed,1);assert.equal(stats.counts.unknown,1);
 assert.equal(stats.counts.levelIndexCount,3);assert.equal(stats.counts.missingIndex,1);
 assert.ok(!JSON.stringify(stats).includes('7500'));
}));
test('control and reconnect statuses recorded without token or raw source URL',()=>dir(async root=>{
 const r=recorder(root),tap=new SyntheticIronbeamRecorderTap({recorder:r});
 await tap.onControl('CONNECTED');await tap.onControl('SUBSCRIBED');await tap.onControl('DISCONNECTED');await tap.onControl('RECONNECT');
 await tap.onFrame('{"q":{"x":1}}');await r.close();
 const all=replayRaw(root);
 assert.deepEqual(all.map(e=>e.statusCode).filter(Boolean),['RECORDER_START','CONNECTED','SUBSCRIBED','DISCONNECTED','RECONNECT','RECORDER_STOP']);
 assert.equal(all.find(e=>e.raw.includes('"q"')).streamGeneration,2);
 assert.equal(tap.safeDiagnostics().counts.reconnects,1);assert.equal(r.health().reconnects,1);
}));
test('binary and malformed frames remain unchanged',()=>dir(async root=>{
 const r=recorder(root),tap=new SyntheticIronbeamRecorderTap({recorder:r});
 const bytes=Buffer.from([0,1,255,10,128,0,254]);
 await tap.onFrame(bytes);await tap.onFrame('{nope');
 await r.close();
 const e=replayRaw(root);
 assert.deepEqual(Buffer.from(e.find(x=>x.rawEncoding==='base64').raw,'base64'),bytes);
 assert.equal(e.find(x=>x.raw==='{nope').msgClass,'unknown');
}));
test('diagnostics include prefilter counts and reject malformed depth shapes',()=>{
 const d=new IronbeamFrameShapeDiagnostics();
 for(const raw of ['{"d":{"bids":[{"sz":0,"l":0}],"asks":[{"sz":2}]}}','{"d":{"bids":"bad","asks":[]}}','{"d":{"bids":[],"asks":[]}}']){
  d.observe(classifyIronbeamRawFrame(raw));
 }
 const s=d.summary();
 assert.equal(s.counts.total,3);assert.equal(s.counts.depth,3);
 assert.equal(s.counts.acceptedDepth,2);assert.equal(s.counts.rejectedDepth,1);
 assert.equal(s.counts.zeroSize,1);assert.equal(s.counts.levelIndexCount,1);
 assert.equal(s.bidLevelHistogram['1'],1);
 assert.equal(s.feedSemantics,'UNVERIFIED');assert.equal(s.conflation,'UNVERIFIED');
});
test('recording remains inaccessible without synthetic-only authorization',()=>dir(async root=>{
 const r=recorder(root);
 assert.throws(()=>new SyntheticIronbeamRecorderTap({recorder:r,authorized:true}),/NOT AUTHORIZED/);
 assert.throws(()=>classifyIronbeamRawFrame({q:1}),/TYPE/);
 await r.close();
}));
test('high-load simulated open 20000 raw messages, bounded in-flight groups, replay hashes equal',()=>dir(async root=>{
 const r=new Engine18BufferedRecorder({root,clock:clock(),maxQueued:512,batchSize:128,flushDelayMs:0});
 const n=20000,begin=performance.now();
 let ack=0;
 for(let batch=0;batch<n/128;batch++){
  const promises=[];
  for(let j=0;j<128&&ack+j<n;j++){
   const seq=batch*128+j;
   if(seq>=n)break;
   promises.push(r.offer({raw:JSON.stringify({d:{bids:[{p:7500,sz:seq%8}],asks:[{p:7501,sz:seq%4}]}}),msgClass:'market'}));
  }
  ack+=(await Promise.all(promises)).length;
 }
 await r.close();const elapsed=performance.now()-begin;
 assert.equal(ack,n);assert.equal(r.health().recorded,n);
 const all=replayRaw(root);assert.equal(market(all).length,n);
 assert.deepEqual([...all].map(e=>e.localSeq),Array.from({length:n+2},(_,i)=>i+1));
 const hash=()=>createHash('sha256').update(deterministicReplayBytes(root)).digest('hex');
 assert.equal(hash(),hash());
 const mbps=(r.health().bytesWritten/1e6)/(elapsed/1000);
 console.log(JSON.stringify({syntheticBenchmark:{messages:n,elapsedMs:+elapsed.toFixed(1),framesPerSecond:+(n/(elapsed/1000)).toFixed(0),MBps:+mbps.toFixed(2),kind:'LOCAL_GITHUB_ACTIONS_SYNTHETIC_ONLY'}}));
}));
test('queue overflow fails closed, rejects unacknowledged pending messages; restart writes GAP',()=>dir(async root=>{
 const r=new Engine18BufferedRecorder({root,clock:clock(),maxQueued:2,batchSize:100,flushDelayMs:10000});
 const first=r.offer({raw:'one'}),second=r.offer({raw:'two'});
 await assert.rejects(r.offer({raw:'three'}),/backpressure/);
 await assert.rejects(first,/failed closed/);await assert.rejects(second,/failed closed/);
 assert.equal(r.health().recordingActive,false);assert.equal(r.health().rejected,1);
 r.writer.rotate();r.writer.releaseLock();
 const b=recorder(root);await b.close();
 assert.equal(replayRaw(root).filter(e=>e.statusCode==='GAP').length,1);
}));
test('streaming compression at hour crossing; SHA-256 manifests verified',()=>dir(async root=>{
 const r=recorder(root);
 await r.offer({raw:'hourOne',at:new Date('2026-11-10T21:59:59Z')});
 await r.offer({raw:'hourTwo',at:new Date('2026-11-10T22:00:00Z')});
 await r.close();
 const compressed=files(root).filter(x=>x.endsWith('.jsonl.gz'));
 assert.ok(compressed.length>=2);
 for(const p of compressed){
  const manifest=JSON.parse(readFileSync(p+'.manifest.json','utf8'));
  assert.equal(manifest.sha256,createHash('sha256').update(readFileSync(p)).digest('hex'));
 }
 assert.deepEqual(market(replayRaw(root)).map(e=>e.raw),['hourOne','hourTwo']);
}));
test('real SIGKILL buffered group acknowledgments, recovery + deterministic replay',async()=>{
 const root=mkdtempSync(join(tmpdir(),'e18-phase2-kill-'));
 try{
  const url=new URL('../logic/engine18/engine18BufferedRecorder.js',import.meta.url).href;
  const script="import{Engine18BufferedRecorder}from "+JSON.stringify(url)+";let n=0n;const r=new Engine18BufferedRecorder({root:process.argv[1],clock:{wallNs:()=> '1794350000000000000',monoNs:()=>String(++n)},batchSize:8,flushDelayMs:0});await Promise.all(Array.from({length:128},(_,i)=>r.offer({raw:'ACK'+i,msgClass:'market'})));process.stdout.write('READY\\n');setInterval(()=>{},1000);";
  const child=spawn(process.execPath,['--input-type=module','-e',script,root],{stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{if(data.toString().includes('READY'))resolve();});child.once('error',reject);child.once('exit',code=>reject(Error('child exited early '+code)));});
  child.kill('SIGKILL');await once(child,'exit');
  const b=recorder(root);await b.offer({raw:'AFTER',msgClass:'market'});await b.close();
  const all=market(replayRaw(root));assert.equal(all.length,129);
  assert.deepEqual(all.map(e=>e.raw),[...Array.from({length:128},(_,i)=>'ACK'+i),'AFTER']);
  assert.equal(replayRaw(root).filter(e=>e.statusCode==='GAP').length,1);
  assert.deepEqual(deterministicReplayBytes(root),deterministicReplayBytes(root));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('real Ironbeam-style ES d array retains zero rows, l, and implied fields before filtering',()=>dir(async root=>{
 const r=recorder(root),tap=new SyntheticIronbeamRecorderTap({recorder:r});
 const raw='{"d":[{"s":"XCME:ES.Z26","b":[{"p":7500,"sz":0,"o":0,"l":0,"is":7,"ioc":1},{"p":7499.75,"sz":4,"o":1,"l":1}],"a":[{"p":7500.25,"sz":1,"o":1,"l":0}]}]}';
 await tap.onFrame(raw);await tap.onFrame(raw);await r.close();
 assert.deepEqual(market(replayRaw(root)).map(x=>x.raw),[raw,raw]);
 const d=tap.safeDiagnostics();assert.equal(d.counts.depth,2);
 assert.equal(d.counts.acceptedDepth,2);assert.equal(d.counts.zeroSize,2);
 assert.equal(d.counts.levelIndexCount,6);
 assert.equal(d.bidLevelHistogram['2'],2);assert.equal(d.askLevelHistogram['1'],2);
 assert.equal(Object.values(d.intervalsMs).reduce((a,b)=>a+b,0),1);
}));
test('malformed, one-sided and empty d frames retained, all shapes counted',()=>dir(async root=>{
 const r=recorder(root),tap=new SyntheticIronbeamRecorderTap({recorder:r});
 const frames=['{"d":[{"s":"XCME:ES.Z26","b":[{"sz":0}]}]}','{"d":[]}','{"d":[{"s":"XCME:ES.Z26","b":[],"a":[]}]}','{"d":[{"s":"OTHER","b":[],"a":[]}]}'];
 await Promise.all(frames.map(f=>tap.onFrame(f)));await r.close();
 assert.deepEqual(market(replayRaw(root)).map(x=>x.raw),frames);
 const d=tap.safeDiagnostics();
 assert.equal(d.counts.depth,4);assert.ok(d.counts.rejectedDepth>=2);
 assert.equal(d.feedSemantics,'UNVERIFIED');
}));

test('raw frame receipt timestamp is frozen before parser/diagnostic work',()=>dir(async root=>{
 const t=BigInt(Date.parse('2026-11-10T21:00:00Z'))*1000000n;
 let wall=t,mono=10n;
 const r=new Engine18BufferedRecorder({root,clock:{wallNs:()=>String(wall),monoNs:()=>String(++mono)},flushDelayMs:0});
 const oldCapture=r.capture.bind(r);
 r.capture=(args)=>{const receipt=oldCapture(args);wall+=60000000000n;return receipt;};
 const tap=new SyntheticIronbeamRecorderTap({recorder:r});
 await tap.onFrame('{"d":[{"s":"XCME:ES.Z26","b":[],"a":[]}]}');await r.close();
 const e=market(replayRaw(root)).at(-1);
 assert.equal(e.receivedWallNs,String(t));
 assert.ok(BigInt(e.writtenMonoNs)>=BigInt(e.receivedMonoNs));
 assert.equal(tap.safeDiagnostics().counts.depth,1);
}));

test('nonblocking synthetic WebSocket never delays reader callback while recording',()=>dir(async root=>{
 class FakeWebSocket {
  constructor(){this.listeners={};this.readyState=1;this.bufferedAmount=0;FakeWebSocket.current=this;}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  emit(name,e){for(const fn of this.listeners[name]||[])fn(e);}
  close(){this.readyState=3;}
  send(){}
 }
 const r=recorder(root),tap=new SyntheticIronbeamRecorderTap({recorder:r});
 const Bridged=createSyntheticRecorderWebSocketImpl(FakeWebSocket,{tap,maxInbound:16});
 const ws=new Bridged('wss://synthetic.invalid/do-not-open-real-socket');
 let invoked=0,seqAtCallback=[];
 ws.addEventListener('message',e=>{invoked++;seqAtCallback.push(r.writer.seq);});
 FakeWebSocket.current.emit('message',{data:'{"d":[{"s":"XCME:ES.Z26","b":[],"a":[]}]}'});
 assert.equal(invoked,1,'reader callback must execute immediately even before fsync');
 await ws.queue;
 assert.equal(invoked,1);assert.ok(seqAtCallback[0]>=1);
 await r.close();
 assert.equal(replayRaw(root).filter(x=>x.msgClass==='market').length,1);
}));
test('synthetic WebSocket ingress overflow faults recorder WITHOUT blocking reader',()=>dir(async root=>{
 class FakeWebSocket{
  constructor(){this.listeners={};this.readyState=1;FakeWebSocket.current=this;}
  addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
  emit(data){for(const fn of this.listeners.message||[])fn({data});}
  close(){this.readyState=3;}
  send(){}
 }
 const r=recorder(root),tap=new SyntheticIronbeamRecorderTap({recorder:r});
 let reason=null;const WS=createSyntheticRecorderWebSocketImpl(FakeWebSocket,{tap,maxInbound:1,onFailure:r=>{reason=r;}});
 const ws=new WS('wss://synthetic.invalid');
 const readerEvents=[];
 ws.addEventListener('message',e=>readerEvents.push(e.data));
 FakeWebSocket.current.emit('{"q":1}');
 FakeWebSocket.current.emit('{"q":2}');
 await ws.queue;
 assert.equal(ws.failed,true);assert.equal(reason,'RECORDER_CAPTURE_FAILED');
 assert.equal(r.health().recordingActive,false);
 assert.equal(readerEvents.length,2,'market reader must receive both frames regardless of recorder failure');
 assert.equal(FakeWebSocket.current.readyState,1,'recorder failure must not close reader socket');
 r.writer.rotate();r.writer.releaseLock();
 const b=recorder(root);await b.close();
 assert.equal(replayRaw(root).filter(x=>x.statusCode==='GAP').length,1);
}));

test('synthetic WebSocket automatically persists CONNECTED/DISCONNECTED/RECONNECT/GAP without credentials',()=>dir(async root=>{
 class FakeWebSocket{
  constructor(){this.events={};this.readyState=1;FakeWebSocket.current=this;}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  emit(k){for(const fn of this.events[k]||[])fn({type:k});}
  close(){this.readyState=3;this.emit('close');}
  send(){}
 }
 const r=recorder(root),tap=new SyntheticIronbeamRecorderTap({recorder:r});
 const W=createSyntheticRecorderWebSocketImpl(FakeWebSocket,{tap,maxInbound:12});
 const ws1=new W('wss://synthetic.invalid/?token=do-not-record');
 FakeWebSocket.current.emit('open');await ws1.queue;FakeWebSocket.current.emit('close');await ws1.queue;
 const ws2=new W('wss://synthetic.invalid/?token=do-not-record');
 FakeWebSocket.current.emit('open');await ws2.queue;FakeWebSocket.current.emit('error');await ws2.queue;
 await r.close();
 const events=replayRaw(root);
 assert.deepEqual(events.map(e=>e.statusCode).filter(Boolean),[
  'RECORDER_START','CONNECTED','DISCONNECTED','RECONNECT','GAP','RECORDER_STOP']);
 assert.ok(events.every(e=>!e.raw.includes('token=')));
 assert.equal(events.find(e=>e.statusCode==='RECONNECT').streamGeneration,2);
}));

test('injected ENOSPC rejects group without ack, startup marks uncertain interval GAP',()=>dir(async root=>{
 const enospc=()=>{const e=Error('simulated disk full');e.code='ENOSPC';throw e;};
 let throwOnce=true;
 const r=new Engine18BufferedRecorder({root,clock:clock(),batchSize:8,flushDelayMs:0,
  testFault:(stage)=>{if(stage==='BEFORE_FSYNC'&&throwOnce){throwOnce=false;enospc();}}});
 const promises=Array.from({length:8},(_,i)=>r.offer({raw:'UNACK'+i,msgClass:'market'}));
 const outcomes=await Promise.allSettled(promises);
 assert.ok(outcomes.every(x=>x.status==='rejected'));
 assert.equal(r.health().failedClosed,true);
 assert.equal(r.health().recorded,0);
 r.writer.rotate();r.writer.releaseLock(); // simulate crash cleanup only, never clean STOP
 const recovered=recorder(root);await recovered.close();
 const all=replayRaw(root);
 assert.equal(all.filter(x=>x.statusCode==='GAP').length,1);
 assert.equal(new Set(all.map(x=>x.localSeq)).size,all.length);
 // Unacknowledged bytes may survive as uncertain evidence; never pretend they were ACKed.
 assert.equal(all.filter(x=>x.raw.startsWith('UNACK')).length,8);
}));
test('injected partial batch failure fails closed with acknowledged prefix preserved',()=>dir(async root=>{
 const r=new Engine18BufferedRecorder({root,clock:clock(),batchSize:4,flushDelayMs:0});
 await Promise.all(Array.from({length:4},(_,i)=>r.offer({raw:'ACK'+i,msgClass:'market'})));
 let failed=false;
 r.writer.testFault=(stage,{index}={})=>{if(!failed&&stage==='AFTER_FRAME'&&index===0){failed=true;throw Error('PARTIAL_WRITE');}};
 const batch=await Promise.allSettled(Array.from({length:4},(_,i)=>r.offer({raw:'UNACK'+i,msgClass:'market'})));
 assert.ok(batch.every(x=>x.status==='rejected'));
 assert.equal(r.health().recorded,4);
 r.writer.rotate();r.writer.releaseLock();
 const recovered=recorder(root);await recovered.close();
 const events=replayRaw(root),payloads=events.filter(x=>x.msgClass==='market').map(x=>x.raw);
 assert.deepEqual(payloads.slice(0,4),['ACK0','ACK1','ACK2','ACK3']);
 assert.equal(payloads.filter(x=>x==='UNACK0').length,1);
 assert.equal(payloads.filter(x=>x.startsWith('UNACK')).length,1);
 assert.equal(events.filter(x=>x.statusCode==='GAP').length,1);
 assert.deepEqual(events.map(x=>x.localSeq),Array.from({length:events.length},(_,i)=>i+1));
}));
test('close while flush in progress accepts earlier offers and refuses new intake',()=>dir(async root=>{
 const r=new Engine18BufferedRecorder({root,clock:clock(),batchSize:2,flushDelayMs:50});
 const queued=r.offer({raw:'IN_QUEUE',msgClass:'market'});
 const closing=r.close();
 await assert.rejects(r.offer({raw:'AFTER_CLOSE_REQUEST'}),/stopped/);
 await queued;await closing;
 assert.deepEqual(market(replayRaw(root)).map(x=>x.raw),['IN_QUEUE']);
 assert.equal(replayRaw(root).filter(x=>x.statusCode==='RECORDER_STOP').length,1);
}));
test('disk-full and partial write tests retain exact binary bytes and original frame order',()=>dir(async root=>{
 const r=recorder(root);
 const raw=Buffer.from([0,10,0,255,80,129]);
 await r.offer({raw,rawEncoding:'base64',msgClass:'market'});
 await r.offer({raw:'{"d":[{"s":"XCME:ES.Z26","b":[{"l":0,"sz":0}],"a":[]}]}',msgClass:'market'});
 await r.close();
 const payloads=market(replayRaw(root));
 assert.deepEqual(Buffer.from(payloads[0].raw,'base64'),raw);
 assert.equal(payloads[1].localSeq,payloads[0].localSeq+1);
}));
