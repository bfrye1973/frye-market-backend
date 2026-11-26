import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiquidityMap,referenceCandidates,profileCandidates,provenCandidates,sweepCandidates,
 parseOwnerZones,ownerZoneCandidates,zonesContaining} from '../logic/engine18/engine18LiquidityMap.js';

const T=1795630000;

test('a single source never draws a line (>=2 distinct sources required)',()=>{
 const m=createLiquidityMap();m.add('REFERENCE',{price:7150,label:'ROUND_50',t:T});
 const r=m.evaluate({t:T,price:7200});assert.equal(r.drawn.length,0);assert.equal(r.noLineReason,'NO_LEVEL_WITH_AGREEING_SOURCES');
});

test('two agreeing sources draw a fixed-price line; anchor never moves when more evidence attaches',()=>{
 const m=createLiquidityMap();
 m.add('REFERENCE',{price:7150,label:'ROUND_50',t:T});
 m.add('PROVEN',{price:7151.5,label:'FLOOR_DEFENDED',t:T}); // within 2 pts -> attaches, does not move
 const r=m.evaluate({t:T,price:7200});
 assert.equal(r.drawn.length,1);assert.equal(r.drawn[0].price,7150);assert.equal(r.drawn[0].id,'L28600');
 assert.equal(r.drawn[0].side,'BUY');assert.deepEqual(r.drawn[0].sourceTypes.sort(),['PROVEN','REFERENCE']);
 // price moves; the line stays at 7150
 const r2=m.evaluate({t:T+600,price:7180});assert.equal(r2.drawn[0].price,7150);assert.equal(r2.drawn[0].id,'L28600');
});

test('anti-following: nothing drawn within minDistancePts of price',()=>{
 const m=createLiquidityMap({minDistancePts:8});
 m.add('REFERENCE',{price:7195,label:'X',t:T});m.add('PROVEN',{price:7195,label:'FLOOR_DEFENDED',t:T});
 const r=m.evaluate({t:T,price:7200});assert.equal(r.drawn.length,0);assert.equal(r.noLineReason,'QUALIFIED_LEVELS_TOO_CLOSE_TO_PRICE');
});

test('max 2 per side, ranked by agreeing sources then distance; zero is valid',()=>{
 const m=createLiquidityMap();
 for(const [p,types] of [[7100,['REFERENCE','PROFILE','PROVEN']],[7150,['REFERENCE','PROFILE']],[7120,['PROFILE','PROVEN']],[7250,['REFERENCE','PROFILE']]])
  for(const ty of types)m.add(ty,{price:p,label:ty,t:T});
 const r=m.evaluate({t:T,price:7200});
 const buys=r.drawn.filter(x=>x.side==='BUY').map(x=>x.price);
 assert.deepEqual(buys,[7100,7150]);assert.equal(r.drawn.filter(x=>x.side==='SELL').length,1);
 assert.equal(createLiquidityMap().evaluate({t:T,price:7200}).drawn.length,0);
});

test('stale book evidence stops counting (never shown as current)',()=>{
 const m=createLiquidityMap();
 m.add('BOOK',{price:7150,label:'RESTING_BUY_1800',t:T});m.add('REFERENCE',{price:7150,label:'ROUND_50',t:T});
 assert.equal(m.evaluate({t:T+30,price:7200}).drawn.length,1);
 const r=m.evaluate({t:T+120,price:7200});assert.equal(r.drawn.length,0);
});

test('no lookahead: evidence cannot be added before the last evaluation time',()=>{
 const m=createLiquidityMap();m.evaluate({t:T,price:7200});
 assert.throws(()=>m.add('REFERENCE',{price:7150,label:'X',t:T-1}),/past/);
});

test('air pockets between price and a drawn level are reported',()=>{
 const m=createLiquidityMap();m.add('REFERENCE',{price:7150,label:'R',t:T});m.add('PROFILE',{price:7150,label:'HVN',t:T});
 const r=m.evaluate({t:T,price:7200,airPockets:[{lo:7160,hi:7175},{lo:7300,hi:7310}]});
 assert.deepEqual(r.drawn[0].airPocketsBetween,[{lo:7160,hi:7175}]);
});

