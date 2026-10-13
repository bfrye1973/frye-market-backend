// Additive, read-only V3 initialization from owner-supplied Micro/Submicro
// and existing five manual higher-degree records. Never loads durable Micro V2.
// IDs identify the new V3 baseline, NOT historical Micro count identities.
import {ENGINE22_V3_SCHEMA,ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT,validateEngine22V3Canonical} from "./canonicalStructure.js";
const clone=x=>structuredClone(x);
const owner={
 INTRADAY_SUBMICRO:{activeWave:"W3",anchors:{
  W1_LOW:[7782.50,"2026-10-08 10:00"],W1_HIGH:[7853.75,"2026-10-09 05:00"],
  W2_LOW:[7826.25,"2026-10-09 06:00"]}},
 MICRO:{activeWave:"W5",anchors:{
  W1_LOW:[7675,"2026-10-01 07:00"],W1_HIGH:[7805,"2026-10-02 07:00"],
  W2_LOW:[7757.75,"2026-10-05 03:00"],W3_HIGH:[7897.75,"2026-10-06 07:00"],
  W4_LOW:[7782.75,"2026-10-08 07:00"]}},
};
function waveOneSequenceDirection(anchors){
 const lo=anchors?.W1_LOW,hi=anchors?.W1_HIGH;
 if(!lo || !hi || !Number.isFinite(Date.parse(lo.time)) ||
    !Number.isFinite(Date.parse(hi.time)) ||
    Date.parse(lo.time)===Date.parse(hi.time))return null;
 // Elliott impulse direction is based on the temporal W1 endpoint sequence,
 // not on price-label sorting or the current corrective market bias.
 return Date.parse(lo.time)<Date.parse(hi.time)?"UP":"DOWN";
}
function marks(raw){
 const out={};
 for(const [wave,v] of Object.entries(raw??{})){
  if(v?.price!=null)out[wave]={price:v.price,time:v.time??null,status:v.status==="CONFIRMED"?"CONFIRMED":"DEVELOPING"};
  else for(const side of ["low","high"])if(v?.[side]?.price!=null)
   out[wave+"_"+side.toUpperCase()]={price:v[side].price,time:v[side].time??null,status:v.status==="CONFIRMED"?"CONFIRMED":"DEVELOPING"};
 }
 return out;
}
export function buildEngine22V3OwnerBootstrap({activeWaveState=null}={}){
 if(activeWaveState?.symbol!=="ES"||!activeWaveState.activeStructures)
  return {available:false,reasonCodes:["CANONICAL_MANUAL_SOURCE_MISSING"],canonical:null};
 const degrees={};
 for(const d of ENGINE22_V3_DEGREES){
  const supplied=owner[d];
  const historical=activeWaveState.activeStructures[d.toLowerCase()];
  if(!supplied&&!historical)return {available:false,reasonCodes:[d+"_SOURCE_MISSING"],canonical:null};
  const anchors=supplied?Object.fromEntries(Object.entries(supplied.anchors).map(([k,[price,time]])=>[k,{price,time,status:"CONFIRMED"}])):marks(historical.marks);
  degrees[d]={
   degreeId:d,countId:"ES-V3-BASELINE-"+d,sequenceId:"ES-V3-SEQUENCE-"+d,
   parentDegree:ENGINE22_V3_PARENT[d],parentWave:historical?.parentWave??null,
   activeWave:supplied?.activeWave??historical?.activeWave??null,
   sequenceDirection:waveOneSequenceDirection(anchors),
   lifecycle:supplied?"DEVELOPING":historical?.stage??"DEVELOPING",
   anchors,history:[{event:"OWNER_V3_BASELINE" ,historicalTransitionsKnown:false,
     source:supplied?"OWNER_CONFIRMED_ANCHORS":"EXISTING_MANUAL_STRUCTURE",
     originalSnapshot:supplied?null:clone(historical)}],
   provenance:{source:supplied?"OWNER_CONFIRMED_ANCHORS":"ACTIVE_WAVE_STATE_ES",
    historicalMigration:"DEFERRED",previousMicroNotAccessed:true,
    sourceUpdatedAt:activeWaveState.updatedAt??null},
   invalidation:{},fibModel:{levels:[],source:"DERIVED_ONLY"},
  };
 }
 const canonical={schema:ENGINE22_V3_SCHEMA,symbol:"ES",
  sourceTimestamp:activeWaveState.updatedAt??"MANUAL_SOURCE_UNDATED",
  noPermissionCreated:true,noExecution:true,degrees};
 const valid=validateEngine22V3Canonical(canonical);
 return {available:valid.ok,reasonCodes:valid.errors,canonical:valid.ok?canonical:null,
  shadowOnly:true,historyMigrationDeferred:true};
}
