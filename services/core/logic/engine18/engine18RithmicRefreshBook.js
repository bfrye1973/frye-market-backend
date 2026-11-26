// Engine 18 — Plan B order book for Rithmic DBO WITHOUT sequence numbers (owner decision Nov 26).
//
// Live Nov 26 (Rithmic Paper, NYC Area): neither 116 snapshot parts nor 160 updates carry
// sequence_number (112002), and no 161 end events arrive. There is therefore NO vendor boundary
// between a snapshot and the update stream. Engine 18D rulings honored here:
//  - the boundary is never inferred from arrival time (or from exchange timestamps);
//  - the book is never VERIFIED in this mode; the best label is EMPIRICALLY_RECONCILED_UNVERIFIED;
//  - memory is bounded (one running book + one staging snapshot + a bounded touched-id set).
//
// Method (content-based, not time-based):
//  - a full snapshot is re-requested every refreshEveryMs (default 60 s, minimum 15 s, one in flight);
//  - BEFORE replacing, the running book is compared with the new snapshot. Orders touched by an
//    update while the snapshot was in flight are EXPLAINED differences (their before/after placement
//    is unknowable); every other difference is UNEXPLAINED drift;
//  - the new baseline = snapshot, except touched orders take the running book's state (the latest
//    event received for that order wins). No arrival-time ordering is used;
//  - updates are applied idempotently-tolerant (a DELETE of an absent order, a NEW of an existing
//    order, a CHANGE of an unknown order carrying full price/size) and counted as drift signals:
//    they are expected when updates and snapshots overlap without a boundary.
// If Rithmic later sends 112002 on snapshots AND updates, selectSyncMode() returns SEQUENCED and
// createEngine18Book() hands back the existing sequenced book (engine18RithmicDboBook.js).
import {createDboBook,decodeExact} from './engine18RithmicDboBook.js';

export const SYNC_MODES=Object.freeze({UNSEQUENCED_REFRESH:'UNSEQUENCED_REFRESH',SEQUENCED:'SEQUENCED'});
export const QUALITY=Object.freeze({UNSEEDED:'UNSEEDED',SEEDED:'SEEDED',RECONCILED:'RECONCILED',
 DRIFT_CORRECTED:'DRIFT_CORRECTED',STALE:'STALE',INVALID:'INVALID'});
export const LABELS=Object.freeze({RECONCILED:'EMPIRICALLY_RECONCILED_UNVERIFIED',DIAGNOSTIC:'DIAGNOSTIC_NOT_VERIFIED'});
export const REFRESH_DEFAULTS=Object.freeze({tick:0.25,refreshEveryMs:60000,minRefreshMs:15000,snapshotTimeoutMs:20000,
 matchStreakK:3,nearTouchPts:10,stubPct:0.05,maxOrders:300000,historyMax:50,crossCheckEvery:200,postRefreshGraceMs:5000});
const STRUCTURAL=Object.freeze(['misaligned','badSide','badOrderId','badPrice','offTick','badSize','wrongInstrument','missingInstrument']);

// ---------- sync-mode seam ----------
// SEQUENCED only when a completed snapshot had 112002 on every data-bearing part AND at least
// minUpdates updates all carried 112002. Any unsequenced data-bearing frame decides UNSEQUENCED_REFRESH.
export function createSyncModeSelector({minUpdates=20}={}){
 let mode=null;const ev={snapshotDataParts:0,snapshotDataPartsWithSeq:0,snapshotsCompleted:0,updates:0,updatesWithSeq:0};
 const decideUnseq=()=>{mode??=SYNC_MODES.UNSEQUENCED_REFRESH};
 return {
  observeSnapshotPart(p){if(p.dataBearing){ev.snapshotDataParts++;if(p.seq!=null)ev.snapshotDataPartsWithSeq++;else decideUnseq()}
   if(p.final)ev.snapshotsCompleted++},
  observeUpdate(u){if(!u.dataBearing)return;ev.updates++;if(u.seq!=null)ev.updatesWithSeq++;else decideUnseq()},
  decide(){if(mode)return {mode,evidence:{...ev}};
   if(ev.snapshotsCompleted>0&&ev.snapshotDataParts>0&&ev.snapshotDataPartsWithSeq===ev.snapshotDataParts&&
    ev.updates>=minUpdates&&ev.updatesWithSeq===ev.updates)mode=SYNC_MODES.SEQUENCED;
   return {mode,evidence:{...ev}}},
 };
}
export function createEngine18Book({syncMode,...opts}={}){
 if(syncMode===SYNC_MODES.SEQUENCED)return {syncMode,book:createDboBook({mode:'OBSERVE',...opts})};
 if(syncMode===SYNC_MODES.UNSEQUENCED_REFRESH)return {syncMode,book:createRefreshBook(opts)};
 throw Error('syncMode must be SEQUENCED or UNSEQUENCED_REFRESH');
}

