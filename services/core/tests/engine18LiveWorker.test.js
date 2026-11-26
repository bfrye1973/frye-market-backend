import test from 'node:test';
import assert from 'node:assert/strict';
import {createMinuteBuilder,createLiveCore,createLiveWorker} from '../logic/engine18/engine18LiveWorker.js';
import {replayLiquidityMap} from '../logic/engine18/engine18RithmicPaperHistoryReplay.js';
import {parseOwnerZones} from '../logic/engine18/engine18LiquidityMap.js';

const T0=1795617000; // 14:30 UTC (RTH open), synthetic
// Synthetic Case-001-shaped day: drift to 7000, sweep to 6992, reclaim, run to 7100 (no licensed data).
const sweepDay=(n=180)=>{const mins=[];let p=7015;
 for(let i=0;i<n;i++){let o=p,h,l,c;
  if(i<15){c=7015-i*0.5;h=Math.max(o,c)+1;l=Math.min(o,c)-1}
  else if(i<17){c=6995;h=7001;l=6992}
  else if(i===17){c=7003;h=7004;l=6996}
  else if(i===18){c=7004;h=7005;l=7001}
  else{c=Math.min(7100,7004+(i-18)*1.5);h=c+1;l=c-1}
  mins.push({t:T0+i*60,o,h,l,c,v:3000,buyAtAsk:i>=15&&i<17?2000:1500,sellAtBid:i>=15&&i<17?1000:1500});p=c}
 return mins};
const parity={evaluateEveryMin:30,profileEveryMin:30,profileSession:'RTH',profileWarmStart:false};

test('minute builder: real trades only, aggressor split, snapshot skipped, unknown aggressor via BBO, tick closes',()=>{
 const b=createMinuteBuilder();const us=s=>(T0+s)*1e6;
 assert.deepEqual(b.ingest({kind:'BBO',presence:3,bid:7000,ask:7000.25,ts:us(0)}),[]);
 b.ingest({kind:'TRADE',presence:1,snapshot:true,price:7000,size:9,aggressor:1,ts:us(1)});      // snapshot: skipped
 b.ingest({kind:'TRADE',presence:2,price:7000,size:9,aggressor:1,ts:us(1)});                    // not a trade
 b.ingest({kind:'TRADE',presence:null,price:7000,size:9,aggressor:1,ts:us(1)});                 // unknown presence
 b.ingest({kind:'TRADE',presence:1,price:7000.25,size:3,aggressor:1,ts:us(2)});
 b.ingest({kind:'TRADE',presence:1,price:7000,size:5,aggressor:2,ts:us(3)});
 b.ingest({kind:'TRADE',presence:1,price:7000.25,size:2,aggressor:null,ts:us(4)});              // at ask -> buyer
 const out=b.ingest({kind:'TRADE',presence:1,price:7001,size:1,aggressor:1,ts:us(61)});        // next minute closes prior
 assert.equal(out.length,1);
 assert.deepEqual(out[0],{t:T0,o:7000.25,h:7000.25,l:7000,c:7000.25,v:10,sellAtBid:5,buyAtAsk:5,trades:3});
 assert.equal(b.stats().skippedSnapshot,1);assert.equal(b.stats().unknownAggressor,1);
 assert.deepEqual(b.tick(T0+60+61),[]);assert.equal(b.tick(T0+120+2).length,1,'wall clock closes the open minute');
});

test('parity: live core with replay cadence draws the same lines as replayLiquidityMap',()=>{
 const mins=sweepDay();const zones=parseOwnerZones('7040.00-7060.00');
 const rep=replayLiquidityMap(mins,{everyMin:30,ownerZones:zones});
 const core=createLiveCore({...parity,ownerZones:zones});for(const m of mins)core.onMinute(m);
 const cps=core.checkpoints();assert.ok(cps.length>=4);
 for(const cp of cps){const r=rep.find(x=>x.time===cp.time);assert.ok(r,'replay has checkpoint '+cp.time);
  assert.deepEqual(cp.lines,r.lines,'lines differ at '+cp.time);assert.equal(cp.noLineReason,r.noLineReason)}
});

test('snapshot: 7000 card carries sweep history, owner full-body rule and invalidation; far levels show distance',()=>{
 const core=createLiveCore({profileSession:'RTH'});let s,at60;sweepDay().forEach((m,i)=>{s=core.onMinute(m);if(i===60)at60=s});
 assert.equal(s.schema,'engine18.live.v1');assert.equal(s.orderBook,'NOT_CONNECTED_V1');
 const c=s.lines.find(x=>x.price===7000);assert.ok(c,'7000 drawn');
 assert.equal(c.side,'BUY');assert.equal(c.state,'SWEPT_AND_HELD');
 assert.ok(c.defenseHistory.some(h=>h.type==='SWEEP_RECLAIMED_SUPPORT'));
 assert.match(c.invalidation,/full-body 1-min candle below 7000/);
 assert.ok(c.ownerBreakRule.fullBodyCloseBeyondAt,'minute 16 opened and closed below 7000');
 assert.equal(c.currentFlowRead,null);assert.match(c.currentFlowNote,/pts away/);
 assert.equal(at60.trend.lows,'RISING');assert.equal(s.trend.lows,'MIXED','flat at the end');assert.equal(s.last15.minutes.length,15);
 for(const l of s.lines)assert.ok(l.distancePts>=8);
 assert.ok(s.lines.filter(l=>l.side==='BUY').length<=2&&s.lines.filter(l=>l.side==='SELL').length<=2);
});

