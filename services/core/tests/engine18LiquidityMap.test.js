import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiquidityMap,referenceCandidates,profileCandidates,provenCandidates} from '../logic/engine18/engine18LiquidityMap.js';

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
