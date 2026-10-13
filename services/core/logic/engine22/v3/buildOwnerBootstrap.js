// Additive, read-only V3 initialization from owner-supplied Micro/Submicro
// and existing five manual higher-degree records. Never loads durable Micro V2.
// IDs identify the new V3 baseline, NOT historical Micro count identities.
import {ENGINE22_V3_SCHEMA,ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT,validateEngine22V3Canonical} from "./canonicalStructure.js";
const clone=x=>structuredClone(x);
const owner={
 // Owner-directed OCT 13 V3 research count. Does not rewrite official wave files.
 // Internal A/B/C turns are unconfirmed: do not recycle superseded Submicro W1/W2.
 INTRADAY_SUBMICRO:{
  activeWave:null,ownerCorrectionState:"SUBMICRO_ABC_INSIDE_MICRO_W2",
  role:"MICRO_W2_INTERNAL_ABC_DOWN",sequenceDirection:"DOWN",
  correctionDirection:"DOWN",parentWave:"W2",anchors:{},
  ownerAbcTurns:{
   A:{price:7787.50,time:"2026-10-08 10:30",status:"OWNER_IDENTIFIED"},
   B:{price:7886.50,time:"2026-10-11 21:00",status:"OWNER_IDENTIFIED"},
   C:{price:null,time:null,status:"DEVELOPING_UNCONFIRMED"},
  },
 },
 // Only W1 low has a supplied timestamp. W1 high *price* is accepted from the
 // owner, but its date/time remains unverified; never mark a dated high locked.
 MICRO:{
  activeWave:"W2",ownerCorrectionState:"MICRO_W2_OWNER_RECOUNT",
  sequenceDirection:"UP",correctionDirection:"DOWN",
  ownerW1HighPrice:7897.50,ownerW1HighTimeVerified:false,
  ownerReportedTouchKeys:["r236"],
  anchors:{W1_LOW:[7677.25,"2026-10-01 08:30"]},
 },
 // User's Subminute W3 read is tracked as owner provisional context; former
 // dated manual source has no confirmed W2 low or W3 anchor to promote.
 SUBMINUTE:{
  activeWave:"W3",ownerCorrectionState:"SUBMINUTE_W3_OWNER_CONTEXT",
  sequenceDirection:"UP",ownerApproxW2Low:7700,anchors:{},
 },
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
   parentDegree:ENGINE22_V3_PARENT[d],parentWave:supplied?.parentWave??historical?.parentWave??null,
   activeWave:supplied?.activeWave??historical?.activeWave??null,
   sequenceDirection:supplied?.sequenceDirection??waveOneSequenceDirection(anchors),
   ownerCorrectionState:supplied?.ownerCorrectionState??null,
   ownerRole:supplied?.role??null,
   correctionDirection:supplied?.correctionDirection??null,
   ownerW1HighPrice:supplied?.ownerW1HighPrice??null,
   ownerW1HighTimeVerified:supplied?.ownerW1HighTimeVerified??null,
   ownerReportedTouchKeys:supplied?.ownerReportedTouchKeys?clone(supplied.ownerReportedTouchKeys):[],
   ownerApproxW2Low:supplied?.ownerApproxW2Low??null,
   ownerAbcTurns:supplied?.ownerAbcTurns?clone(supplied.ownerAbcTurns):null,
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
