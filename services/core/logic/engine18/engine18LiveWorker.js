// Engine 18 LIVE WORKER v1 (master plan §6c/§6d). Pure core: no sockets, no timers, no persistence.
// Input: Rithmic LastTrade/BBO messages as returned by parseInbound() (engine18RithmicPaperProbe.js).
// Output: a snapshot JSON for the real-time Engine 18 panel: the current read (warning/confirmation),
// fixed liquidity lines with level cards, the last 15 min of price vs flow, volume vs normal, the
// trend in lows/highs, and air pockets.
//
// Confirmation only. Never buy/sell instructions. Evidence counts are descriptive, not probabilities.
//
// Session hours: runs on every minute, overnight and Sunday open included (the owner trades all hours).
// Only two things need a session anchor:
//  - the volume profile and "session open" reference: profileSession 'SESSION' (default, live) uses the
//    CME session, anchored at the first minute after a gap of >= sessionGapMin (the daily halt / weekend);
//    'RTH' (parity with replayLiquidityMap) uses RTH minutes only;
//  - the flow reader's quiet-zone volume baseline keeps its own RTH rule (engine18FlowReader.js).
//
// Owner break rule (owner-locked): a level is broken only on a FULL-BODY 1-minute candle beyond it
// (open and close both beyond). ownerBreakRule (default true) drives the card text and an owner-rule
// status per level. Detector evidence (Track B) is unchanged.
import {createFlowReader} from './engine18FlowReader.js';
import {createLevelEventDetector} from './engine18LevelEventDetector.js';
import {createLiquidityMap,referenceCandidates,profileCandidates,provenCandidates,sweepCandidates,
 ownerZoneCandidates,zonesContaining} from './engine18LiquidityMap.js';

export const LIVE_DEFAULTS=Object.freeze({
 tick:0.25,
 evaluateEveryMin:1,       // map evaluation cadence (live). Parity with replay: 30.
 profileEveryMin:5,        // volume profile refresh cadence. Parity with replay: 30.
 profileMinMinutes:30,     // minutes of session data before a profile is used
 profileWarmStart:true,    // build the first profile as soon as there is enough data (live). Parity: false.
 profileSession:'SESSION', // 'SESSION' | 'RTH'
 rthOpenUtcMin:14*60+30,
 sessionGapMin:30,         // a gap this long starts a new session (daily halt, weekend)
 ownerBreakRule:true,
 cardNearPts:10,           // show the live flow read on a card when price is this close
 readMemoryMin:5,          // keep a read on the panel for this long after it fired
 historyPerLevel:10,
});
const mst=t=>new Date((t-7*3600)*1000).toISOString().slice(11,16);
const READ_KIND={
 NO_DEFENSE:['WARNING','BUY_SIDE'],NO_DEFENSE_CLUSTER:['WARNING','BUY_SIDE'],ZONE_BREAKDOWN:['WARNING','BUY_SIDE'],
 ABSORPTION_BUYERS:['CONFIRMATION','BUY_SIDE'],ABSORPTION_CLUSTER:['CONFIRMATION','BUY_SIDE'],
 QUIET_ACCUMULATION:['CONFIRMATION','BUY_SIDE'],FLOOR_DEFENDED:['CONFIRMATION','BUY_SIDE'],ZONE_BREAKOUT_UP:['CONFIRMATION','BUY_SIDE'],
 CEILING_DEFENDED:['CONFIRMATION','SELL_SIDE'],QUIET_DISTRIBUTION:['CONFIRMATION','SELL_SIDE'],
};
const PRIORITY=['NO_DEFENSE_CLUSTER','NO_DEFENSE','ZONE_BREAKDOWN','ZONE_BREAKOUT_UP','ABSORPTION_CLUSTER',
 'ABSORPTION_BUYERS','QUIET_ACCUMULATION','QUIET_DISTRIBUTION','CEILING_DEFENDED','FLOOR_DEFENDED'];

