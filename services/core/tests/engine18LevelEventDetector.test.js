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
