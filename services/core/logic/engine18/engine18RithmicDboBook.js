// Engine 18D Step B — offline Rithmic Depth-By-Order (DBO) book reconstruction.
// Pure logic: no network, no persistence. Field numbers from the vendor .proto files bundled in
// async_rithmic (depth_by_order, depth_by_order_end_event, response_depth_by_order_snapshot) and
// rithmic-rs src/rti.rs (adds depth_size_64 = 159009). Both size encodings are accepted.
//
// Unproven vendor semantics are handled conservatively and MEASURED, not assumed:
//  - sequence scope/contiguity: STRICT mode invalidates on any gap; OBSERVE mode keeps applying,
//    counts gaps, and relies on re-snapshot equality as the independent truth test;
//  - snapshot sequence meaning (last-included vs next-expected): re-snapshot verification compares
//    the book both before and after applying updates whose sequence EQUALS the snapshot sequence;
//  - 161 end events are counted only; book publication does not depend on them.

export const DBO_TEMPLATES=Object.freeze({snapshotRequest:115,snapshotResponse:116,
 updatesRequest:117,updatesResponse:118,update:160,endEvent:161});
const F=Object.freeze({templateId:154467,userMsg:132760,rqHandlerRpCode:132764,rpCode:132766,
 symbol:110100,exchange:110101,sequence:112002,request:100000,updateType:110121,side:153612,
 price:154405,prevPrice:154906,prevPriceFlag:154930,size32:154406,size64:159009,
 priority:153613,orderId:149238,ssboe:150100,usecs:150101});
const VARINT_FIELDS=new Set([F.updateType,F.side,F.prevPriceFlag,F.size32,F.size64,F.priority]);
const DOUBLE_FIELDS=new Set([F.price,F.prevPrice]);
export const UPDATE=Object.freeze({NEW:1,CHANGE:2,DELETE:3});
export const SIDE=Object.freeze({BID:1,ASK:2}); // TransactionType BUY=1 (bid), SELL=2 (ask)

// --- encoders (read-only requests) ---
const uvar=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('invalid protobuf integer');
 const a=[];do{const b=n%128;n=Math.floor(n/128);a.push(n?b|128:b)}while(n);return Buffer.from(a)};
const str=(f,v)=>{const b=Buffer.from(v,'utf8');return Buffer.concat([uvar(f*8+2),uvar(b.length),b])};
const num=(f,v)=>Buffer.concat([uvar(f*8),uvar(v)]);
const checkInstrument=(symbol,exchange)=>{
 if(!/^ES[HMUZ]\d$/.test(symbol)||exchange!=='CME')throw Error('ES/CME only')};
// No depth_price: full-book snapshot / subscription.
// No depth_price: full-book snapshot / subscription. user_msg (132760) carries a request id that
// the server echoes, so responses can be correlated with the request that caused them.
export function encodeDboSnapshotRequest({symbol,exchange,requestId=null}){checkInstrument(symbol,exchange);
 return Buffer.concat([num(F.templateId,115),...(requestId?[str(F.userMsg,requestId)]:[]),
  str(F.symbol,symbol),str(F.exchange,exchange)])}
export function encodeDboUpdatesRequest({symbol,exchange,subscribe,requestId=null}){checkInstrument(symbol,exchange);
 return Buffer.concat([num(F.templateId,117),...(requestId?[str(F.userMsg,requestId)]:[]),
  num(F.request,subscribe?1:2),str(F.symbol,symbol),str(F.exchange,exchange)])}

