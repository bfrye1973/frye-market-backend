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
export function encodeDboSnapshotRequest({symbol,exchange}){checkInstrument(symbol,exchange);
 return Buffer.concat([num(F.templateId,115),str(F.symbol,symbol),str(F.exchange,exchange)])}
export function encodeDboUpdatesRequest({symbol,exchange,subscribe}){checkInstrument(symbol,exchange);
 return Buffer.concat([num(F.templateId,117),num(F.request,subscribe?1:2),
  str(F.symbol,symbol),str(F.exchange,exchange)])}

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
 const ids=strs(m,F.orderId),sizes=sizesOf(m),pri=big(m,F.priority),price=dbls(m,F.price)[0]??null;
 const side=one(m,F.side);
 const aligned=sizes.length===ids.length&&(pri.length===0||pri.length===ids.length);
 return {final:rp.length>0,rpCode:rp[0]??null,more:rq.length>0,seq:one(m,F.sequence),
  side:side===null?null:Number(side),price,ids,sizes,priorities:pri,aligned,
  symbol:strs(m,F.symbol)[0]??null};
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
 return {seq:one(m,F.sequence),aligned,entries,count:n,symbol:strs(m,F.symbol)[0]??null};
}
export function parseEndEvent(frame){
 const m=decodeExact(frame);if(Number(one(m,F.templateId))!==161)throw Error('not 161');
 return {seq:one(m,F.sequence)};
}
export function parseUpdatesAck(frame){
 const m=decodeExact(frame);const rp=strs(m,F.rpCode);return {accepted:rp.length>=1&&rp[0]==='0',rpCode:rp[0]??null};
}

