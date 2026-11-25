// Isolated Engine 22 proposed immutable node identity acceptance contract.
// Pure validation ONLY: no storage, production source selection, or chart permissions.
const DEGREES=["primary","intermediate","minor","minute","subminute","micro","submicro"];
const DEGREE_INDEX=new Map(DEGREES.map((d,i)=>[d,i]));
const EVENT_TYPES=new Set(["NODE_RECORDED","NODE_REVISED","NODE_STATUS_CHANGED"]);
const STATUSES=new Set(["RESEARCH","OWNER_APPROVED","SUPERSEDED","INVALIDATED"]);
const LIFECYCLES=new Set(["DEVELOPING","COMPLETION_CANDIDATE","CONFIRMED","LOCKED","SUPERSEDED","INVALIDATED"]);
const str=x=>typeof x==="string"&&x.trim().length>0;
const utc=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)&&!Number.isNaN(Date.parse(x));
const tick=x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&Math.abs(x*4-Math.round(x*4))<1e-8;
const fail=why=>{throw new Error("ENGINE22_NODE_IDENTITY_"+why);};
export const NODE_EVENT_SCHEMA="engine22.nodeHistoryEvent.v1";
export function validateNodeIdentityEvent(input) {
 if(!input||typeof input!=="object"||Array.isArray(input))fail("INVALID_EVENT");
 const e=structuredClone(input);
 if(e.schema!==NODE_EVENT_SCHEMA||!EVENT_TYPES.has(e.type))fail("SCHEMA_OR_TYPE");
 for(const k of ["eventId","nodeId","waveId","countId","modelVersion","sourceReference","sourceFingerprint","priceBasisId","contractSymbol","label"])
  if(!str(e[k]))fail("MISSING_"+k);
 if(!DEGREE_INDEX.has(e.degree))fail("DEGREE");
 if(!STATUSES.has(e.approvalStatus)||!LIFECYCLES.has(e.lifecycle))fail("STATUS");
 if(!Number.isSafeInteger(e.revision)||e.revision<1)fail("REVISION");
 if(!utc(e.publishedAt))fail("PUBLICATION_TIME");
 if(e.marketAt!==null&&!utc(e.marketAt))fail("MARKET_TIME");
 if(!tick(e.price))fail("PRICE_TICK");
 if(e.parentWaveId!==null&&(!str(e.parentWaveId)||e.parentWaveId===e.waveId))fail("PARENT");
 if(e.supersedesEventId!==null&&!str(e.supersedesEventId))fail("SUPERSEDES_EVENT");
 if(e.supersedesNodeId!==null&&(!str(e.supersedesNodeId)||e.supersedesNodeId===e.nodeId))fail("SUPERSEDES_NODE");
 if(e.lifecycle==="LOCKED"||e.lifecycle==="CONFIRMED"){
  if(e.approvalStatus!=="OWNER_APPROVED"||e.marketAt===null)fail("CONFIRMATION_REQUIRES_OWNER_APPROVAL_AND_TIME");
 }
 return e;
}
export function replayNodeIdentityEvents(events) {
 if(!Array.isArray(events))fail("EVENT_LIST");
 const byId=new Map(),history=new Map(),latest=new Map();
 const nodeCount=new Map(),eventOrder=[];
 for(const input of events){
  const e=validateNodeIdentityEvent(input);
  const canonical=JSON.stringify(e);
  if(byId.has(e.eventId)){
   if(byId.get(e.eventId)!==canonical)fail("EVENT_ID_CONFLICT");
   continue;
  }
  const old=latest.get(e.nodeId);
  if(!old){
   if(e.type!=="NODE_RECORDED"||e.revision!==1||e.supersedesEventId!==null)fail("FIRST_EVENT");
  } else {
   if(e.type==="NODE_RECORDED"||e.revision!==old.revision+1||e.supersedesEventId!==old.eventId)fail("REVISION_CHAIN");
   if(["waveId","countId","degree","parentWaveId"].some(k=>e[k]!==old[k]))fail("IDENTITY_MUTATION");
   if(e.type==="NODE_STATUS_CHANGED"&&["marketAt","price","label","contractSymbol","priceBasisId"].some(k=>e[k]!==old[k]))fail("STATUS_REWROTE_ANCHOR");
   if(old.lifecycle==="LOCKED"&&e.lifecycle!=="LOCKED"&&e.lifecycle!=="SUPERSEDED")fail("LOCKED_NODE_REWRITTEN");
  }
  if(e.supersedesNodeId!==null){
   const superseded=latest.get(e.supersedesNodeId);
   if(!superseded)fail("UNKNOWN_SUPERSEDED_NODE");
   if(superseded.degree!==e.degree)fail("CROSS_DEGREE_SUPERSESSION");
   if(superseded.countId===e.countId)fail("SUPERSESSION_REQUIRES_NEW_COUNT");
  }
  byId.set(e.eventId,canonical);
  latest.set(e.nodeId,e);
  if(!history.has(e.nodeId))history.set(e.nodeId,[]);
  history.get(e.nodeId).push(e);
  const key=e.countId+"\u0000"+e.waveId;
  const oldDegree=nodeCount.get(key);
  if(oldDegree!==undefined&&oldDegree!==e.degree)fail("WAVE_DEGREE_CONFLICT");
  nodeCount.set(key,e.degree);
  eventOrder.push(e);
 }
 const waves=new Map();
 for(const e of latest.values()){
  const key=e.countId+"\u0000"+e.waveId;
  const old=waves.get(key);
  if(old&&old.parentWaveId!==e.parentWaveId)fail("PARENT_CONFLICT");
  waves.set(key,{degree:e.degree,parentWaveId:e.parentWaveId,countId:e.countId});
 }
 for(const [key,w] of waves){
  if(w.parentWaveId===null)continue;
  const parent=waves.get(w.countId+"\u0000"+w.parentWaveId);
  if(parent){
   if(DEGREE_INDEX.get(parent.degree)>=DEGREE_INDEX.get(w.degree))fail("PARENT_DEGREE_ORDER");
   const visited=new Set([key]);let current=parent;
   while(current){const k=current.countId+"\u0000"+(current===parent?w.parentWaveId:current.waveId);
    if(visited.has(k))fail("PARENT_CYCLE");
    visited.add(k);
    if(current.parentWaveId===null)break;
    current=waves.get(current.countId+"\u0000"+current.parentWaveId);
   }
  }
 }
 // This is a candidate model contract, never a source of plot permission.
 return {schema:"engine22.nodeHistoryReplay.v1",eventCount:byId.size,
  nodes:[...latest.values()].map(e=>structuredClone(e)),
  history:[...history.entries()].map(([nodeId,h])=>({nodeId,revisions:h.map(e=>structuredClone(e))})),
  plotAllowed:false,noExecution:true,noPermissionCreated:true};
}