// ---------- exchange timestamps (diagnostics only; never used to place updates) ----------
const TS=Object.freeze({ssboe:150400,usecs:150401,nsecs:150404});
const varints=(m,f)=>{const out=[];for(const x of m.get(f)||[]){
 if(typeof x==='bigint'){out.push(x);continue}
 if(Buffer.isBuffer(x)){let k=0;while(k<x.length){let v=0n,sh=0n,ok=false; // packed
  for(let t=0;t<10&&k<x.length;t++){const b=x[k++];v|=BigInt(b&127)<<sh;if(!(b&128)){ok=true;break}sh+=7n}
  if(!ok)return [];out.push(v)}}}return out};
export function parseExchangeTime(frame){
 const m=decodeExact(frame);const s=varints(m,TS.ssboe)[0],u=varints(m,TS.usecs)[0],n=varints(m,TS.nsecs)[0];
 if(s===undefined)return null;
 return {ns:s*1000000000n+(u!==undefined?u*1000n:0n)+(n!==undefined?n%1000n:0n),hasUsecs:u!==undefined,hasNsecs:n!==undefined};
}
function createExchangeTimeStats(){
 const st={observed:0,missing:0,backwards:0,equal:0,maxBackwardsNs:'0',gapBuckets:{lt1ms:0,lt10ms:0,lt100ms:0,lt1s:0,ge1s:0}};let last=null,maxBack=0n;
 return {note(et){if(!et){st.missing++;return}st.observed++;
   if(last!==null){const d=et.ns-last;
    if(d<0n){st.backwards++;if(-d>maxBack){maxBack=-d;st.maxBackwardsNs=String(maxBack)}}
    else{if(d===0n)st.equal++;const b=d<1000000n?'lt1ms':d<10000000n?'lt10ms':d<100000000n?'lt100ms':d<1000000000n?'lt1s':'ge1s';st.gapBuckets[b]++}}
   if(last===null||et.ns>last)last=et.ns},
  result(){return {...st,gapBuckets:{...st.gapBuckets},usedForPlacement:false,note:'diagnostic only; placement by exchange time needs Engine 18D approval'}}};
}

