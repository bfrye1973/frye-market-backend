import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {analyzeLevelEvent,minuteTable,encodeSecondBarReplay,parseTimeBar,verifyHistoryEnvironment,
 runPaperHistoryReplay,HISTORY_SEND_ALLOWLIST} from '../logic/engine18/engine18RithmicPaperHistoryReplay.js';
import {decodeFields} from '../logic/engine18/engine18RithmicTestProbe.js';

const v=n=>{const b=[];do{const k=n%128;n=Math.floor(n/128);b.push(n?k|128:k)}while(n);return Buffer.from(b)};
const V=(f,x)=>Buffer.concat([v(f*8),v(x)]);
const S=(f,x)=>{const b=Buffer.from(x);return Buffer.concat([v(f*8+2),v(b.length),b])};
const D=(f,x)=>{const b=Buffer.alloc(8);b.writeDoubleLE(x,0);return Buffer.concat([v(f*8+1),b])};
const T0=1795621500; // 16:25:00Z
// Synthetic sweep: drift down to 7005, break to 6982.5, reclaim and run to 7140.
function sweepBars(){const bars=[];let p=7020;
 for(let i=1;i<=3600;i++){
  if(i<=600)p=7020-15*(i/600);            // 7020 -> 7005
  else if(i<=900)p=7005-22.5*((i-600)/300); // -> 6982.5 at i=900
  else if(i<=1200)p=6982.5+20*((i-900)/300); // -> 7002.5
  else p=7002.5+132.5*((i-1200)/2400);     // -> 7135
  const q=Math.round(p*4)/4;
  bars.push({t:T0+i,o:q,h:q+0.25,l:q,c:q,v:10,bid:i<=900?7:3,ask:i<=900?3:7,n:5})}
 bars[899].l=6982.5;return bars}

test('analysis: break, penetration, low, held reclaim, milestones, outcomes separated',()=>{
 const a=analyzeLevelEvent(sweepBars(),{level:7000,holdSec:60});
 assert.equal(a.ok,true);assert.equal(a.low.price,6982.5);
 const L=a.level;assert.equal(L.brokeBelow,true);assert.equal(L.penetrationPts,17.5);
 assert.ok(L.reclaim&&L.reclaim.secondsFromLow>0);
 assert.ok(L.milestonesAboveLevel['+100']);assert.equal(L.milestonesAboveLevel['+140'],null);
 assert.equal(typeof L.outcomeAfterReclaim['+10min'],'object');
 assert.ok(L.phases.penetrationToLow.sellAtBid>L.phases.penetrationToLow.buyAtAsk);
 assert.ok(L.phases.lowToReclaim.delta>0);
});

test('analysis: a breakdown that never reclaims reports reclaim null',()=>{
 const bars=Array.from({length:600},(_,i)=>{const q=7005-i*0.05;const p=Math.round(q*4)/4;return {t:T0+i+1,o:p,h:p,l:p,c:p,v:1,bid:1,ask:0,n:1}});
 const a=analyzeLevelEvent(bars,{level:7000});assert.equal(a.level.brokeBelow,true);assert.equal(a.level.reclaim,null);
});

test('analysis: brief poke above with immediate re-break is not a held reclaim',()=>{
 const bars=sweepBars();for(let i=1205;i<1215;i++){bars[i].l=6999.75}
 const a=analyzeLevelEvent(bars,{level:7000,holdSec:60});
 assert.ok(a.level.reclaim.secondsFromLow>=1215-900-60);
});

test('minute table aggregates buyer/seller-initiated volume',()=>{
 const m=minuteTable(sweepBars());assert.equal(m.length,60);assert.equal(m[0].v,600);
 assert.equal(m[0].delta,m[0].buyAtAsk-m[0].sellAtBid);
});

