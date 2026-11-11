import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine18BufferedRecorder} from '../logic/engine18/engine18BufferedRecorder.js';
import {Engine18IronbeamLiveRecorderSource} from '../logic/engine18/engine18IronbeamLiveRecorderSource.js';
import {verifyEngine18LiveEnvironment} from '../logic/engine18/engine18ControlledLiveWorker.js';
import {createEngine18ReceiptClock} from '../logic/engine18/engine18ReceiptClock.js';
import {replayRaw,Engine18RawRecorder} from '../logic/engine18/gate1RawRecorder.js';
import {scanEngine18ReplayBounded} from '../logic/engine18/engine18BoundedReplayScan.js';
import {Engine18SyntheticArchiveBackup,MockPrivateEncryptedStore} from '../logic/engine18/engine18Phase4Backup.js';
import {randomBytes} from 'node:crypto';
import {verifyEngine18ControlledTrial} from '../logic/engine18/engine18ControlledTrialVerifier.js';

const temp=async fn=>{
 const root=mkdtempSync(join(tmpdir(),'e18-real-source-test-'));
 try{await fn(root);}finally{rmSync(root,{recursive:true,force:true});}
};
function fixture(){
 let stream=0;
 const sockets=[],requests=[];
 class FakeWebSocket {
  constructor(url){this.url=url;this.listeners={};this.closed=false;sockets.push(this);
   queueMicrotask(()=>this.emit('open'));
  }
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  emit(type,data,code){for(const cb of this.listeners[type]??[])cb({data,code});}
  close(){if(this.closed)return;this.closed=true;this.emit('close',null,1000);}
 }
 const fetchImpl=async (url,init)=>{
  requests.push({url,method:init.method});
  if(url.endsWith('/v2/auth'))return {ok:true,json:async()=>({token:'SENSITIVE_TEST_TOKEN'})};
  if(url.endsWith('/v2/stream/create'))return {ok:true,json:async()=>({streamId:'stream_'+(++stream)})};
  if(url.includes('/subscribe/'))return {ok:true,json:async()=>({status:'OK'})};
  throw Error('unexpected endpoint');
 };
 return {sockets,requests,fetchImpl,WebSocketImpl:FakeWebSocket};
}
function clock(){
 const base=BigInt(Date.parse('2026-11-11T20:00:00Z'))*1000000n;
 let n=0n;
 return {wallNs:()=>String(base+n*100000n),monoNs:()=>String(++n)};
}
test('default recorder remains SYNTHETIC only, explicit live provider opt-in required',()=>temp(async root=>{
 assert.rejects(Engine18RawRecorder.openBounded({root,clock:clock(),provider:'IRONBEAM_V2'}),
  /live raw collection disabled/);
 const recorder=await Engine18BufferedRecorder.openBounded({root,clock:clock(),
  provider:'IRONBEAM_V2',allowLiveProvider:true,batchSize:8,flushDelayMs:0});
 assert.equal(recorder.writer.provider,'IRONBEAM_V2');
 await recorder.close();
}));
test('independent read-only vendor source persists exact ES depth quote trade unknown malformed binary',()=>temp(async root=>{
 const io=fixture(),writer=await Engine18BufferedRecorder.openBounded({root,clock:clock(),
  provider:'IRONBEAM_V2',allowLiveProvider:true,batchSize:8,flushDelayMs:0});
 const alerts=[];
 const source=new Engine18IronbeamLiveRecorderSource({
  recorder:writer,fetchImpl:io.fetchImpl,WebSocketImpl:io.WebSocketImpl,
  credentials:{username:'MOCK',password:'MOCK',apiKey:'MOCK'},onAlert:c=>alerts.push(c),
  retryMs:2,maxRetryMs:20
 });
 await source.start();
 const ws=io.sockets[0];
 const raw=[
  ' { "d":[{"s":"XCME:ES.Z26","b":[{"p":7500.25,"sz":0,"l":0,"is":4,"ioc":2}],"a":[]}],"t":123 } ',
  '{"q":{"bid":"7500.2500","ask":"7500.5000"}}',
  '{"tr":[{"p":7500.25,"sz":3}]}',
  '{"unexpected":true}',
  '{malformed'
 ];
 for(const data of raw)ws.emit('message',data);
 const binary=Buffer.from([0,255,127,13,10,0]);
 ws.emit('message',binary);
 await source.stop();await writer.close();
 const records=replayRaw(root),markets=records.filter(e=>e.msgClass!=='control');
 assert.deepEqual(markets.slice(0,5).map(x=>x.raw),raw);
 assert.deepEqual(Buffer.from(markets[5].raw,'base64'),binary);
 assert.ok(markets.every(x=>x.streamGeneration===1));
 assert.ok(markets.every(x=>x.receivedMonoNs&&x.receivedWallNs&&x.runId));
 assert.deepEqual(records.filter(e=>e.statusCode==='SUBSCRIPTION_ACK').map(e=>JSON.parse(e.raw).status),
  ['SUCCESS','SUCCESS','SUCCESS']);
 assert.equal(records.filter(e=>e.statusCode==='CONNECTED').length,1);
 assert.equal(records.filter(e=>e.statusCode==='RECORDER_STOP').length,1);
 assert.ok(!JSON.stringify(records).includes('SENSITIVE_TEST_TOKEN'));
 const twice=await Promise.all([scanEngine18ReplayBounded(root),scanEngine18ReplayBounded(root)]);
 assert.equal(twice[0].lastSeq,twice[1].lastSeq);
 assert.equal(source.health().framesReceived,6);
 assert.deepEqual([source.health().frameTypes.depth,source.health().frameTypes.quote,
  source.health().frameTypes.trade,source.health().frameTypes.unknown,
  source.health().frameTypes.malformed,source.health().frameTypes.binary],[1,1,1,1,2,1]);
 assert.equal(alerts.length,0);
}));
test('real-source worker source reconnects, preserves generation and FEED_GAP without old-stream misattribution',()=>temp(async root=>{
 const io=fixture(),writer=await Engine18BufferedRecorder.openBounded({root,clock:clock(),
  provider:'IRONBEAM_V2',allowLiveProvider:true,batchSize:4,flushDelayMs:0});
 const source=new Engine18IronbeamLiveRecorderSource({
  recorder:writer,fetchImpl:io.fetchImpl,WebSocketImpl:io.WebSocketImpl,
  credentials:{username:'MOCK',password:'MOCK',apiKey:'MOCK'},retryMs:2,maxRetryMs:10
 });
 await source.start();
 io.sockets[0].emit('message','{"d":[{"s":"XCME:ES.Z26"}]}');
 io.sockets[0].emit('error');
 for(let tries=0;tries<60&&io.sockets.length<2;tries++)await new Promise(r=>setTimeout(r,5));
 assert.equal(io.sockets.length,2,'source should reconnect in isolated worker');
 await new Promise(r=>setTimeout(r,15));
 io.sockets[0].emit('message','{"stale":true}');
 io.sockets[1].emit('message','{"tr":[{"p":7501.00,"sz":1}]}');
 await source.stop();await writer.close();
 const entries=replayRaw(root),markets=entries.filter(e=>e.msgClass==='market');
 assert.equal(markets.length,2);
 assert.deepEqual(markets.map(e=>e.streamGeneration),[1,2]);
 assert.equal(entries.filter(e=>e.statusCode==='RECONNECT').length,1);
 assert.equal(entries.filter(e=>e.statusCode==='FEED_GAP').length,1);
 assert.equal(entries.filter(e=>e.statusCode==='SUBSCRIPTION_ACK').length,6);
 assert.equal(source.health().reconnects,1);
}));
test('source fails closed if recording cannot acknowledge; private alert has no raw payload',()=>temp(async root=>{
 const io=fixture(),alerts=[];
 let offers=0,failed=false;
 const writer={offer:()=>{offers++;return Promise.resolve({receivedWallNs:'123'});},
  capture:args=>Object.freeze({...args,receivedWallNs:'123',receivedMonoNs:'456'}),
  offerCaptured:()=>{offers++;return offers>1?Promise.reject(Error('secret vendor payload')):Promise.resolve({receivedWallNs:'123'});},
  fail:()=>{failed=true;}};
 const source=new Engine18IronbeamLiveRecorderSource({
  recorder:writer,fetchImpl:io.fetchImpl,WebSocketImpl:io.WebSocketImpl,
  credentials:{username:'MOCK',password:'MOCK',apiKey:'MOCK'},onAlert:c=>alerts.push(c)
 });
 await source.start();
 io.sockets[0].emit('message','SENSITIVE_MARKET_PAYLOAD');
 await new Promise(r=>setTimeout(r,20));
 assert.ok(failed);assert.ok(source.health().captureUncertain);
 assert.ok(alerts.every(x=>!x.includes('SENSITIVE_MARKET_PAYLOAD')));
 await source.stop();
}));
test('live entrypoint remains disabled with no operational keys; trial cannot touch production disk',()=>{
 assert.throws(()=>verifyEngine18LiveEnvironment({}),/missing environment requirements/);
 const env=Object.fromEntries([
  'IRONBEAM_USERNAME','IRONBEAM_PASSWORD','IRONBEAM_API_KEY',
  'ENGINE18_RECORDER_DISK','ENGINE18_R2_ENDPOINT','ENGINE18_R2_BUCKET',
  'ENGINE18_R2_ACCESS_KEY','ENGINE18_R2_SECRET_KEY','ENGINE18_R2_ENCRYPTION_KEY_HEX',
  'ENGINE18_R2_KEY_ID','ENGINE18_INDEPENDENT_INVENTORY_PIN','ENGINE18_CME_CALENDAR_VERIFIED'
 ].map(k=>[k,'FAKE']));
 env.ENGINE18_LIVE_CAPTURE_APPROVED='YES';
 env.ENGINE18_MANAGER_TRIAL_ACCEPTED='YES';
 env.ENGINE18_CME_CALENDAR_VERIFIED='YES';
 env.ENGINE18_RECORDER_DISK='/var/data/replay';
 assert.throws(()=>verifyEngine18LiveEnvironment(env),/refusing shared or non-private/);
});

