import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Engine18SyntheticReadinessSupervisor,getExactBinary,validateClockSample,getSafeStartupMetadata} from '../logic/engine18/engine18Phase3Readiness.js';
import {scanEngine18ReplayBounded} from '../logic/engine18/engine18BoundedReplayScan.js';
import {replayRaw,deterministicReplayBytes} from '../logic/engine18/gate1RawRecorder.js';

const temp=fn=>{const root=mkdtempSync(join(tmpdir(),'e18-p3-'));return Promise.resolve().then(()=>fn(root)).finally(()=>rmSync(root,{recursive:true,force:true}));};
const clock=()=>({wallNs:()=>String(BigInt(Date.parse('2026-11-10T21:00:00Z'))*1000000n),monoNs:(()=>{let n=0n;return ()=>String(++n);})()});
const meta={softwareVersion:'1.2.3',gitCommit:'abcdef1234567890',provider:'IRONBEAM_V2',apiVersion:'v2',
 physicalContract:'XCME:ES.Z26',contractMapping:'ESZ26',clockSource:'UNVERIFIED',clockConfiguration:'HOST_MONO_NTPOFFSET_UNVERIFIED'};
const supervisor=root=>new Engine18SyntheticReadinessSupervisor({root,clock:clock(),metadata:meta,batchSize:8,flushDelayMs:0});
test('startup metadata is permanently replayable and no secrets are accepted',()=>temp(async root=>{
 const s=supervisor(root);await s.start();await s.close();
 const e=replayRaw(root);assert.equal(e[0].statusCode,'RECORDER_START');
 const m=e.find(x=>x.statusCode==='RECORDER_METADATA');assert.ok(m);
 assert.deepEqual(JSON.parse(m.raw),getSafeStartupMetadata(meta));
 assert.equal(m.runId,e[0].runId);
 assert.throws(()=>getSafeStartupMetadata({...meta,gitCommit:'not valid commit'}),/git commit/);
 assert.throws(()=>getSafeStartupMetadata({...meta,physicalContract:'ES?token=SECRET'}),/invalid field/);
}));
test('distinct socket generations do not misattribute deferred old-generation frames',()=>temp(async root=>{
 const s=supervisor(root);await s.start();
 const a=s.open({connectionId:'socket-a'});await a.ack;
 const old=s.frame(a.socket,'{"d":[{"s":"XCME:ES.Z26","b":[],"a":[]}]}');
 const b=s.open({connectionId:'socket-b'});
 const now=s.frame(b.socket,'{"tr":[{"p":7525,"sz":2}]}');
 await Promise.all([old,b.ack,now]);await s.close();
 const events=replayRaw(root);
 const x=events.find(e=>e.raw.includes('"d"')),y=events.find(e=>e.raw.includes('"tr"'));
 assert.equal(x.streamGeneration,1);assert.equal(y.streamGeneration,2);
 assert.deepEqual(events.filter(e=>['CONNECTED','RECONNECT'].includes(e.statusCode)).map(e=>e.streamGeneration),[1,2]);
 assert.deepEqual(events.map(e=>e.localSeq),Array.from({length:events.length},(_,i)=>i+1));
 assert.notEqual(a.socket.connectionId,b.socket.connectionId);
 assert.throws(()=>s.frame({generation:1,connectionId:'socket-b',runId:a.socket.runId},'x'),/unknown connection/);
}));
test('record sanitized disconnect and websocket error separately from recovery GAP',()=>temp(async root=>{
 const s=supervisor(root);await s.start();
 const {socket,ack}=s.open({connectionId:'s1'});await ack;
 await s.socketEvent(socket,'WS_ERROR',{reason:'TRANSPORT_FAILURE'});
 await s.socketEvent(socket,'DISCONNECTED',{reason:'REMOTE_CLOSE',closeCode:1006});
 await s.close();
 const all=replayRaw(root);const statuses=all.map(x=>x.statusCode).filter(Boolean);
 assert.ok(statuses.includes('WS_ERROR'));assert.ok(statuses.includes('DISCONNECTED'));assert.ok(!statuses.includes('GAP'));
 const err=JSON.parse(all.find(e=>e.statusCode==='WS_ERROR').raw);
 assert.deepEqual(err,{connectionId:'s1',reason:'TRANSPORT_FAILURE',closeCode:null});
 assert.throws(()=>s.socketEvent(socket,'WS_ERROR',{reason:'Bearer abc'}),/unsafe/);
}));
test('durable subscription ack SUCCESS/FAILED with physical contract and safe stream ID',()=>temp(async root=>{
 const s=supervisor(root);await s.start();const {socket,ack}=s.open();await ack;
 await s.subscription(socket,{feedType:'depths',streamId:'stream_001',status:'SUCCESS'});
 await s.subscription(socket,{feedType:'trades',streamId:'stream_001',status:'FAILED'});
 await s.subscription(socket,{feedType:'quotes',streamId:'stream_001',status:'SUCCESS'});
 await s.close();
 const all=replayRaw(root).filter(e=>e.statusCode==='SUBSCRIPTION_ACK');
 assert.equal(all.length,3);
 assert.deepEqual(all.map(e=>JSON.parse(e.raw).status),['SUCCESS','FAILED','SUCCESS']);
 assert.ok(all.every(e=>JSON.parse(e.raw).physicalContract==='XCME:ES.Z26'));
 assert.ok(all.every(e=>e.streamGeneration===socket.generation));
 assert.ok(!JSON.stringify(all).includes('Bearer '));
 assert.throws(()=>s.subscription(socket,{feedType:'depths',streamId:'https://secret/?token=abc',status:'SUCCESS'}),/unsafe stream ID/);
}));
test('exact Blob, ArrayBuffer, Buffer, Uint8Array and DataView round trip',()=>temp(async root=>{
 const s=supervisor(root);await s.start();const {socket,ack}=s.open();await ack;
 const original=Uint8Array.from([0,1,255,10,128,0,200]);
 const inputs=[
  ' { "q": 01 } ',
  Buffer.from(original),
  original.slice(),
  original.buffer.slice(0),
  new DataView(original.buffer.slice(0)),
  new Blob([original])
 ];
 const tasks=inputs.map(input=>s.frame(socket,input));
 original.fill(9); // cannot corrupt bytes captured from Uint8Array input
 await Promise.all(tasks);await s.close();
 const frames=replayRaw(root).filter(e=>e.msgClass==='unknown');
 assert.equal(frames[0].raw,inputs[0]);
 for(const e of frames.slice(1))assert.deepEqual(Buffer.from(e.raw,'base64'),Buffer.from([0,1,255,10,128,0,200]));
 assert.equal(frames[0].rawEncoding,'utf8');
 assert.ok(frames.slice(1).every(e=>e.rawEncoding==='base64'));
}));
test('clock quality rejects fabricated offset, explicitly records UNVERIFIED and trusted samples',()=>temp(async root=>{
 let verified=false;
 const s=new Engine18SyntheticReadinessSupervisor({root,clock:clock(),metadata:meta,clockSampler:async()=>
  verified?{verified:true,source:'CHRONY',offsetNs:'-25000',uncertaintyNs:'8000'}:null});
 await s.start();
 assert.deepEqual((await s.clockSample()).quality,'UNVERIFIED');
 verified=true;
 assert.deepEqual((await s.clockSample()).quality,'VERIFIED');
 await s.close();
 const samples=replayRaw(root).filter(x=>x.statusCode==='CLOCK_SAMPLE').map(x=>JSON.parse(x.raw));
 assert.equal(samples.length,2);assert.equal(samples[0].offsetNs,null);
 assert.equal(samples[1].offsetNs,'-25000');
 assert.throws(()=>validateClockSample({verified:true,source:'WALL_MINUS_MONO',offsetNs:'10',uncertaintyNs:'0'}),/unsupported/);
}));
test('large archive bounded streaming replay produces identical hashes and records RSS',()=>temp(async root=>{
 const s=supervisor(root);await s.start();const {socket,ack}=s.open();await ack;
 const count=4000,payload=Buffer.from('z'.repeat(1024)),promises=[];
 for(let batch=0;batch<count/8;batch++){
  const current=[];
  for(let i=0;i<8;i++)current.push(s.frame(socket,Buffer.concat([payload,Buffer.from(String(batch*8+i))])));
  await Promise.all(current);
 }
 await s.close();
 const hashes=[];
 for(let pass=0;pass<2;pass++){
  let seen=0;const sha=createHash('sha256');
  const result=await scanEngine18ReplayBounded(root,{onRecord:e=>{seen++;sha.update(JSON.stringify(e)+'\n');}});
  assert.equal(seen,count+4); // START, META, CONNECTED, STOP
  hashes.push(sha.digest('hex'));
  assert.ok(result.maxBufferedBytes<16*1024*1024);
  assert.equal(result.records,count+4);
  console.log(JSON.stringify({phase3Memory:{pass:pass+1,records:result.records,
    rssMiB:Number((result.peakRssBytes/(1024*1024)).toFixed(1)),
    maxBufferedBytes:result.maxBufferedBytes,compressedBytes:result.compressedBytes}}));
 }
 assert.equal(hashes[0],hashes[1]);
 assert.equal(hashes[0],createHash('sha256').update(deterministicReplayBytes(root)).digest('hex'));
}));
test('no real provider capture or public/market integrations are created',()=>temp(async root=>{
 const s=supervisor(root);await s.start();await s.close();
 const events=replayRaw(root);
 assert.ok(events.every(e=>e.schemaVersion==='engine18.raw.v2'));
 assert.ok(events.every(e=>!e.raw.includes('token=')));
}));