// --- decoder with exact u64 (BigInt) varints and packed/unpacked repeated support ---
export function decodeExact(frame){
 const b=Buffer.from(frame);if(b.length>4*1024*1024)throw Error('oversized frame');
 let i=0,items=0;const out=new Map();
 const readVar=()=>{let x=0n,shift=0n;for(let k=0;k<10;k++){if(i>=b.length)throw Error('truncated varint');
  const v=b[i++];x|=BigInt(v&127)<<shift;if(!(v&128))return x;shift+=7n}throw Error('oversized varint')};
 const push=(f,v)=>{let a=out.get(f);if(!a){a=[];out.set(f,a)}a.push(v)};
 while(i<b.length){if(++items>200000)throw Error('too many fields');
  const tag=readVar(),field=Number(tag>>3n),wire=Number(tag&7n);if(!field)throw Error('invalid field');
  if(wire===0)push(field,readVar());
  else if(wire===1){if(i+8>b.length)throw Error('truncated fixed64');push(field,b.subarray(i,i+8));i+=8}
  else if(wire===5){if(i+4>b.length)throw Error('truncated fixed32');push(field,b.subarray(i,i+4));i+=4}
  else if(wire===2){const n=Number(readVar());if(n>b.length-i)throw Error('truncated length');
   const chunk=b.subarray(i,i+n);i+=n;
   if(VARINT_FIELDS.has(field)){let k=0; // packed varints
    while(k<chunk.length){let x=0n,sh=0n,ok=false;
     for(let t=0;t<10&&k<chunk.length;t++){const v=chunk[k++];x|=BigInt(v&127)<<sh;if(!(v&128)){ok=true;break}sh+=7n}
     if(!ok)throw Error('bad packed varint');push(field,x)}}
   else if(DOUBLE_FIELDS.has(field)){if(chunk.length%8)throw Error('bad packed double');
    for(let k=0;k<chunk.length;k+=8)push(field,chunk.subarray(k,k+8))}
   else push(field,chunk)}
  else throw Error('unsupported wire type')}
 return out;
}
const strs=(m,f)=>(m.get(f)||[]).filter(Buffer.isBuffer).map(x=>x.toString('utf8'));
const big=(m,f)=>(m.get(f)||[]).filter(x=>typeof x==='bigint');
const one=(m,f)=>{const a=big(m,f);return a.length?a[0]:null};
const dbls=(m,f)=>(m.get(f)||[]).filter(x=>Buffer.isBuffer(x)&&x.length===8).map(x=>x.readDoubleLE(0));
const toSafe=x=>x<=BigInt(Number.MAX_SAFE_INTEGER)?Number(x):null;
const sizesOf=m=>{const s64=big(m,F.size64);return s64.length?s64:big(m,F.size32)};
export const templateOf=frame=>{const v=one(decodeExact(frame),F.templateId);return v===null?null:Number(v)};