test('private end-of-trial full backup restore matches source byte-for-byte and reports only sanitized counts',()=>temp(async root=>{
 const writer=await Engine18BufferedRecorder.openBounded({root,clock:clock(),
  provider:'IRONBEAM_V2',allowLiveProvider:true,batchSize:8,flushDelayMs:0});
 const inputs=['{"d":[{"s":"XCME:ES.Z26","b":[{"sz":0,"l":0}],"a":[]}]}',
  '{"q":{"bid":"7500.2500"}}','{"tr":[{"p":7500.2500,"sz":3}]}','{malformed'];
 for(const raw of inputs)await writer.offer({raw,msgClass:'market'});
 await writer.offer({raw:Buffer.from([0,255,4]),rawEncoding:'base64',msgClass:'unknown'});
 await writer.offer({raw:'',msgClass:'control',statusCode:'FEED_GAP'});
 await writer.close();
 const store=new MockPrivateEncryptedStore({key:randomBytes(32)});
 const backup=new Engine18SyntheticArchiveBackup({root,store});
 const uploaded=await backup.backupClosed();
 assert.equal(uploaded.lastSeq,writer.writer.seq);
 const restoredRoot=root+'-independent-restore';
 try{
  const verified=await verifyEngine18ControlledTrial({
   recorderRoot:root,restoredRoot,remoteCoordinator:backup,
   independentLastSeq:writer.writer.seq
  });
  assert.equal(verified.byteIdenticalReplay,true);
  assert.equal(verified.depth,1);assert.equal(verified.quote,1);
  assert.equal(verified.trade,1);assert.equal(verified.binary,1);
  assert.equal(verified.sourceGaps,1);
  assert.equal(verified.vendorDepthSemantics,'UNVERIFIED');
  assert.ok(!JSON.stringify(verified).includes('7500.2500'));
 }finally{rmSync(restoredRoot,{recursive:true,force:true});}
 await assert.rejects(verifyEngine18ControlledTrial({
  recorderRoot:root,restoredRoot:root+'-wrong-restore',remoteCoordinator:backup,
  independentLastSeq:writer.writer.seq+1
 }),/independently pinned/);
 rmSync(root+'-wrong-restore',{recursive:true,force:true});
}));