// ---------- 1-minute bars from LastTrade / BBO ----------
// Trades: only LastTrade with presence bit 1 (actual trade); snapshot trades excluded. Aggressor 1 = buyer
// (lifts the offer -> buyAtAsk), 2 = seller (hits the bid -> sellAtBid). Unknown aggressor: classified by
// price vs the latest BBO (>= ask buyer, <= bid seller), otherwise volume only. Minute = trade timestamp.
export function createMinuteBuilder({tick=0.25}={}){
 let cur=null,bid=null,ask=null,lastMinute=null;const stats={trades:0,unknownAggressor:0,unclassified:0,skippedSnapshot:0,lateTrades:0};
 const close=()=>{const m=cur;cur=null;lastMinute=m.t;return {t:m.t,o:m.o,h:m.h,l:m.l,c:m.c,v:m.v,sellAtBid:m.sellAtBid,buyAtAsk:m.buyAtAsk,trades:m.trades}};
 return {
  // Returns an array of completed minutes (usually empty or one).
  ingest(msg){
   const out=[];
   if(msg?.kind==='BBO'){
    if(msg.clear&1)bid=null;if(msg.clear&2)ask=null;
    if(msg.bid!=null&&(msg.presence==null||(msg.presence&1)))bid=msg.bid;
    if(msg.ask!=null&&(msg.presence==null||(msg.presence&2)))ask=msg.ask;
    return out;
   }
   if(msg?.kind!=='TRADE')return out;
   if(msg.presence==null||(msg.presence&1)===0)return out;
   if(msg.snapshot){stats.skippedSnapshot++;return out}
   if(!Number.isFinite(msg.price)||!Number.isFinite(msg.size)||!Number.isFinite(msg.ts))return out;
   if(Math.abs(msg.price/tick-Math.round(msg.price/tick))>1e-6)return out;
   const t=Math.floor(msg.ts/1e6/60)*60;
   if(lastMinute!==null&&t<=lastMinute&&!cur){stats.lateTrades++;return out}
   if(cur&&t<cur.t){stats.lateTrades++;return out}
   if(cur&&t>cur.t)out.push(close());
   if(!cur)cur={t,o:msg.price,h:msg.price,l:msg.price,c:msg.price,v:0,sellAtBid:0,buyAtAsk:0,trades:0};
   cur.h=Math.max(cur.h,msg.price);cur.l=Math.min(cur.l,msg.price);cur.c=msg.price;cur.v+=msg.size;cur.trades++;stats.trades++;
   let side=msg.aggressor===1?'B':msg.aggressor===2?'S':null;
   if(!side){stats.unknownAggressor++;side=ask!=null&&msg.price>=ask?'B':bid!=null&&msg.price<=bid?'S':null;if(!side)stats.unclassified++}
   if(side==='B')cur.buyAtAsk+=msg.size;else if(side==='S')cur.sellAtBid+=msg.size;
   return out;
  },
  // Close the open minute once wall time has passed its end (+grace). nowSec = Unix seconds.
  tick(nowSec,graceSec=2){return cur&&nowSec>=cur.t+60+graceSec?[close()]:[]},
  stats(){return {...stats,openMinute:cur?.t??null,bid,ask}},
 };
}