// --- book ---
const ZERO=()=>({missingInBook:0,extraInBook:0,sizeMismatch:0,priceOrSideMismatch:0});
export function createDboBook({tick=0.25,mode='STRICT',maxOrders=300000,maxBuffered=300000}={}){
 if(mode!=='STRICT'&&mode!=='OBSERVE')throw Error('mode must be STRICT or OBSERVE');
 let state='UNSEEDED',reason=null,orders=new Map(),lastSeq=null;
 let staging=null,buffer=null,stagingSeqs=null,verifying=false;
 const st={snapshotsCompleted:0,snapshotParts:0,snapshotSeqSpread:0,bufferedDuringSeed:0,
  droppedOverlap:0,replayedAfterSeed:0,updates:0,entries:0,equalSeq:0,gaps:0,gapTotal:'0',
  outOfOrder:0,anomalies:{newExisting:0,changeMissing:0,deleteMissing:0,misaligned:0,
  offTick:0,badSize:0,badSide:0,ignoredUnseeded:0},endEvents:0,endEventSeqMatches:0,
  verifications:[],reseeds:0};
 const ticks=p=>{const t=Math.round(p/tick);if(Math.abs(p/tick-t)>1e-6){st.anomalies.offTick++;return null}return t};
 const invalidate=r=>{if(state!=='INVALID'){state='INVALID';reason=r}};
 const anomaly=k=>{st.anomalies[k]++;if(mode==='STRICT')invalidate('ANOMALY_'+k)};
 const addOrder=(map,id,side,price,size,priority)=>{
  if(side!==SIDE.BID&&side!==SIDE.ASK){st.anomalies.badSide++;return false}
  const t=ticks(price);const q=typeof size==='bigint'?toSafe(size):null;
  if(t===null)return false;if(q===null||q<=0){st.anomalies.badSize++;return false}
  map.set(id,{side,t,q,p:priority===null?null:String(priority)});
  if(map.size>maxOrders){invalidate('ORDER_LIMIT');return false}return true};
 const stagePart=(p,map,seqs)=>{st.snapshotParts++;
  if(p.seq!==null)seqs.add(p.seq);
  if(!p.ids.length)return true;
  if(!p.aligned||p.price===null){anomaly('misaligned');return false}
  p.ids.forEach((id,i)=>addOrder(map,id,p.side,p.price,p.sizes[i],p.priorities[i]??null));return true};
 const snapSeqOf=seqs=>{if(!seqs.size)return null;const a=[...seqs].sort((x,y)=>x<y?-1:x>y?1:0);
  if(a.length>1)st.snapshotSeqSpread=Math.max(st.snapshotSeqSpread,a.length);return a[a.length-1]};
 const applyEntries=(map,u)=>{
  for(const e of u.entries){st.entries++;
   const cur=map.get(e.orderId);
   if(e.type===UPDATE.NEW){if(cur)anomaly('newExisting');addOrder(map,e.orderId,e.side,e.price,e.size,e.priority)}
   else if(e.type===UPDATE.CHANGE){if(!cur){anomaly('changeMissing');continue}
    addOrder(map,e.orderId,e.side,e.price,e.size??BigInt(cur.q),e.priority??(cur.p===null?null:BigInt(cur.p)))}
   else if(e.type===UPDATE.DELETE){if(!cur){anomaly('deleteMissing');continue}map.delete(e.orderId)}
   else anomaly('misaligned')}};
 const applyLive=u=>{st.updates++;
  if(!u.aligned){anomaly('misaligned');return}
  if(u.seq!==null&&lastSeq!==null){
   if(u.seq<lastSeq){st.outOfOrder++;if(mode==='STRICT')return invalidate('SEQUENCE_OUT_OF_ORDER')}
   else if(u.seq===lastSeq)st.equalSeq++;
   else if(u.seq>lastSeq+1n){st.gaps++;st.gapTotal=String(BigInt(st.gapTotal)+(u.seq-lastSeq-1n));
    if(mode==='STRICT')return invalidate('SEQUENCE_GAP')}}
  applyEntries(orders,u);if(u.seq!==null&&(lastSeq===null||u.seq>lastSeq))lastSeq=u.seq};
 const diff=(a,b)=>{const d=ZERO();
  for(const [id,o] of b){const x=a.get(id);if(!x){d.missingInBook++;continue}
   if(x.side!==o.side||x.t!==o.t)d.priceOrSideMismatch++;else if(x.q!==o.q)d.sizeMismatch++}
  for(const id of a.keys())if(!b.has(id))d.extraInBook++;
  d.total=d.missingInBook+d.extraInBook+d.sizeMismatch+d.priceOrSideMismatch;return d};
 const cloneMap=m=>new Map([...m].map(([k,v])=>[k,{...v}]));
 return {
  get state(){return state},get reason(){return reason},get orderCount(){return orders.size},
  get lastSeq(){return lastSeq===null?null:String(lastSeq)},get verifying(){return verifying},
  stats(){return JSON.parse(JSON.stringify(st))},
  // Call BEFORE sending 117/115 so every update arriving meanwhile is buffered.
  beginSnapshot(){state='SEEDING';reason=null;staging=new Map();buffer=[];stagingSeqs=new Set();verifying=false},
  beginVerification(){if(state!=='VALID'||verifying)return false;
   verifying=true;staging=new Map();buffer=[];stagingSeqs=new Set();return true},
  onSnapshotPart(p){
   if(state!=='SEEDING'&&!verifying)return;
   stagePart(p,staging,stagingSeqs);
   if(!p.final)return;
   if(p.rpCode!=='0'){verifying=false;return invalidate('SNAPSHOT_REJECTED_'+(p.rpCode??'NONE'))}
   const S=snapSeqOf(stagingSeqs);
   if(verifying){
    // Compare at "seq < S" and at "seq <= S" to learn the snapshot sequence semantics.
    const lt=[],eq=[],gt=[];
    for(const u of buffer){if(u.seq===null||S===null)gt.push(u);else if(u.seq<S)lt.push(u);else if(u.seq===S)eq.push(u);else gt.push(u)}
    const work=cloneMap(orders);
    for(const u of lt)if(u.aligned)applyEntries(work,u);
    const dLt=diff(work,staging);
    for(const u of eq)if(u.aligned)applyEntries(work,u);
    const dLe=diff(work,staging);
    st.verifications.push({snapshotSeq:S===null?null:String(S),orders:staging.size,
     bufferedUpdates:buffer.length,diffBeforeEqualSeq:dLt,diffAfterEqualSeq:dLe,
     match:dLt.total===0||dLe.total===0});
    if(mode==='STRICT'&&dLt.total!==0&&dLe.total!==0)reason='RESEEDED_AFTER_MISMATCH';
    // Reseed from the authoritative snapshot, then apply later updates.
    orders=staging;lastSeq=S;st.reseeds++;verifying=false;
    for(const u of gt)applyLive(u);staging=null;buffer=null;
    if(state==='INVALID'&&mode==='OBSERVE'){state='VALID'}
    return}
   orders=staging;lastSeq=S;st.snapshotsCompleted++;state='VALID';
   for(const u of buffer){
    if(S!==null&&u.seq!==null&&u.seq<=S){st.droppedOverlap++;continue}
    st.replayedAfterSeed++;applyLive(u)}
   staging=null;buffer=null},
  onUpdate(u){
   if(state==='UNSEEDED'||state==='INVALID'&&!verifying){if(state==='UNSEEDED')st.anomalies.ignoredUnseeded++;return}
   if(state==='SEEDING'||verifying){
    if(buffer.length>=maxBuffered)return invalidate('BUFFER_LIMIT');
    if(state==='SEEDING')st.bufferedDuringSeed++;buffer.push(u);return}
   applyLive(u)},
  onEndEvent(e){st.endEvents++;if(e.seq!==null&&lastSeq!==null&&e.seq===lastSeq)st.endEventSeqMatches++},
  reset(r='RECONNECT'){state='UNSEEDED';reason=r;orders=new Map();lastSeq=null;staging=null;buffer=null;verifying=false},
  levels(){const bid=new Map(),ask=new Map();
   for(const o of orders.values()){const m=o.side===SIDE.BID?bid:ask;const l=m.get(o.t)||{qty:0,orders:0};
    l.qty+=o.q;l.orders++;m.set(o.t,l)}return {bid,ask}},
  top(){const {bid,ask}=this.levels();
   const bb=bid.size?Math.max(...bid.keys()):null,ba=ask.size?Math.min(...ask.keys()):null;
   return {bid:bb===null?null:bb*tick,ask:ba===null?null:ba*tick,
    bidQty:bb===null?null:bid.get(bb).qty,askQty:ba===null?null:ask.get(ba).qty}},
  // Quantities only at observed resting orders. "withinObservedRange" means some order rests at
  // or beyond the target price on that side; it does NOT prove every intervening price was quoted.
  coverage(distancesPts=[10,20,30,50]){
   const {bid,ask}=this.levels();const out={state,verified:st.verifications.some(v=>v.match),
    bookOrders:orders.size,bid:null,ask:null};
   const sideReport=(m,dir)=>{if(!m.size)return null;const keys=[...m.keys()];
    const best=dir<0?Math.max(...keys):Math.min(...keys),far=dir<0?Math.min(...keys):Math.max(...keys);
    const rows=distancesPts.map(d=>{const target=best+dir*Math.round(d/tick);
     let cum=0,lv=0;for(const [t,l] of m){if(dir<0?(t<=best&&t>=target):(t>=best&&t<=target)){cum+=l.qty;lv++}}
     const within=dir<0?far<=target:far>=target;
     return {distancePts:d,price:target*tick,withinObservedRange:within,
      qtyAtPrice:m.get(target)?.qty??(within?0:null),cumulativeQty:within?cum:null,
      levelsWithOrdersInRange:lv}});
    return {best:best*tick,farthest:far*tick,spanPts:Math.abs(far-best)*tick,levels:m.size,rows}};
   out.bid=sideReport(bid,-1);out.ask=sideReport(ask,1);return out},
 };
}