test('silent ES feed triggers supervised reconnect, private alert, and uncertain FEED_GAP',()=>temp(async root=>{
 const io=fixture(),writer=await Engine18BufferedRecorder.openBounded({root,clock:clock(),
  provider:'IRONBEAM_V2',allowLiveProvider:true,batchSize:8,flushDelayMs:0});
 const alerts=[];
 const source=new Engine18IronbeamLiveRecorderSource({
  recorder:writer,fetchImpl:io.fetchImpl,WebSocketImpl:io.WebSocketImpl,
  credentials:{username:'MOCK',password:'MOCK',apiKey:'MOCK'},
  heartbeatTimeoutMs:20,retryMs:2,maxRetryMs:10,onAlert:c=>alerts.push(c)
 });
 assert.equal(await source.start(),true);
 for(let i=0;i<70&&io.sockets.length<2;i++)await new Promise(r=>setTimeout(r,5));
 assert.ok(io.sockets.length>=2,'silent source must reconnect');
 await source.stop();await writer.close();
 const events=replayRaw(root);
 assert.ok(events.some(x=>x.statusCode==='FEED_GAP'));
 assert.ok(alerts.includes('IRONBEAM_SOURCE_STALE'));
 assert.ok(alerts.includes('IRONBEAM_SOURCE_INTERRUPTED'));
 assert.ok(events.every(x=>!x.raw.includes('SENSITIVE_TEST_TOKEN')));
}));