// ---------- live core ----------
export function createLiveCore(params={}){
 const P={...LIVE_DEFAULTS,...params};
 const ownerZones=params.ownerZones||[];
 const reader=createFlowReader(params.flow||{});
 const map=createLiquidityMap({staleSec:{PROFILE:P.profileEveryMin*60+60}});
 const det=createLevelEventDetector({reclaimHoldSec:60});
 const armed=new Set();let sweepSince=-Infinity;
 let session=[],rth=[],sessionOpen=null,prevMinute=null,zonesAdded=false,lastProfile=null;
 let priorDay=params.priorDay&&Number.isFinite(params.priorDay.high)&&Number.isFinite(params.priorDay.low)?{...params.priorDay}:null;
 const minutes=[];const recentReads=[];const levelLog=new Map();const bodyBeyond=new Map();
 const checkpoints=[];let last=null;let lastEval=null;
 const key=p=>Math.round(p/P.tick);
 const logAt=(price,item)=>{const k=key(price);const a=levelLog.get(k)||[];a.push(item);if(a.length>P.historyPerLevel)a.shift();levelLog.set(k,a)};
 const historyNear=price=>{const out=[];for(const [k,a] of levelLog)if(Math.abs(k*P.tick-price)<=2)out.push(...a);return out.sort((x,y)=>x.t-y.t)};
 const arm=(price,source,t,ref)=>{const k=price.toFixed(2);if(armed.has(k))return;armed.add(k);
  det.arm({id:'A'+k,price,side:price<=ref?'SUPPORT':'RESISTANCE',source,armedAt:t})};
 const inRth=m=>Math.floor((m.t%86400)/60)>=P.rthOpenUtcMin;
 function newSession(m){
  if(session.length){const hi=Math.max(...session.map(x=>x.h)),lo=Math.min(...session.map(x=>x.l));priorDay={high:hi,low:lo,derived:true}}
  session=[];rth=[];sessionOpen=null;lastProfile=null;
 }
 function onMinute(m){
  for(const k of ['t','o','h','l','c','v','sellAtBid','buyAtAsk'])if(!Number.isFinite(m[k]))throw Error('bad minute field '+k);
  if(prevMinute&&m.t<=prevMinute.t)throw Error('minutes must be strictly increasing');
  if(P.profileSession==='SESSION'&&prevMinute&&m.t-prevMinute.t>=P.sessionGapMin*60)newSession(m);
  prevMinute=m;minutes.push(m);if(minutes.length>600)minutes.shift();
  const snap=reader.onMinute(m);
  for(const r of snap.reads)recentReads.push({t:m.t,...r});
  while(recentReads.length&&recentReads[0].t<m.t-P.readMemoryMin*60)recentReads.shift();
  session.push(m);
  if(inRth(m))rth.push(m);
  const profileBars=P.profileSession==='RTH'?rth:session;
  if(sessionOpen===null&&(P.profileSession==='RTH'?inRth(m):true))sessionOpen=m.o;
  const t=m.t+60;
  det.onBar({t,o:m.o,h:m.h,l:m.l,c:m.c,v:m.v,bid:m.sellAtBid,ask:m.buyAtAsk});
  for(const {kind,...c} of sweepCandidates(det.events(),{since:sweepSince})){
   if(kind==='HELD')map.add('PROVEN',c);else map.markBroken(c);
   logAt(c.price,{t:c.t,time:mst(c.t),type:kind==='HELD'?c.label:c.label,state:c.state,penetrationPts:c.detail?.penetrationPts??null});
   sweepSince=Math.max(sweepSince,c.t)}
  for(const c of provenCandidates(snap)){map.add('PROVEN',{...c,t});
   logAt(c.price,{t,time:mst(t),type:c.label,touches:c.detail?.touches??null})}
  if(!zonesAdded&&ownerZones.length){for(const c of ownerZoneCandidates(ownerZones,{t}))map.add('OWNER_ZONE',c);zonesAdded=true}
  // Owner full-body rule (descriptive): remember the last full-body close below/above each known level.
  for(const k of armed){const lv=Number(k);
   if(Math.max(m.o,m.c)<lv)bodyBeyond.set(k+'|below',m.t);
   if(Math.min(m.o,m.c)>lv)bodyBeyond.set(k+'|above',m.t)}
  // arm for the NEXT bars (armedAt = this bar's close); point-in-time sources only
  const refs=referenceCandidates({t,price:m.c,sessionOpen,priorHigh:priorDay?.high,priorLow:priorDay?.low});
  for(const c of refs)arm(c.price,c.label,t,m.c);
  for(const z of ownerZones){arm(z.lo,'OWNER_'+z.kind+'_LOW',t,m.c);arm(z.hi,'OWNER_'+z.kind+'_HIGH',t,m.c)}
  // profile refresh
  const profileDue=(t%(P.profileEveryMin*60)===0)||(P.profileWarmStart&&lastProfile===null);
  let pockets=lastProfile?.airPockets||[];
  if(profileDue&&profileBars.length>=P.profileMinMinutes){
   const pc=profileCandidates(profileBars,{t});
   for(const c of pc.candidates)map.add('PROFILE',{...c,t});
   for(const c of refs)map.add('REFERENCE',{...c,t});
   lastProfile={t,airPockets:pc.airPockets,profile:pc.profile};pockets=pc.airPockets;
  }
  const evalDue=t%(P.evaluateEveryMin*60)===0;
  if(evalDue&&profileBars.length>=P.profileMinMinutes){
   lastEval=map.evaluate({t,price:m.c,airPockets:pockets});
   checkpoints.push({t,time:mst(t)+' MST',price:m.c,lines:lineSummary(lastEval),noLineReason:lastEval.noLineReason});
   if(checkpoints.length>200)checkpoints.shift();
  }
  last=buildSnapshot(m,snap);
  return last;
 }
 function lineSummary(ev){
  return ev.drawn.map(d=>({side:d.side,price:d.price,strength:d.strength,sources:d.sourceTypes,
   labels:Object.values(d.evidence).flatMap(e=>e.labels),state:d.state,airPocketsBetween:d.airPocketsBetween,
   insideOwnerZones:zonesContaining(ownerZones,d.price),...(d.flippedFrom?{flippedFrom:d.flippedFrom}:{})}));
 }
 function card(d,m){
  const dist=Math.abs(d.price-m.c);const near=dist<=P.cardNearPts;
  const k=d.price.toFixed(2);const wordBeyond=d.side==='BUY'?'below':'above';
  const lastBody=bodyBeyond.get(k+'|'+wordBeyond)??null;
  const provenT=d.evidence.PROVEN?.lastT??null;
  const invalidation=P.ownerBreakRule
   ?`Defense fails on a full-body 1-min candle ${wordBeyond} ${d.price} (open and close ${wordBeyond})`
   :`Defense fails on a 1-min close ${wordBeyond} ${d.price}`;
  const flowNow=near?recentReads.filter(r=>r.t>=m.t-P.readMemoryMin*60).map(r=>({type:r.type,time:mst(r.t),read:r.read})):[];
  const hist=historyNear(d.price).map(h=>({time:h.time,type:h.type,...(h.state?{state:h.state}:{}),
   ...(h.penetrationPts!=null?{penetrationPts:h.penetrationPts}:{}),...(h.touches!=null?{touches:h.touches}:{})}));
  return {id:d.id,side:d.side,price:d.price,strength:d.strength,distancePts:Math.round(dist*100)/100,
   sources:d.sourceTypes,labels:Object.values(d.evidence).flatMap(e=>e.labels),state:d.state,
   ...(d.flippedFrom?{flippedFrom:d.flippedFrom}:{}),insideOwnerZones:zonesContaining(ownerZones,d.price),
   defenseHistory:hist,
   currentFlowRead:near?(flowNow.length?flowNow:[{type:'NONE',read:'No notable flow read at this level right now'}]):null,
   currentFlowNote:near?null:`Price ${Math.round(dist*4)/4} pts away`,
   airPocketsBetween:d.airPocketsBetween,
   ownerBreakRule:P.ownerBreakRule?{fullBodyCloseBeyondAt:lastBody?mst(lastBody):null,
    sinceLastProof:lastBody!=null&&(provenT==null||lastBody+60>provenT)}:null,
   invalidation,
   title:`${d.side} ${d.price}: ${d.sourceTypes.join(' + ')}${d.state?` · ${d.state}`:''}`};
 }
 function trend(){
  const w=minutes.slice(-15);if(w.length<15)return {lows:'NOT_ENOUGH_DATA',highs:'NOT_ENOUGH_DATA'};
  const blocks=[w.slice(0,5),w.slice(5,10),w.slice(10)];
  const lows=blocks.map(b=>Math.min(...b.map(x=>x.l))),highs=blocks.map(b=>Math.max(...b.map(x=>x.h)));
  const dir=a=>a[0]<a[1]&&a[1]<a[2]?'RISING':a[0]>a[1]&&a[1]>a[2]?'FALLING':'MIXED';
  return {lows:dir(lows),highs:dir(highs),lowsByBlock:lows,highsByBlock:highs};
 }
 function buildSnapshot(m,snap){
  const active=[...recentReads].reverse();
  const top=PRIORITY.map(p=>active.find(r=>r.type===p)).find(Boolean)||null;
  const [tone,side]=top?READ_KIND[top.type]||['INFO',null]:['NEUTRAL',null];
  const ev=lastEval;
  return {schema:'engine18.live.v1',t:m.t+60,time:mst(m.t+60)+' MST',price:m.c,
   dataSource:'RITHMIC_TRADES_BBO',orderBook:'NOT_CONNECTED_V1',
   currentRead:{tone,side,type:top?.type??null,line:top?top.read:'No notable flow read right now',since:top?mst(top.t):null,
    activeReads:active.slice(0,6).map(r=>({type:r.type,time:mst(r.t),read:r.read,kind:READ_KIND[r.type]?.[0]??'INFO'}))},
   lines:ev?ev.drawn.map(d=>card(d,m)):[],
   noLineReason:ev?ev.noLineReason:'WARMING_UP',
   last15:{changePts:snap.context.change15,delta:snap.context.delta15,
    minutes:minutes.slice(-15).map(b=>({time:mst(b.t),c:b.c,movePts:b.c-b.o,delta:b.buyAtAsk-b.sellAtBid,v:b.v}))},
   volumeVsNormal:{ratio:snap.context.volumeVsPrior45,basis:'median 1-min volume, last 15 min vs prior 45 min'},
   trend:trend(),
   airPockets:(lastProfile?.airPockets||[]).map(a=>({lo:a.lo,hi:a.hi})),
   profile:lastProfile?.profile??null,
   session:{mode:P.profileSession,open:sessionOpen,minutes:(P.profileSession==='RTH'?rth:session).length,priorDay},
   rules:{ownerBreakRule:P.ownerBreakRule,minSources:2,minDistancePts:8,maxPerSide:2},
   note:'Confirmation only. Evidence counts are descriptive, not probabilities. Never buy/sell instructions.'};
 }
 return {onMinute,snapshot:()=>last,checkpoints:()=>checkpoints.slice(),sweeps:()=>det.events().filter(e=>e.classification)};
}

// Convenience: wire a minute builder to a core. ingest(msg) and tick(nowSec) return the latest snapshot
// when a minute closed, else null.
export function createLiveWorker(params={}){
 const builder=createMinuteBuilder({tick:params.tick??0.25});const core=createLiveCore(params);
 const feed=ms=>{let s=null;for(const m of ms)s=core.onMinute(m);return s};
 return {ingest:msg=>feed(builder.ingest(msg)),tick:now=>feed(builder.tick(now)),
  snapshot:()=>core.snapshot(),stats:()=>builder.stats(),core};
}