test('request is 202 SECOND_BAR x1 forwards; parser reads 203 bars and end marker',()=>{
 const f=decodeFields(encodeSecondBarReplay({symbol:'ESZ6',exchange:'CME',start:1,end:2}));
 assert.equal(f[154467][0],202);assert.equal(f[119200][0],1);assert.equal(f[119112][0],1);
 const bar=Buffer.concat([V(154467,203),S(132764,'0'),V(119100,T0),D(100019,7000),D(100012,7001),D(100013,6999),D(100021,7000.5),V(119110,40),V(119117,25),V(119118,15),V(119109,12)]);
 assert.deepEqual(parseTimeBar(bar),{final:false,rpCode:null,bar:{t:T0,o:7000,h:7001,l:6999,c:7000.5,v:40,bid:25,ask:15,n:12}});
 const end=parseTimeBar(Buffer.concat([V(154467,203),S(132766,'0')]));assert.equal(end.final,true);assert.equal(end.bar,null);
});

const ENV={RITHMIC_PAPER_CONNECT_ENABLED:'YES',RITHMIC_PAPER_HISTORY_ENABLED:'YES',RITHMIC_PAPER_USER:'pu',
 RITHMIC_PAPER_PASSWORD:'pp-secret',RITHMIC_PAPER_DISCOVERY_URI:'rprotocol-de.rithmic.com:443',
 RITHMIC_PAPER_GATEWAY_NAME:'Chicago Area',RITHMIC_PAPER_HISTORY_START:String(T0),
 RITHMIC_PAPER_HISTORY_END:String(T0+3600),RITHMIC_PAPER_HISTORY_LEVEL:'7000'};

test('config: own flag, bounded window, tick-valid level',()=>{
 assert.throws(()=>verifyHistoryEnvironment({...ENV,RITHMIC_PAPER_HISTORY_ENABLED:'NO'}),/disabled/);
 assert.throws(()=>verifyHistoryEnvironment({...ENV,RITHMIC_PAPER_HISTORY_END:String(T0+20000)}),/span/);
 assert.throws(()=>verifyHistoryEnvironment({...ENV,RITHMIC_PAPER_HISTORY_LEVEL:'7000.1'}),/tick/);
 assert.equal(verifyHistoryEnvironment(ENV).level,7000);
});

test('session: history-plant login, 202 replay, end marker, logout; analysis attached',async()=>{
 const sends=[];const PAPER='Rithmic Paper Trading',ok=S(132766,'0');
 class W extends EventEmitter{constructor(u){super();this.u=u;queueMicrotask(()=>this.emit('open'))}
  r(b){queueMicrotask(()=>this.emit('message',b))}
  send(b){const f=decodeFields(b),id=f[154467][0];sends.push({u:this.u,id,infra:f[153621]?.[0]});
   if(id===16)this.r(Buffer.concat([V(154467,17),ok,S(153628,PAPER)]));
   if(id===20)this.r(Buffer.concat([V(154467,21),ok,S(153628,PAPER),S(153640,'Chicago Area'),S(153641,'paper-chi.rithmic.com:443')]));
   if(id===10)this.r(Buffer.concat([V(154467,11),ok]));
   if(id===202){for(const x of sweepBars())this.r(Buffer.concat([V(154467,203),S(132764,'0'),V(119100,x.t),D(100019,x.o),D(100012,x.h),D(100013,x.l),D(100021,x.c),V(119110,x.v),V(119117,x.bid),V(119118,x.ask),V(119109,x.n)]));
    this.r(Buffer.concat([V(154467,203),ok]))}}
  close(){}terminate(){}}
 const r=await runPaperHistoryReplay({env:ENV,WebSocketImpl:W});
 assert.equal(r.stopReason,'REPLAY_COMPLETE');assert.equal(r.barsReceived,3600);
 assert.equal(sends.find(s=>s.id===10).infra,3);
 assert.ok(sends.every(s=>HISTORY_SEND_ALLOWLIST.includes(s.id)));
 assert.equal(r.analysis.level.penetrationPts,17.5);assert.equal(r.minutes.length,60);
 assert.ok(!JSON.stringify(r).includes('pp-secret'));
});
