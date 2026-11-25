// Synthetic fixtures only (no vendor data in the repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlowReader} from '../logic/engine18/engine18FlowReader.js';

const T0=1795617000;let n=0;
const m=(o,c,{h=Math.max(o,c),l=Math.min(o,c),v=3000,delta=0}={})=>{
 const buy=Math.round((v+delta)/2);return {t:T0+60*(n++),o,h,l,c,v,buyAtAsk:buy,sellAtBid:v-buy}};
const feed=(r,ms)=>ms.map(x=>r.onMinute(x));
const types=s=>s.reads.map(x=>x.type);

test('ABSORPTION_BUYERS: price up while sellers aggressive in 2 of 3 minutes',()=>{
 n=0;const r=createFlowReader();
 const out=feed(r,[m(7000,7001),m(7001,7006.75,{delta:-196}),m(7006.75,7016,{delta:-693})]);
 assert.ok(types(out[2]).includes('ABSORPTION_BUYERS'));assert.ok(!types(out[1]).includes('ABSORPTION_BUYERS'));
});

test('NO_DEFENSE warning: price down while buyers aggressive (2 of 3), and single strong minute',()=>{
 n=0;const r=createFlowReader();
 const out=feed(r,[m(7210,7201.75,{delta:113}),m(7201.75,7195.25,{delta:193}),m(7195.5,7190.5,{delta:175})]);
 assert.ok(types(out[1]).includes('NO_DEFENSE'));
 n=0;const s=createFlowReader();
 const o2=feed(s,[m(7003.5,6990.5,{delta:871})]);assert.ok(types(o2[0]).includes('NO_DEFENSE'),'7:43-style strong minute');
});

test('no false divergence when flow agrees with price',()=>{
 n=0;const r=createFlowReader();
 const out=feed(r,[m(7000,7005,{delta:300}),m(7005,7010,{delta:400}),m(7010,7015,{delta:500})]);
 assert.ok(out.every(s=>!types(s).includes('ABSORPTION_BUYERS')&&!types(s).includes('NO_DEFENSE')));
});

test('CEILING_DEFENDED: repeated rejections at the same high, buyers aggressive into it',()=>{
 n=0;const r=createFlowReader();const ms=[];
 for(let i=0;i<4;i++){ms.push(m(7200,7206,{h:7210,delta:120}));ms.push(m(7206,7201,{h:7207}))}
 const out=feed(r,ms);const last=out.at(-1);
 const c=last.reads.find(x=>x.type==='CEILING_DEFENDED');assert.ok(c);assert.equal(c.level,7210);
 assert.ok(c.evidence.touches.length>=3);
});

test('QUIET_ACCUMULATION: quiet volume, rising lows by block, sellers aggressive, tight range',()=>{
 n=0;const r=createFlowReader();
 // 45-min busy baseline
 for(let i=0;i<45;i++)r.onMinute(m(7050-i,7049-i,{v:7000}));
 // 30-min quiet zone 7000-7040 with rising block lows and negative delta
 const lows=[7001.5,7004.5,7012.5];let last;
 for(let blk=0;blk<3;blk++)for(let i=0;i<10;i++){const lo=lows[blk];
  last=r.onMinute(m(lo+8,lo+10,{l:lo,h:lo+20,v:2500,delta:-60}))}
 const q=last.reads.find(x=>x.type==='QUIET_ACCUMULATION');assert.ok(q,JSON.stringify(last.reads));
 assert.ok(q.evidence.volumeRatio<=0.6);assert.deepEqual(q.evidence.lowsByBlock,lows);
 // breakout: hold above zone high for 3 minutes
 let b;for(let i=0;i<3;i++)b=r.onMinute(m(7041,7046+i,{l:7040.5,h:7050,v:5000,delta:200}));
 assert.ok(types(b).includes('ZONE_BREAKOUT_UP'),JSON.stringify(b.reads));
});

test('ABSORPTION_CLUSTER after repeated absorption minutes (9:16-9:22 shape)',()=>{
 n=0;const r=createFlowReader();let last;
 for(let i=0;i<5;i++)last=r.onMinute(m(7005+i*3,7008+i*3,{delta:-200}));
 assert.ok(types(last).includes('ABSORPTION_CLUSTER'),JSON.stringify(last.reads));
});

test('higher-low rule: window low early, last block holds above it (not a perfect staircase)',()=>{
 n=0;const r=createFlowReader();
 for(let i=0;i<45;i++)r.onMinute(m(7050,7049,{v:7000}));
 const lowsSeq=[7001.5,7013,7004.5];let last;
 for(let blk=0;blk<3;blk++)for(let i=0;i<10;i++){const lo=lowsSeq[blk];last=r.onMinute(m(lo+8,lo+10,{l:lo,h:7041,v:2700,delta:-40}))}
 const q=last.reads.find(x=>x.type==='QUIET_ACCUMULATION');assert.ok(q,JSON.stringify(last.reads));
});

test('not quiet -> no accumulation read even with rising lows',()=>{
 n=0;const r=createFlowReader();
 for(let i=0;i<45;i++)r.onMinute(m(7050,7049,{v:3000}));
 let last;for(let blk=0;blk<3;blk++)for(let i=0;i<10;i++)last=r.onMinute(m(7010+blk*3,7012+blk*3,{l:7005+blk*3,h:7025,v:3000,delta:-60}));
 assert.ok(!types(last).includes('QUIET_ACCUMULATION'));
});

test('point-in-time guards',()=>{
 n=0;const r=createFlowReader();r.onMinute(m(1,1));
 assert.throws(()=>r.onMinute({...m(1,1),t:T0}),/increasing/);
 assert.throws(()=>r.onMinute({t:T0+9999,o:1,h:1,l:1,c:NaN,v:1,sellAtBid:0,buyAtAsk:1}),/bad minute/);
});
