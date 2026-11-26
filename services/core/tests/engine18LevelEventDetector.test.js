import test from 'node:test';
import assert from 'node:assert/strict';
import {createLevelEventDetector,roundNumberLevels} from '../logic/engine18/engine18LevelEventDetector.js';

const T0=1795617000;
// path: array of [seconds, price]; linear interpolation, 1-second bars, buy/sell flow per segment
function bars(path,flow=()=>({bid:5,ask:5})){const out=[];
 for(let i=1;i<path.length;i++){const [t0,p0]=path[i-1],[t1,p1]=path[i];
  for(let t=t0+1;t<=t1;t++){const p=Math.round((p0+(p1-p0)*(t-t0)/(t1-t0))*4)/4;const f=flow(t,p);
   out.push({t:T0+t,o:p,h:p,l:p,c:p,v:f.bid+f.ask,...f})}}return out}
const run=(lv,bs,params)=>{const d=createLevelEventDetector(params);d.arm({...lv,armedAt:T0});for(const b of bs)d.onBar(b);return d.events()};

test('Case-001-shaped support sweep: penetration, held reclaim, outcomes recorded after',()=>{
 // 7030 -> 6982.5 (break at ~7000) -> back over 7000 within ~70s -> run to 7080
 const bs=bars([[0,7030],[600,7001],[720,6982.5],[790,7004],[900,7020],[5400,7080]],
  (t)=>t>600&&t<=720?{bid:4,ask:6}:t>720&&t<=790?{bid:6,ask:4}:{bid:5,ask:5});
 const [e]=run({id:'r7000',price:7000,side:'SUPPORT',source:'ROUND_50'},bs);
 assert.deepEqual(e.history.map(h=>h.state),['APPROACHING','PENETRATED','RECLAIM_PENDING','RECLAIMED']);
 assert.equal(e.classification,'SWEEP_RECLAIMED');assert.equal(e.penetration,17.5);
 const rec=e.history.at(-1).evidence;assert.ok(rec.deltaWhileBeyond>0,'price fell while aggressor delta was positive');
 assert.ok(e.outcomes['+10min']&&e.outcomes['+60min']);assert.ok(e.outcomes['+60min'].closeVsLevel>0);
});

test('genuine breakdown: stays beyond -> ACCEPTED_BEYOND (not called a sweep)',()=>{
 const bs=bars([[0,7010],[300,7000],[900,6960],[4800,6900]]);
 const [e]=run({id:'r7000',price:7000,side:'SUPPORT',source:'ROUND_50'},bs);
 assert.equal(e.classification,'ACCEPTED_BEYOND');assert.ok(!e.history.some(h=>h.state==='RECLAIMED'));
 assert.ok(e.outcomes['+30min'].closeVsLevel<0);
});

test('failed reclaim (pokes back, re-breaks inside hold window) returns to PENETRATED',()=>{
 const bs=bars([[0,7010],[200,6995],[230,7001],[240,6994],[900,6950],[5000,6950]]);
 const [e]=run({id:'r7000',price:7000,side:'SUPPORT',source:'ROUND_50'},bs,{reclaimHoldSec:60});
 const states=e.history.map(h=>h.state);
 assert.ok(states.includes('RECLAIM_PENDING'));assert.equal(states[states.indexOf('RECLAIM_PENDING')+1],'PENETRATED');
 assert.equal(e.classification,'ACCEPTED_BEYOND');
});

test('resistance mirror: sweep above and reclaim below',()=>{
 const bs=bars([[0,7140],[300,7150],[360,7162],[420,7148],[5000,7100]]);
 const [e]=run({id:'r7150',price:7150,side:'RESISTANCE',source:'ROUND_50'},bs);
 assert.equal(e.classification,'SWEEP_RECLAIMED');assert.equal(e.penetration,12);
 assert.ok(e.outcomes['+30min'].closeVsLevel>0,'favourable = back down for resistance');
});

test('no lookahead: levels cannot be armed in the past; bars before armedAt are ignored',()=>{
 const d=createLevelEventDetector();
 for(const b of bars([[0,7010],[100,6990]]))d.onBar(b);
 assert.throws(()=>d.arm({id:'late',price:7000,side:'SUPPORT',source:'X',armedAt:T0+50}),/past/);
 const d2=createLevelEventDetector();d2.arm({id:'a',price:7000,side:'SUPPORT',source:'X',armedAt:T0+200});
 for(const b of bars([[0,7010],[100,6990]]))d2.onBar(b);
 assert.equal(d2.events().length,0,'bars before arming produce no event');
 assert.throws(()=>d2.onBar({t:T0+1,o:1,h:1,l:1,c:1,v:0,bid:0,ask:0}),/increasing/);
});

test('round-number level source is point-in-time and side-aware',()=>{
 assert.deepEqual(roundNumberLevels(7012,{step:50,count:1}).map(l=>[l.price,l.side]),[[7000,'SUPPORT'],[7050,'RESISTANCE']]);
});

test('re-arm: after a sweep is classified, a second test is detected only after price leaves and comes back',()=>{
 // sweep 7000 and reclaim, rally away (>5 pts), later come back and break for real
 const bs=bars([[0,7010],[300,7001],[360,6994],[420,7003],[600,7030],[2400,7030],[2700,7002],[3000,6970],[7000,6950]]);
 const ev=run({id:'r7000',price:7000,side:'SUPPORT',source:'ROUND_50'},bs);
 assert.equal(ev.length,2);
 assert.equal(ev[0].classification,'SWEEP_RECLAIMED');assert.ok(ev[0].outcomes['+10min'],'first event outcomes still tracked');
 assert.equal(ev[1].classification,'ACCEPTED_BEYOND');assert.equal(ev[1].eventSeq,2);
 assert.ok(ev[1].history[0].t>ev[0].history.at(-1).t,'second event starts after the first was classified');
});

test('re-arm: no new event while price stays at the level (must leave first)',()=>{
 const bs=bars([[0,7010],[300,7001],[360,6994],[420,7003],[3000,7003]]);
 const ev=run({id:'r7000',price:7000,side:'SUPPORT',source:'ROUND_50'},bs);
 assert.equal(ev.length,1);
});

test('re-arm: a broken support is retested as resistance (side flips)',()=>{
 const bs=bars([[0,7010],[300,7000],[900,6960],[1500,6960],[1800,6998],[1830,7004],[1890,6996],[6000,6950]]);
 const ev=run({id:'r7000',price:7000,side:'SUPPORT',source:'ROUND_50'},bs);
 assert.equal(ev[0].classification,'ACCEPTED_BEYOND');
 assert.equal(ev[1].side,'RESISTANCE');assert.equal(ev[1].classification,'SWEEP_RECLAIMED');
});