test('producers: reference, profile (with air pockets) and proven levels',()=>{
 const ref=referenceCandidates({t:T,price:7205,sessionOpen:7059.75});
 assert.ok(ref.some(x=>x.price===7200)&&ref.some(x=>x.label==='SESSION_OPEN'));
 const mins=[];for(let i=0;i<60;i++){const p=i<30?7000+(i%5):7040+(i%5);mins.push({t:T+i*60,o:p,h:p+1,l:p,c:p,v:i<30?5000:4000})}
 mins.push({t:T+3600,o:7020,h:7022,l:7018,c:7020,v:50});
 const pc=profileCandidates(mins,{t:T+3700,rows:60});
 assert.ok(pc.profile&&pc.candidates.some(x=>x.label==='POC'));assert.ok(pc.airPockets.length>=1,'thin area between the two shelves');
 const pv=provenCandidates({t:T,reads:[{type:'CEILING_DEFENDED',level:7211,evidence:{touches:[1,2,3]}}]});
 assert.equal(pv[0].label,'CEILING_DEFENDED');assert.equal(pv[0].state,'DEFENDED');
});

test('replay checkpoints: point-in-time map with fixed lines and RTH-only profile',async()=>{
 const {replayLiquidityMap,encodeSecondBarReplay}=await import('../logic/engine18/engine18RithmicPaperHistoryReplay.js');
 const {decodeFields}=await import('../logic/engine18/engine18RithmicTestProbe.js');
 assert.equal(decodeFields(encodeSecondBarReplay({symbol:'ESZ6',exchange:'CME',start:1,end:2,barUnit:'MINUTE'}))[119200][0],2);
 const T0=1795617000;const mins=[];
 for(let i=0;i<180;i++){const p=i<90?7000+(i%8):7100+(i%8);mins.push({t:T0+i*60,o:p,h:p+2,l:p-2,c:p,v:3000,buyAtAsk:1500,sellAtBid:1500})}
 const cps=replayLiquidityMap(mins,{everyMin:30});
 assert.ok(cps.length>=3);
 for(const cp of cps){assert.ok(cp.lines.length<=4);for(const l of cp.lines){assert.ok(l.strength>=2);assert.ok(Math.abs(l.price-cp.price)>=8)}}
});

test('profile evidence must be refreshed (stale profile nodes stop counting)',()=>{
 const m=createLiquidityMap();m.add('PROFILE',{price:7150,label:'HVN',t:T});m.add('REFERENCE',{price:7150,label:'R',t:T});
 assert.equal(m.evaluate({t:T+100,price:7200}).drawn.length,1);assert.equal(m.evaluate({t:T+400,price:7200}).drawn.length,0);
});

// ---- step 3: sweep events + owner zones ----
const sweepDay=()=>{const T0=1795617000;const mins=[];let p=7015;
 for(let i=0;i<180;i++){let o=p,h,l,c;
  if(i<15){c=7015-i*0.5;h=Math.max(o,c)+1;l=Math.min(o,c)-1}
  else if(i<17){c=6995;h=7001;l=6992}          // sweep below 7000
  else if(i===17){c=7003;h=7004;l=6996}        // close back above
  else if(i===18){c=7004;h=7005;l=7001}        // hold above -> reclaimed
  else{c=Math.min(7100,7004+(i-18)*1.5);h=c+1;l=c-1}
  mins.push({t:T0+i*60,o,h,l,c,v:3000,buyAtAsk:i>=15&&i<17?2000:1500,sellAtBid:i>=15&&i<17?1000:1500});p=c}
 return mins};

