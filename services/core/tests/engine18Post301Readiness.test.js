import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine18BufferedRecorder} from '../logic/engine18/engine18BufferedRecorder.js';
import {Engine18S3PrivateStore} from '../logic/engine18/engine18S3PrivateStore.js';
import {Engine18S3ArchiveCoordinator} from '../logic/engine18/engine18Phase5S3Coordinator.js';
import {Engine18SyntheticReadinessSupervisor} from '../logic/engine18/engine18Phase3Readiness.js';
import {createEngine18IronbeamV2RecorderRehearsal} from '../logic/engine18/engine18IronbeamV2RecorderRehearsal.js';
import {buildEngine18ReadOnlyContext} from '../logic/engine18/engine18ReadOnlyResearchContext.js';
import {replayRaw} from '../logic/engine18/gate1RawRecorder.js';

const withRoot=async fn=>{const root=mkdtempSync(join(tmpdir(),'e18-post301-'));try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const localClock=()=>{
 let now=Date.parse('2026-11-10T21:59:00Z'),mono=0n;
 return {wallNs:()=>String(BigInt(now)*1000000n),monoNs:()=>String(++mono),set:iso=>{now=Date.parse(iso);}};
};
const makeStore=root=>{
 const objects=new Map(),metrics={list:0,get:0,put:0},fetchImpl=async(url,request)=>{
  const id=url.pathname.replace(/^\/private-test\//,'');
  if(request.method==='PUT'){
   metrics.put++;
   if(objects.has(id))return new Response(null,{status:412});
   const parts=[];for await(const c of request.body)parts.push(Buffer.from(c));
   objects.set(id,Buffer.concat(parts));return new Response(null,{status:200});
  }
  if(request.method==='GET'&&url.searchParams.has('list-type')){
   metrics.list++;
   const prefix=url.searchParams.get('prefix')||'';
   const items=[...objects.keys()].filter(k=>k.startsWith(prefix)).sort();
   return new Response('<ListBucketResult><IsTruncated>false</IsTruncated>'+
    items.map(k=>'<Contents><Key>'+k+'</Key></Contents>').join('')+'</ListBucketResult>',{status:200});
  }
  if(request.method==='GET'){
   metrics.get++;
   return objects.has(id)?new Response(objects.get(id),{status:200}):new Response(null,{status:404});
  }
  throw Error('unexpected synthetic operation');
 };
 const store=new Engine18S3PrivateStore({endpoint:'https://synthetic.s3.example',bucket:'private-test',
  region:'auto',accessKeyId:'SYNTHETIC',secretAccessKey:'SYNTHETICSECRET',
  keyId:'synthetic-key-v1',encryptionKey:randomBytes(32),fetchImpl,stagingRoot:root});
 return {store,objects,metrics};
};

test('normal scans avoid remote inventory downloads; only new immutable entry verified',()=>withRoot(async root=>{
 const {store,metrics}=makeStore(root),clock=localClock();
 let ms=0;const coordinator=new Engine18S3ArchiveCoordinator({root,store,reconcileIntervalMs:5000,now:()=>ms});
 const rec=new Engine18BufferedRecorder({root,clock,batchSize:4,flushDelayMs:0});
 await rec.offer({raw:'one',msgClass:'market',at:new Date('2026-11-10T21:59:05Z')});
 clock.set('2026-11-10T22:00:00Z');
 await rec.offer({raw:'two',msgClass:'market',at:new Date('2026-11-10T22:00:00Z')});
 const first=await coordinator.syncClosed();assert.equal(first.added,1);assert.equal(metrics.list,1);
 const getBefore=metrics.get;
 await coordinator.syncClosed();await coordinator.syncClosed();
 assert.equal(metrics.list,1);assert.equal(metrics.get,getBefore);
 clock.set('2026-11-10T23:00:00Z');
 await rec.offer({raw:'three',msgClass:'market',at:new Date('2026-11-10T23:00:00Z')});
 const second=await coordinator.syncClosed();
 assert.equal(second.added,1);assert.equal(metrics.list,1,'new hour must not trigger full listing');
 assert.equal(metrics.get,getBefore+1,'only new remote inventory entry authenticated');
 ms=5100;
 await coordinator.syncClosed();
 assert.equal(metrics.list,2,'periodic full reconciliation required');
 await rec.close();
 assert.equal(coordinator.health().fullReconciliations,2);
}));

test('restart reconciles full inventory and missing final chain fails at periodic scan or pinned restore',()=>withRoot(async root=>{
 const {store,objects,metrics}=makeStore(root),clock=localClock();let ms=0;
 const rec=new Engine18BufferedRecorder({root,clock,batchSize:4,flushDelayMs:0});
 await rec.offer({raw:'first',msgClass:'market',at:new Date('2026-11-10T21:59:00Z')});
 clock.set('2026-11-10T22:00:00Z');
 await rec.offer({raw:'second',msgClass:'market',at:new Date('2026-11-10T22:00:00Z')});
 clock.set('2026-11-10T22:01:00Z');await rec.close();
 const first=new Engine18S3ArchiveCoordinator({root,store,reconcileIntervalMs:1000,now:()=>ms});
 await first.syncClosed();
 const head=await first.inventory({forceFull:false});
 assert.equal(head.entries.length,2);
 const next=new Engine18S3ArchiveCoordinator({root,store,reconcileIntervalMs:1000,now:()=>ms});
 await next.syncClosed();assert.equal(next.health().fullReconciliations,1);
 const newest=head.entries.at(-1).key;
 objects.delete(newest);
 assert.equal((await next.inventory({forceFull:false})).lastSeq,head.lastSeq,
  'cached state is provisional until periodic reconciliation');
 ms=1100;
 await assert.rejects(next.syncClosed(),/private sealed-hour backup failed/);
 await assert.rejects(next.inventory({expectedLastSeq:head.lastSeq}),/high-watermark/);
 assert.ok(metrics.list>=3);
}));

test('isolated Ironbeam v2 synthetic connection records subscriptions, reconnects and original frames',()=>withRoot(async root=>{
 const clock=localClock(),supervisor=new Engine18SyntheticReadinessSupervisor({
  root,clock,metadata:{softwareVersion:'phase-rehearsal',gitCommit:'abc1234567',
   physicalContract:'XCME:ES.Z26',contractMapping:'XCME:ES.Z26',
   clockSource:'UNVERIFIED',clockConfiguration:'MONOTONIC_UNVERIFIED'}
 });
 await supervisor.start();
 const sockets=[],requests=[];
 class FakeSocket{
  constructor(url){this.url=url;this.events={};sockets.push(this);}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  emit(k,data,code){for(const cb of this.events[k]??[])cb({data,code});}
  close(){this.emit('close',null,1000);}
 }
 let stream=0;
 const fetchImpl=async(url,request)=>{
  requests.push({url,method:request.method});
  if(url.endsWith('/v2/auth')){
   assert.equal(request.method,'POST');
   return {ok:true,json:async()=>({token:'DO_NOT_STORE_TEST_TOKEN'})};
  }
  if(url.endsWith('/v2/stream/create'))return {ok:true,json:async()=>({streamId:'s'+(++stream)})};
  if(url.includes('/subscribe/'))return {ok:true,json:async()=>({status:'OK'})};
  throw Error('wrong synthetic endpoint');
 };
 assert.throws(()=>createEngine18IronbeamV2RecorderRehearsal({supervisor,fetchImpl,WebSocketImpl:FakeSocket,endpoint:'https://demo.ironbeamapi.com'}),/disabled/);
 const session=createEngine18IronbeamV2RecorderRehearsal({supervisor,fetchImpl,WebSocketImpl:FakeSocket});
 const a=await session.connect();
 const depth=' { "d":[{"s":"XCME:ES.Z26","b":[{"sz":0,"l":0}],"a":[]}], "vendor":"unverified" } ';
 a.socket.emit('message',depth);
 const b=await session.connect();
 a.socket.emit('message','{"old_connection":true}');
 const binary=Buffer.from([0,255,13,10]);
 b.socket.emit('message',binary);
 a.socket.emit('error');
 await session.drain();await supervisor.close();
 const events=replayRaw(root);
 const frames=events.filter(x=>x.msgClass==='unknown');
 assert.deepEqual(frames.map(x=>x.rawEncoding),['utf8','utf8','base64']);
 assert.deepEqual(frames.map(x=>x.streamGeneration),[a.generation,a.generation,b.generation]);
 assert.deepEqual(frames.slice(0,2).map(x=>x.raw),[depth,'{"old_connection":true}']);
 assert.deepEqual(Buffer.from(frames[2].raw,'base64'),binary);
 const subscriptions=events.filter(x=>x.statusCode==='SUBSCRIPTION_ACK');
 assert.equal(subscriptions.length,6);
 assert.ok(subscriptions.every(x=>!x.raw.includes('DO_NOT_STORE_TEST_TOKEN')));
 assert.ok(JSON.stringify(events).includes('FEED_GAP'));
 assert.equal(session.status().feedSemantics,'UNVERIFIED');
 assert.ok(requests.filter(x=>x.url.includes('/subscribe/')).length===6);
 assert.ok(!JSON.stringify(events).includes('DO_NOT_STORE_TEST_TOKEN'));
}));
test('read-only context retains approved source values but refuses missing point-in-time evidence',()=>{
 const institutionalResponse={structures_sticky:[{details:{id:'original-id'},high:7492.25,low:7490.00,status:'LOCKED'}]};
 const strategySnapshot={strategies:{'intraday_scalp@10m':{engine22WaveStrategy:{
  fingerprint:'owner-approved-fingerprint',
  currentWavelength:{degrees:{micro:{target:7625,ratio:1.618},submicro:{target:7475.25,ratio:0.618}}},
  workingWaveNodes:{schemaVersion:'engine22.workingWaveNodes.v1',revision:'approved-1'}
 }}}};
 const packet=buildEngine18ReadOnlyContext({institutionalResponse,strategySnapshot});
 assert.equal(packet.usableForChronologicalResearch,false);
 assert.equal(packet.bookLiquidity,null);
 const accepted=buildEngine18ReadOnlyContext({institutionalResponse,strategySnapshot,
  institutionalAvailableAt:'2026-11-10T12:00:00Z',strategyAvailableAt:'2026-11-10T12:00:00Z',
  priceBasisStatus:'MATCHED'});
 assert.equal(accepted.usableForChronologicalResearch,true);
 const hindsight=buildEngine18ReadOnlyContext({institutionalResponse,strategySnapshot,
  institutionalAvailableAt:'2026-11-11T12:00:00Z',strategyAvailableAt:'2026-11-11T12:00:00Z',
  asOfTime:'2026-11-10T12:00:00Z',priceBasisStatus:'MATCHED'});
 assert.equal(hindsight.usableForChronologicalResearch,false,'never leak future strategy card revisions');
 assert.equal(accepted.micro.target,7625);
 assert.equal(accepted.submicro.target,7475.25);
 institutionalResponse.structures_sticky[0].high=0;
 assert.equal(accepted.institutionalZones[0].high,7492.25);
 assert.throws(()=>buildEngine18ReadOnlyContext({physicalContract:'SPY'}),/ES source/);
});