// ---------- Plan B book ----------
export function createRefreshBook(params={}){
 const P={...REFRESH_DEFAULTS,...params};const now=P.now||Date.now;
 if(!Number.isSafeInteger(P.refreshEveryMs)||P.refreshEveryMs<P.minRefreshMs)throw Error('refreshEveryMs must be >= '+P.minRefreshMs);
 if(!Number.isSafeInteger(P.matchStreakK)||P.matchStreakK<1)throw Error('matchStreakK must be >= 1');
 const tick=P.tick,nearTicks=Math.round(P.nearTouchPts/tick);
 let orders=new Map(),inFlight=null,baselineAt=null,lastRequestAt=null,postRefreshUntil=null;
 let lastQuality=QUALITY.UNSEEDED,invalidReason=null,streak=0,updatesSinceCheck=0;
 const history=[];const ets=createExchangeTimeStats();
 const st={refreshRequests:0,refreshesCompleted:0,refreshesRejected:0,refreshTimeouts:0,seeds:0,comparisons:0,matches:0,
  mismatches:0,unsolicitedParts:0,mismatchedParts:0,snapshotParts:0,updates:0,entries:0,crossedStates:0,
  touchedDuringSnapshot:0,driftSignals:{deleteMissing:0,newExisting:0,changeMissing:0,changeMissingUnusable:0},
  structural:Object.fromEntries(STRUCTURAL.map(k=>[k,0])),structuralInStreak:0,orderLimit:false};
 const pushHistory=h=>{history.push(h);if(history.length>P.historyMax)history.shift()};
 const priceTicks=p=>{if(!Number.isFinite(p)||p<=0)return {err:'badPrice'};const t=Math.round(p/tick);
  return Math.abs(p/tick-t)>1e-6?{err:'offTick'}:{t}};
 const qtyOf=x=>typeof x==='bigint'&&x>0n&&x<=BigInt(Number.MAX_SAFE_INTEGER)?Number(x):(Number.isSafeInteger(x)&&x>0?x:null);
 const touch=map=>{let b=null,a=null;for(const o of map.values()){if(o.side===1){if(b===null||o.t>b)b=o.t}else if(a===null||o.t<a)a=o.t}
  return {bidT:b,askT:a,twoSided:b!==null&&a!==null,crossedOrLocked:b!==null&&a!==null&&b>=a}};
 const setInvalid=r=>{lastQuality=QUALITY.INVALID;invalidReason=r;streak=0};
 const structural=k=>{st.structural[k]++;st.structuralInStreak++;streak=0;
  if(k==='wrongInstrument'||k==='missingInstrument')setInvalid('INSTRUMENT_'+k)};
 const instrumentOk=f=>{const hasSym=f.symbol!=null,hasEx=f.exchange!=null;
  if((hasSym&&P.symbol&&f.symbol!==P.symbol)||(hasEx&&P.exchange&&f.exchange!==P.exchange)){structural('wrongInstrument');return false}
  if(f.dataBearing&&(!hasSym||!hasEx)){structural('missingInstrument');return false}return true};
 const checkCrossed=()=>{updatesSinceCheck=0;if(baselineAt===null||!orders.size)return;
  const tc=touch(orders);if(tc.crossedOrLocked){st.crossedStates++;setInvalid('BOOK_CROSSED_OR_LOCKED')}};
 const quality=()=>{if(lastQuality===QUALITY.INVALID)return QUALITY.INVALID;if(baselineAt===null)return QUALITY.UNSEEDED;
  if(now()-baselineAt>2*P.refreshEveryMs)return QUALITY.STALE;return lastQuality};
 const label=()=>quality()===QUALITY.RECONCILED&&streak>=P.matchStreakK&&st.structuralInStreak===0?LABELS.RECONCILED:LABELS.DIAGNOSTIC;
 const abortTimedOut=()=>{if(inFlight&&now()-inFlight.startedAt>P.snapshotTimeoutMs){st.refreshTimeouts++;
  pushHistory({kind:'REFRESH',ok:false,reason:'SNAPSHOT_TIMEOUT',atMs:now()});inFlight=null}};

 // Compare running vs snapshot. Differences on orders touched during the snapshot are EXPLAINED.
 const compare=(running,snap,touched,bestBidT,bestAskT)=>{
  const d={missingInBook:0,extraInBook:0,sizeMismatch:0,priceOrSideMismatch:0,qtyDiff:0,nearTouch:0,beyond:0,explained:0,unexplained:0};
  const near=o=>o.side===1?bestBidT-o.t<=nearTicks:o.t-bestAskT<=nearTicks;
  const tally=(id,o,kind,q)=>{if(touched.has(id)){d.explained++;return}d[kind]++;d.unexplained++;d.qtyDiff+=q;if(near(o))d.nearTouch++;else d.beyond++};
  for(const [id,s] of snap){const r=running.get(id);
   if(!r)tally(id,s,'missingInBook',s.q);
   else if(r.side!==s.side||r.t!==s.t)tally(id,s,'priceOrSideMismatch',Math.max(r.q,s.q));
   else if(r.q!==s.q)tally(id,s,'sizeMismatch',Math.abs(r.q-s.q))}
  for(const [id,r] of running)if(!snap.has(id))tally(id,r,'extraInBook',r.q);
  return d};

 const complete=p=>{const f=inFlight;inFlight=null;
  const tc=touch(f.staging);
  const bad=p.rpCode!=='0'?'SNAPSHOT_REJECTED_'+(p.rpCode??'NONE'):f.bad?f.bad:!f.staging.size?'SNAPSHOT_EMPTY':
   !tc.twoSided?'SNAPSHOT_NOT_TWO_SIDED':tc.crossedOrLocked?'SNAPSHOT_CROSSED_OR_LOCKED':null;
  if(bad){st.refreshesRejected++;streak=0;pushHistory({kind:'REFRESH',ok:false,reason:bad,atMs:now()});return}
  st.refreshesCompleted++;const seed=baselineAt===null;let d=null;
  if(!seed){d=compare(orders,f.staging,f.touched,tc.bidT,tc.askT);st.comparisons++;if(d.unexplained===0)st.matches++;else st.mismatches++}
  // New baseline: snapshot, but orders touched while it was in flight keep the latest received state.
  const next=f.staging;for(const id of f.touched){const r=orders.get(id);if(r)next.set(id,r);else next.delete(id)}
  orders=next;baselineAt=now();postRefreshUntil=baselineAt+P.postRefreshGraceMs;st.touchedDuringSnapshot+=f.touched.size;
  if(seed){st.seeds++;lastQuality=QUALITY.SEEDED;streak=0;st.structuralInStreak=0}
  else if(d.unexplained===0){if(lastQuality===QUALITY.INVALID||streak===0)st.structuralInStreak=0;lastQuality=QUALITY.RECONCILED;streak++}
  else{lastQuality=QUALITY.DRIFT_CORRECTED;streak=0;st.structuralInStreak=0}
  invalidReason=null;checkCrossed();
  pushHistory({kind:seed?'SEED':'REFRESH',ok:true,atMs:baselineAt,orders:orders.size,touched:f.touched.size,
   match:seed?null:d.unexplained===0,diff:d,quality:lastQuality})};

 return {
  get syncMode(){return SYNC_MODES.UNSEQUENCED_REFRESH},
  get orderCount(){return orders.size},
  get inFlight(){return inFlight?inFlight.id:null},
  // Scheduler: due when nothing is in flight, the minimum request gap has passed, and the baseline
  // is older than refreshEveryMs (or there is none).
  refreshDue(){abortTimedOut();if(inFlight)return false;
   if(lastRequestAt!==null&&now()-lastRequestAt<P.minRefreshMs)return false;
   return baselineAt===null||now()-baselineAt>=P.refreshEveryMs},
  // Returns false (no request should be sent) when one is in flight or the minimum gap has not passed.
  beginRefresh(requestId){abortTimedOut();if(inFlight)return false;
   if(lastRequestAt!==null&&now()-lastRequestAt<P.minRefreshMs)return false;
   lastRequestAt=now();st.refreshRequests++;
   inFlight={id:requestId==null?null:String(requestId),startedAt:now(),staging:new Map(),bad:null,touched:new Set()};return true},
  onSnapshotPart(p){
   if(!inFlight){st.unsolicitedParts++;return}
   if(p.userMsg!=null&&inFlight.id!=null&&p.userMsg!==inFlight.id){st.mismatchedParts++;return}
   st.snapshotParts++;const f=inFlight;
   if(p.dataBearing||p.symbol!=null||p.exchange!=null){const okI=instrumentOk(p);if(!okI)f.bad??='SNAPSHOT_INSTRUMENT'}
   if(p.ids.length&&!f.bad){
    if(!p.aligned)f.bad='SNAPSHOT_MISALIGNED';else if(p.side!==1&&p.side!==2)f.bad='SNAPSHOT_BAD_SIDE';
    else{const pt=priceTicks(p.price);if(pt.err)f.bad='SNAPSHOT_'+pt.err.toUpperCase();
     else p.ids.forEach((id,i)=>{if(f.bad)return;
      if(typeof id!=='string'||!id.length||id.length>64){f.bad='SNAPSHOT_BAD_ORDER_ID';return}
      if(f.staging.has(id)){f.bad='SNAPSHOT_DUPLICATE_ORDER_ID';return}
      const q=qtyOf(p.sizes[i]);if(q===null){f.bad='SNAPSHOT_BAD_SIZE';return}
      f.staging.set(id,{side:p.side,t:pt.t,q})})}
    if(f.staging.size>P.maxOrders)f.bad='ORDER_LIMIT'}
   else if(!p.ids.length&&p.dataBearing&&!f.bad)f.bad='SNAPSHOT_MALFORMED_PART';
   if(p.final)complete(p)},
  onUpdate(u,{exchangeTime}={}){st.updates++;if(exchangeTime!==undefined)ets.note(exchangeTime);
   if(!instrumentOk(u))return;
   if(!u.aligned){structural('misaligned');return}
   for(const e of u.entries){st.entries++;
    if(e.side!==1&&e.side!==2){structural('badSide');continue}
    if(typeof e.orderId!=='string'||!e.orderId.length||e.orderId.length>64){structural('badOrderId');continue}
    if(inFlight){if(inFlight.touched.size<P.maxOrders)inFlight.touched.add(e.orderId);else inFlight.bad??='TOUCHED_LIMIT'}
    const cur=orders.get(e.orderId);
    if(e.type===3){if(!cur){st.driftSignals.deleteMissing++;continue}orders.delete(e.orderId);continue}
    if(e.type!==1&&e.type!==2){structural('misaligned');continue}
    const pt=priceTicks(e.price);if(pt.err){structural(pt.err);continue}
    const q=e.size==null?(cur?cur.q:null):qtyOf(e.size);
    if(q===null){if(e.size==null&&!cur){st.driftSignals.changeMissingUnusable++;continue}structural('badSize');continue}
    if(e.type===1&&cur)st.driftSignals.newExisting++;
    if(e.type===2&&!cur)st.driftSignals.changeMissing++;
    orders.set(e.orderId,{side:e.side,t:pt.t,q});
    if(orders.size>P.maxOrders){st.orderLimit=true;setInvalid('ORDER_LIMIT');orders=new Map();baselineAt=null;return}}
   if(++updatesSinceCheck>=P.crossCheckEvery&&!inFlight)checkCrossed()},
  checkCrossed,
  quality,label,
  // Liquidity readout. Always carries quality + label + refresh age; values suppressed when the book
  // is UNSEEDED, INVALID or STALE. Far stub/placeholder orders (> stubPct from touch) stay in the
  // book but are excluded from span metrics.
  liquidity({distancesPts=[10,20,30,50],keyLevels=[],keyTolPts=0,stubPct=P.stubPct}={}){
   if(!inFlight&&baselineAt!==null)checkCrossed();
   const q=quality(),lab=label(),age=baselineAt===null?null:now()-baselineAt;
   const comps=history.filter(h=>h.kind==='REFRESH'&&h.ok);
   const base={schema:'engine18.rithmicRefreshLiquidity.v1',syncMode:SYNC_MODES.UNSEQUENCED_REFRESH,quality:q,label:lab,verified:false,
    lastRefreshAgeMs:age,matchStreak:streak,matchStreakRequired:P.matchStreakK,
    refreshMatchRate:comps.length?comps.filter(h=>h.match).length/comps.length:null,refreshesCompared:comps.length,
    boundary:'UNKNOWN_NO_VENDOR_SEQUENCE',completenessProven:false,distanceBasis:'SIDE_TOUCH',bookOrders:orders.size};
   if(q===QUALITY.UNSEEDED||q===QUALITY.INVALID||q===QUALITY.STALE)
    return {...base,suppressed:true,reason:q===QUALITY.INVALID?(invalidReason||'INVALID'):q};
   const tc=touch(orders);if(!tc.twoSided)return {...base,suppressed:true,reason:'BOOK_NOT_TWO_SIDED'};
   const lim={bid:Math.round(tc.bidT*(1-stubPct)),ask:Math.round(tc.askT*(1+stubPct))};
   const lv={bid:new Map(),ask:new Map()};let stubOrders=0,stubQty=0;
   for(const o of orders.values()){const s=o.side===1?'bid':'ask';
    if(s==='bid'?o.t<lim.bid:o.t>lim.ask){stubOrders++;stubQty+=o.q;continue}
    const l=lv[s].get(o.t)||{qty:0,orders:0};l.qty+=o.q;l.orders++;lv[s].set(o.t,l)}
   const side=(m,dir,best,name)=>{let far=best;for(const t of m.keys())if(dir<0?t<far:t>far)far=t;
    return {touch:name,best:best*tick,farthestObserved:far*tick,observedSpanPts:Math.abs(far-best)*tick,levelsWithOrders:m.size,
     rows:distancesPts.map(dp=>{const target=best+dir*Math.round(dp/tick);let sum=0,n=0;
      for(const [t,l] of m)if(dir<0?(t<=best&&t>=target):(t>=best&&t<=target)){sum+=l.qty;n++}
      const at=m.get(target);
      return {distancePts:dp,price:target*tick,observation:at?'OBSERVED_ORDERS':'NOT_OBSERVED',
       observedQtyAtPrice:at?at.qty:null,observedOrdersAtPrice:at?at.orders:null,observedQtyTouchToPrice:sum,levelsWithOrdersTouchToPrice:n}})}};
   const tol=Math.round(keyTolPts/tick);
   const keys=keyLevels.filter(k=>k&&Number.isFinite(k.price)).slice(0,64).map(k=>{const target=Math.round(k.price/tick);
    let bq=0,bo=0,aq=0,ao=0;
    for(let t=target-tol;t<=target+tol;t++){const b=lv.bid.get(t),a=lv.ask.get(t);if(b){bq+=b.qty;bo+=b.orders}if(a){aq+=a.qty;ao+=a.orders}}
    const where=target<=tc.bidT?'AT_OR_BELOW_BID':target>=tc.askT?'AT_OR_ABOVE_ASK':'INSIDE_SPREAD';
    return {name:String(k.name??k.price).slice(0,40),price:target*tick,tolerancePts:tol*tick,where,
     observation:bq||aq?'OBSERVED_ORDERS':'NOT_OBSERVED',bidQty:bq||null,bidOrders:bo||null,askQty:aq||null,askOrders:ao||null,
     distanceFromTouchPts:where==='AT_OR_BELOW_BID'?(tc.bidT-target)*tick:where==='AT_OR_ABOVE_ASK'?(target-tc.askT)*tick:0}});
   return {...base,suppressed:false,computedAtMs:now(),
    stubExclusion:{stubPct,excludedOrders:stubOrders,excludedQty:stubQty,note:'kept in the book; excluded from span metrics only'},
    bid:side(lv.bid,-1,tc.bidT,'BEST_BID'),ask:side(lv.ask,1,tc.askT,'BEST_ASK'),keyLevels:keys}},
  stats(){return JSON.parse(JSON.stringify({...st,quality:quality(),label:label(),invalidReason,matchStreak:streak,
   inFlight:inFlight?{id:inFlight.id,ageMs:now()-inFlight.startedAt,touched:inFlight.touched.size}:null,
   history:history.slice(-12),exchangeTime:ets.result()}))},
 };
}
// Round-number key levels around a reference price (point-in-time; e.g. every 50 pts within ±range).
export function roundKeyLevels(ref,{step=50,rangePts=250}={}){
 if(!Number.isFinite(ref))return [];const out=[];
 for(let p=Math.ceil((ref-rangePts)/step)*step;p<=ref+rangePts;p+=step)out.push({name:'ROUND_'+p,price:p});return out;
}