export function parseSnapshotPart(frame){
 const m=decodeExact(frame);if(Number(one(m,F.templateId))!==116)throw Error('not 116');
 const rp=strs(m,F.rpCode),rq=strs(m,F.rqHandlerRpCode);
 const ids=strs(m,F.orderId),sizes=sizesOf(m),pri=big(m,F.priority),prices=dbls(m,F.price);
 const side=one(m,F.side);
 const aligned=sizes.length===ids.length&&(pri.length===0||pri.length===ids.length)&&prices.length<=1;
 return {final:rp.length>0,rpCode:rp[0]??null,more:rq.length>0,seq:one(m,F.sequence),
  side:side===null?null:Number(side),price:prices[0]??null,ids,sizes,priorities:pri,aligned,
  userMsg:strs(m,F.userMsg)[0]??null,symbol:strs(m,F.symbol)[0]??null,exchange:strs(m,F.exchange)[0]??null};
}
export function parseUpdate(frame){
 const m=decodeExact(frame);if(Number(one(m,F.templateId))!==160)throw Error('not 160');
 const types=big(m,F.updateType).map(Number),sides=big(m,F.side).map(Number),prices=dbls(m,F.price),
  ids=strs(m,F.orderId),sizes=sizesOf(m),pri=big(m,F.priority),prev=dbls(m,F.prevPrice);
 const n=ids.length;
 const aligned=n>0&&types.length===n&&sides.length===n&&prices.length===n&&
  (sizes.length===n||sizes.length===0)&&(pri.length===n||pri.length===0);
 const entries=aligned?ids.map((id,i)=>({type:types[i],side:sides[i],price:prices[i],
  size:sizes.length?sizes[i]:null,priority:pri.length?pri[i]:null,orderId:id,
  prevPrice:prev.length===n?prev[i]:null})):[];
 return {seq:one(m,F.sequence),aligned,entries,count:n,
  symbol:strs(m,F.symbol)[0]??null,exchange:strs(m,F.exchange)[0]??null};
}
export function parseEndEvent(frame){
 const m=decodeExact(frame);if(Number(one(m,F.templateId))!==161)throw Error('not 161');
 return {seq:one(m,F.sequence),symbol:strs(m,F.symbol)[0]??null,exchange:strs(m,F.exchange)[0]??null};
}
export function parseUpdatesAck(frame){
 const m=decodeExact(frame);const rp=strs(m,F.rpCode);
 return {accepted:rp.length>=1&&rp[0]==='0',rpCode:rp[0]??null,userMsg:strs(m,F.userMsg)[0]??null};
}
// --- book ---
const ZERO=()=>({missingInBook:0,extraInBook:0,sizeMismatch:0,priceOrSideMismatch:0,total:0});
const FATAL=new Set(['ORDER_LIMIT','BUFFER_LIMIT']);
export function createDboBook({tick=0.25,mode='STRICT',symbol=null,exchange=null,maxOrders=300000,
 maxBuffered=300000,now=Date.now}={}){
 if(mode!=='STRICT'&&mode!=='OBSERVE')throw Error('mode must be STRICT or OBSERVE');
 let state='UNSEEDED',reason=null,orders=new Map(),lastSeq=null,lastAppliedAt=null,snap=null;
 const failures=[]; // append-only: a later reseed never erases a recorded failure
 const st={snapshotsCompleted:0,snapshotParts:0,unsolicitedParts:0,mismatchedParts:0,unechoedParts:0,
  correlatedParts:0,bufferedDuringSeed:0,droppedOverlap:0,replayedAfterSeed:0,updates:0,entries:0,
  equalSeq:0,gaps:0,gapTotal:'0',outOfOrder:0,missingSequence:0,missingInstrument:0,
  anomalies:{newExisting:0,changeMissing:0,deleteMissing:0,misaligned:0,offTick:0,badPrice:0,
   badSize:0,badSide:0,badOrderId:0,wrongInstrument:0,missingSequence:0,outOfOrder:0,ignoredUnseeded:0,ignoredInvalid:0},
  semantics:{LAST_INCLUDED:0,NEXT_EXPECTED:0,AMBIGUOUS:0,NO_EQUAL_SEQUENCE_UPDATES:0,MISMATCH:0},
  endEvents:0,endEventSeqMatches:0,verifications:[],reseeds:0};
 const fail=(r,{force=false}={})=>{failures.push({atMs:now(),reason:r});
  if(force||mode==='STRICT'||FATAL.has(r)){state='INVALID';reason=r}};
 const anomaly=k=>{st.anomalies[k]++;fail('ANOMALY_'+k)};
 const instrumentOk=f=>{if(f.symbol==null&&f.exchange==null){st.missingInstrument++;return true}
  if((symbol&&f.symbol!==symbol)||(exchange&&f.exchange!==exchange)){anomaly('wrongInstrument');return false}return true};
 const priceTicks=p=>{if(!Number.isFinite(p)||p<=0)return {err:'badPrice'};const t=Math.round(p/tick);
  return Math.abs(p/tick-t)>1e-6?{err:'offTick'}:{t}};
 const qtyOf=x=>typeof x==='bigint'&&x>0n&&x<=BigInt(Number.MAX_SAFE_INTEGER)?Number(x):null;
 // --- snapshot staging (strict validation; any defect rejects the whole snapshot) ---
 const stagePart=p=>{st.snapshotParts++;
  if(p.seq!==null)snap.seqs.add(p.seq);
  if(!instrumentOk(p)){snap.bad??='WRONG_INSTRUMENT';return}
  if(!p.ids.length)return;
  if(!p.aligned){snap.bad??='SNAPSHOT_MISALIGNED';return}
  if(p.side!==1&&p.side!==2){snap.bad??='SNAPSHOT_BAD_SIDE';return}
  const pt=priceTicks(p.price);if(pt.err){snap.bad??='SNAPSHOT_'+pt.err.toUpperCase();return}
  p.ids.forEach((id,i)=>{
   if(typeof id!=='string'||!id.length||id.length>64){snap.bad??='SNAPSHOT_BAD_ORDER_ID';return}
   if(snap.staging.has(id)){snap.bad??='SNAPSHOT_DUPLICATE_ORDER_ID';return}
   const q=qtyOf(p.sizes[i]);if(q===null){snap.bad??='SNAPSHOT_BAD_SIZE';return}
   snap.staging.set(id,{side:p.side,t:pt.t,q,p:p.priorities[i]==null?null:String(p.priorities[i])})});
  if(snap.staging.size>maxOrders)snap.bad??='ORDER_LIMIT'};
 const snapshotVerdict=p=>{if(p.rpCode!=='0')return 'SNAPSHOT_REJECTED_'+(p.rpCode??'NONE');
  if(snap.bad)return snap.bad;if(!snap.staging.size)return 'SNAPSHOT_EMPTY';
  if(!snap.seqs.size)return 'SNAPSHOT_NO_SEQUENCE';if(snap.seqs.size>1)return 'SNAPSHOT_SEQUENCE_INCONSISTENT';return null};
 // --- updates, always through the same sequence and integrity checks ---
 const applyEntries=(map,u)=>{
  for(const e of u.entries){st.entries++;
   if(e.side!==1&&e.side!==2){anomaly('badSide');continue}
   if(typeof e.orderId!=='string'||!e.orderId.length){anomaly('badOrderId');continue}
   const cur=map.get(e.orderId);
   if(e.type===UPDATE.DELETE){if(!cur){anomaly('deleteMissing');continue}map.delete(e.orderId);continue}
   if(e.type!==UPDATE.NEW&&e.type!==UPDATE.CHANGE){anomaly('misaligned');continue}
   const pt=priceTicks(e.price);if(pt.err){anomaly(pt.err);continue}
   const q=e.size==null&&cur?cur.q:qtyOf(e.size);if(q===null){anomaly('badSize');continue}
   if(e.type===UPDATE.NEW&&cur)anomaly('newExisting');
   if(e.type===UPDATE.CHANGE&&!cur){anomaly('changeMissing');continue}
   map.set(e.orderId,{side:e.side,t:pt.t,q,p:e.priority==null?(cur?.p??null):String(e.priority)});
   if(map.size>maxOrders){fail('ORDER_LIMIT');return}}};
 const applyChecked=(map,u,ref)=>{st.updates++;
  if(!u.aligned){anomaly('misaligned');return}
  if(u.seq===null){st.missingSequence++;anomaly('missingSequence');if(mode==='STRICT')return}
  else if(ref.v!==null){
   if(u.seq<ref.v){st.outOfOrder++;anomaly('outOfOrder');return}
   if(u.seq===ref.v)st.equalSeq++;
   else if(u.seq>ref.v+1n){st.gaps++;st.gapTotal=String(BigInt(st.gapTotal)+(u.seq-ref.v-1n));
    fail('SEQUENCE_GAP');if(mode==='STRICT')return}}
  applyEntries(map,u);if(u.seq!==null&&(ref.v===null||u.seq>ref.v))ref.v=u.seq};
 const applyLive=u=>{const ref={v:lastSeq};applyChecked(orders,u,ref);lastSeq=ref.v;lastAppliedAt=now()};
 const diff=(a,b)=>{const d=ZERO();
  for(const [id,o] of b){const x=a.get(id);if(!x){d.missingInBook++;continue}
   if(x.side!==o.side||x.t!==o.t)d.priceOrSideMismatch++;else if(x.q!==o.q)d.sizeMismatch++}
  for(const id of a.keys())if(!b.has(id))d.extraInBook++;
  d.total=d.missingInBook+d.extraInBook+d.sizeMismatch+d.priceOrSideMismatch;return d};
 const cloneMap=m=>new Map([...m].map(([k,v])=>[k,{...v}]));
 const finishVerification=(S)=>{
  const lt=[],eq=[],gt=[];
  for(const u of snap.buffer){if(u.seq===null)gt.push(u);else if(u.seq<S)lt.push(u);else if(u.seq===S)eq.push(u);else gt.push(u)}
  const work=cloneMap(orders),ref={v:lastSeq};
  for(const u of lt)applyChecked(work,u,ref);
  const dLt=diff(work,snap.staging);
  const workEq=cloneMap(work),refEq={v:ref.v};
  for(const u of eq)applyChecked(workEq,u,refEq);
  const dLe=diff(workEq,snap.staging);
  const semantics=!eq.length?'NO_EQUAL_SEQUENCE_UPDATES':dLe.total===0&&dLt.total!==0?'LAST_INCLUDED':
   dLt.total===0&&dLe.total!==0?'NEXT_EXPECTED':dLt.total===0&&dLe.total===0?'AMBIGUOUS':'MISMATCH';
  st.semantics[semantics]++;const match=dLt.total===0||dLe.total===0;
  st.verifications.push({completed:true,snapshotSeq:String(S),orders:snap.staging.size,bufferedUpdates:snap.buffer.length,
   equalSeqUpdates:eq.length,diffBeforeEqualSeq:dLt,diffAfterEqualSeq:dLe,semantics,match,completedAtMs:now()});
  // Reseed from the authoritative snapshot; replay what the snapshot does not contain.
  orders=snap.staging;st.reseeds++;
  if(semantics==='NEXT_EXPECTED'){lastSeq=S-1n;snap=null;for(const u of [...eq,...gt])applyLive(u);return}
  if(!match)fail('VERIFICATION_MISMATCH');
  lastSeq=S;snap=null;
  if(state==='INVALID')return; // STRICT mismatch: stays INVALID; failure history preserved
  for(const u of gt)applyLive(u)};
 return {
  get state(){return state},get reason(){return reason},get orderCount(){return orders.size},
  get lastSeq(){return lastSeq===null?null:String(lastSeq)},get verifying(){return snap?.kind==='VERIFY'},
  get snapshotPending(){return snap!==null},get failures(){return failures.slice()},
  stats(){return JSON.parse(JSON.stringify({...st,failures}))},
  // Explicit (re)seed. Call BEFORE sending 117/115 so updates arriving meanwhile are buffered.
  beginSnapshot(requestId=null){state='SEEDING';reason=null;orders=new Map();lastSeq=null;
   snap={kind:'SEED',requestId,staging:new Map(),seqs:new Set(),buffer:[],bad:null}},
  beginVerification(requestId=null){if(state!=='VALID'||snap)return false;
   snap={kind:'VERIFY',requestId,staging:new Map(),seqs:new Set(),buffer:[],bad:null};return true},
  onSnapshotPart(p){
   if(!snap){st.unsolicitedParts++;return}
   if(p.userMsg!=null){if(snap.requestId&&p.userMsg!==snap.requestId){st.mismatchedParts++;return}st.correlatedParts++}
   else st.unechoedParts++;
   stagePart(p);
   if(!p.final)return;
   const bad=snapshotVerdict(p);const S=bad?null:[...snap.seqs][0];
   if(snap.kind==='SEED'){
    if(bad){fail(bad,{force:true});snap=null;return}
    orders=snap.staging;lastSeq=S;st.snapshotsCompleted++;state='VALID';reason=null;lastAppliedAt=now();
    const buf=snap.buffer;snap=null;
    for(const u of buf){if(u.seq!==null&&u.seq<=S){st.droppedOverlap++;continue}
     st.replayedAfterSeed++;applyLive(u);if(state==='INVALID')break}
    return}
   if(bad){st.verifications.push({completed:false,reason:bad,completedAtMs:now()});fail('VERIFY_'+bad);
    const buf=snap.buffer;snap=null;if(state!=='INVALID')for(const u of buf)applyLive(u);return}
   finishVerification(S)},
  onUpdate(u){
   if(!instrumentOk(u))return;
   if(state==='UNSEEDED'){st.anomalies.ignoredUnseeded++;return}
   if(state==='INVALID'&&!snap){st.anomalies.ignoredInvalid++;return}
   if(snap){if(snap.buffer.length>=maxBuffered){fail('BUFFER_LIMIT');snap=null;return}
    if(snap.kind==='SEED')st.bufferedDuringSeed++;snap.buffer.push(u);return}
   applyLive(u)},
  onEndEvent(e){if(!instrumentOk(e))return;st.endEvents++;
   if(e.seq!==null&&lastSeq!==null&&e.seq===lastSeq)st.endEventSeqMatches++},
  reset(r='RECONNECT'){state='UNSEEDED';reason=r;orders=new Map();lastSeq=null;snap=null;lastAppliedAt=null},
  levels(){const bid=new Map(),ask=new Map();
   for(const o of orders.values()){const m=o.side===SIDE.BID?bid:ask;const l=m.get(o.t)||{qty:0,orders:0};
    l.qty+=o.q;l.orders++;m.set(o.t,l)}return {bid,ask}},
  top(){const {bid,ask}=this.levels();
   const bb=bid.size?Math.max(...bid.keys()):null,ba=ask.size?Math.min(...ask.keys()):null;
   return {bid:bb===null?null:bb*tick,ask:ba===null?null:ba*tick,
    bidQty:bb===null?null:bid.get(bb).qty,askQty:ba===null?null:ask.get(ba).qty}},
  // Observed resting orders only. An absent price is NOT_OBSERVED (never 0): full-depth completeness
  // is not proven. Distances are from each side's own touch. Suppressed unless VALID and fresh.
  coverage(distancesPts=[10,20,30,50],{maxAgeMs=10000}={}){
   const base={distanceBasis:'SIDE_TOUCH',completenessProven:false,bookOrders:orders.size,
    verifiedSnapshots:st.verifications.filter(v=>v.match).length};
   if(snap)return {...base,suppressed:true,reason:snap.kind==='SEED'?'SEEDING':'VERIFICATION_IN_PROGRESS'};
   if(state!=='VALID')return {...base,suppressed:true,reason:'BOOK_'+state};
   if(lastAppliedAt!==null&&now()-lastAppliedAt>maxAgeMs)return {...base,suppressed:true,reason:'STALE'};
   const {bid,ask}=this.levels();
   const side=(m,dir,touch)=>{if(!m.size)return null;const keys=[...m.keys()];
    const best=dir<0?Math.max(...keys):Math.min(...keys),far=dir<0?Math.min(...keys):Math.max(...keys);
    return {touch,best:best*tick,farthestObserved:far*tick,observedSpanPts:Math.abs(far-best)*tick,levelsWithOrders:m.size,
     rows:distancesPts.map(d=>{const target=best+dir*Math.round(d/tick);let sum=0,lv=0;
      for(const [t,l] of m)if(dir<0?(t<=best&&t>=target):(t>=best&&t<=target)){sum+=l.qty;lv++}
      const lvl=m.get(target);
      return {distancePts:d,price:target*tick,observation:lvl?'OBSERVED_ORDERS':'NOT_OBSERVED',
       observedQtyAtPrice:lvl?lvl.qty:null,observedOrdersAtPrice:lvl?lvl.orders:null,
       observedQtyTouchToPrice:sum,levelsWithOrdersTouchToPrice:lv,
       targetWithinObservedSpan:dir<0?far<=target:far>=target}})}};
   return {...base,suppressed:false,bid:side(bid,-1,'BEST_BID'),ask:side(ask,1,'BEST_ASK')}},
 };
}