test('current read: no-defense warning fires and stays on the panel for the memory window',()=>{
 const core=createLiveCore();let p=7050,s;
 for(let i=0;i<60;i++){const c=p-(i>=50?3:0.25*(i%2?1:-1));s=core.onMinute({t:T0+i*60,o:p,h:Math.max(p,c)+0.5,l:Math.min(p,c)-0.5,c,v:1000,
  buyAtAsk:i>=50?700:500,sellAtBid:i>=50?300:500});p=c}
 assert.equal(s.currentRead.tone,'WARNING');assert.match(s.currentRead.type,/NO_DEFENSE/);
 assert.ok(s.currentRead.activeReads.length>=1);
});

test('all session hours: overnight minutes work; a halt gap starts a new session and arms prior-session high/low',()=>{
 const core=createLiveCore({profileSession:'SESSION'});const night=1795617000-12*3600; // 02:30 UTC
 let s;for(let i=0;i<40;i++)s=core.onMinute({t:night+i*60,o:7100,h:7101+(i===5?9:0),l:7099-(i===7?9:0),c:7100,v:100,buyAtAsk:50,sellAtBid:50});
 assert.equal(s.session.mode,'SESSION');assert.equal(s.session.minutes,40);assert.notEqual(s.noLineReason,undefined);
 const after=night+40*60+3600; // 1-hour halt
 s=core.onMinute({t:after,o:7100,h:7101,l:7099,c:7100,v:100,buyAtAsk:50,sellAtBid:50});
 assert.deepEqual([s.session.priorDay.high,s.session.priorDay.low],[7110,7090]);assert.equal(s.session.minutes,1);
});

test('worker end-to-end: parsed Rithmic messages -> minutes -> snapshot; strictly increasing guard',()=>{
 const w=createLiveWorker({profileSession:'SESSION'});let snap=null;
 for(let i=0;i<45;i++){const ts=(T0+i*60+5)*1e6;
  w.ingest({kind:'BBO',presence:3,bid:7000+i*0.25,ask:7000.25+i*0.25,ts});
  snap=w.ingest({kind:'TRADE',presence:1,price:7000+i*0.25,size:10,aggressor:i%2?1:2,ts})??snap}
 assert.ok(snap);assert.equal(snap.schema,'engine18.live.v1');assert.equal(w.stats().trades,45);
 assert.throws(()=>w.core.onMinute({t:T0,o:1,h:1,l:1,c:1,v:1,buyAtAsk:0,sellAtBid:0}),/increasing/);
});

test('runner + endpoint: OFF by default (404), GET only, warming-up then live snapshot; no sockets opened',async()=>{
 const {createLiveRunner,createLiveHttpHandler,LIVE_ENDPOINT_PATH,loadOwnerZones}=await import('../logic/engine18/engine18LiveRunner.js');
 assert.ok(Array.isArray(loadOwnerZones()));
 let tickFn=null;const r=createLiveRunner({workerParams:{ownerZones:[]},setIntervalImpl:f=>{tickFn=f;return 1},clearIntervalImpl:()=>{tickFn=null}});
 const res=()=>({code:null,body:null,writeHead(c){this.code=c},end(b){this.body=b??null}});
 const off=createLiveHttpHandler({getSnapshot:()=>r.snapshot(),env:{}});
 let x=res();assert.equal(off({url:LIVE_ENDPOINT_PATH,method:'GET'},x),true);assert.equal(x.code,404);
 assert.equal(off({url:'/other',method:'GET'},res()),false);
 const on=createLiveHttpHandler({getSnapshot:()=>r.snapshot(),getHealth:()=>r.health(),env:{ENGINE18_LIVE_ENDPOINT_ENABLED:'YES'}});
 x=res();on({url:LIVE_ENDPOINT_PATH,method:'POST'},x);assert.equal(x.code,405);
 x=res();on({url:LIVE_ENDPOINT_PATH,method:'GET'},x);assert.equal(JSON.parse(x.body).status,'WARMING_UP');
 r.start();assert.ok(tickFn);
 for(let i=0;i<3;i++)r.onMessage({kind:'TRADE',presence:1,price:7000,size:1,aggressor:1,ts:(T0+i*60)*1e6});
 x=res();on({url:LIVE_ENDPOINT_PATH+'?x=1',method:'GET'},x);const body=JSON.parse(x.body);
 assert.equal(body.status,'LIVE');assert.equal(body.snapshot.schema,'engine18.live.v1');assert.equal(body.health.messages,3);
 r.stop();assert.equal(tickFn,null);
});