test('sweepCandidates: reclaimed sweep becomes PROVEN at the fixed level; break becomes a flip level',()=>{
 const ev=[{level:7000,side:'SUPPORT',penetration:8,classification:'SWEEP_RECLAIMED',
   history:[{state:'APPROACHING',t:T},{state:'RECLAIMED',t:T+300,at:'x',evidence:{deltaWhileBeyond:1441}}]},
  {level:7188,side:'SUPPORT',penetration:4,classification:'ACCEPTED_BEYOND',history:[{state:'ACCEPTED_BEYOND',t:T+400,evidence:{}}]},
  {level:7150,side:'SUPPORT',classification:null,history:[]}];
 const c=sweepCandidates(ev);assert.equal(c.length,2);
 assert.equal(c[0].label,'SWEEP_RECLAIMED_SUPPORT');assert.equal(c[0].state,'SWEPT_AND_HELD');assert.equal(c[0].detail.deltaWhileBeyond,1441);
 assert.equal(c[1].state,'BROKEN_FLIP');
 assert.equal(sweepCandidates(ev,{since:T+300}).length,1); // no double counting
 const m=createLiquidityMap();m.add('REFERENCE',{price:7000,label:'ROUND_50',t:T});m.add('PROVEN',c[0]);
 const r=m.evaluate({t:T+600,price:7100});assert.equal(r.drawn[0].price,7000);assert.equal(r.drawn[0].state,'SWEPT_AND_HELD');
});

test('replay: 7000 sweep-and-reclaim keeps 7000 on the map after price runs away',async()=>{
 const {replayLiquidityMap}=await import('../logic/engine18/engine18RithmicPaperHistoryReplay.js');
 const cps=replayLiquidityMap(sweepDay(),{everyMin:30});
 assert.ok(cps.sweepEvents.some(e=>e.level===7000&&e.classification==='SWEEP_RECLAIMED'));
 const last=cps.at(-1);assert.ok(last.price>=7090);
 const l=last.lines.find(x=>x.price===7000);assert.ok(l,'7000 still drawn');
 assert.equal(l.side,'BUY');assert.ok(l.labels.includes('SWEEP_RECLAIMED_SUPPORT'));
 for(const cp of cps)for(const x of cp.lines)assert.ok(Math.abs(x.price-cp.price)>=8);
});

test('owner zones: parse file format, edges are evidence, zones are context, nothing is moved',()=>{
 const z=parseOwnerZones('7487.25-7541.00 | NEG 7501.25-7525.00 # main buy fill\n   | NEG 7050.10-7020.00  \n# note\njunk');
 assert.deepEqual(z,[{kind:'PARENT',lo:7487.25,hi:7541},{kind:'NEG',lo:7501.25,hi:7525},{kind:'NEG',lo:7020,hi:7050}]);
 const m=createLiquidityMap();for(const c of ownerZoneCandidates(z,{t:T}))m.add('OWNER_ZONE',c);
 m.add('REFERENCE',{price:7050,label:'ROUND_50',t:T});
 const r=m.evaluate({t:T,price:7100});assert.equal(r.drawn.length,1);assert.equal(r.drawn[0].price,7050);
 assert.deepEqual(r.drawn[0].sourceTypes.sort(),['OWNER_ZONE','REFERENCE']);
 assert.deepEqual(zonesContaining(z,7510),['PARENT 7487.25-7541','NEG 7501.25-7525']);
});

test('broken level: proof from before the break stops counting; it is marked, never strengthened',()=>{
 const m=createLiquidityMap();
 m.add('REFERENCE',{price:7188,label:'X',t:T});m.add('PROVEN',{price:7188,label:'FLOOR_DEFENDED',t:T,state:'DEFENDED'});
 assert.equal(m.evaluate({t:T+10,price:7210}).drawn.length,1);
 m.markBroken({price:7188,label:'BROKEN_SUPPORT',t:T+20});
 const r=m.evaluate({t:T+30,price:7170});assert.equal(r.drawn.length,0);
 // a NEW defense after the break (flip retest from below) counts again
 m.add('PROVEN',{price:7188,label:'CEILING_DEFENDED',t:T+40,state:'DEFENDED'});
 const r2=m.evaluate({t:T+50,price:7170});assert.equal(r2.drawn.length,1);assert.equal(r2.drawn[0].side,'SELL');
});
