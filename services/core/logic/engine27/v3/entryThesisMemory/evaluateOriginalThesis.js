import {THESIS_SCHEMA,ENTRY_CONTRACT} from "../contracts/entryThesisMemory.v1.js";
const validTime = s=> typeof s==="string" && Number.isFinite(Date.parse(s));
const text = s=>typeof s==="string"&&s.trim().length>0;
const UP_DOWN=new Set(["UP","DOWN"]);
const opposite=(a,b)=>UP_DOWN.has(a)&&UP_DOWN.has(b)&&a!==b;
function unavailable(code,tradeId=null){return {schema:THESIS_SCHEMA,mode:"READ_ONLY",degree:"micro",available:false,state:"ENTRY_STRUCTURE_UNAVAILABLE",tradeId,entryThesis:null,currentComparison:null,reasonCodes:[code],noExecution:true,noPermissionCreated:true,noJournalWrite:true,noOrderModification:true};}
export function evaluateOriginalThesis({trade=null,currentOwner=null,currentNeighbors=null,ownerInvalidationEvidence=null}={}){
 const id=trade?.tradeId??null;
 if(trade?.accountMode!=="REAL"||trade?.brokerAccountLabel!=="SCHWAB_6380"||!text(id)||!["LONG","SHORT"].includes(trade?.direction))
   return unavailable("MICRO_REAL_TRADE_IDENTITY_UNAVAILABLE",id);
 const entry=trade.structuralContextAtEntry;
 if(entry?.available!==true||entry?.contractVersion!==ENTRY_CONTRACT||entry?.immutable!==true||
   entry?.historicalBackfill!==false||entry?.provenance!=="ENGINE22_CANONICAL_SNAPSHOT"||
   entry?.ownerDegree!=="micro"||entry?.accountRole!=="MICRO"||
   entry?.captureTiming!=="LIVE_SNAPSHOT_AT_ENGINE10_INGEST")return unavailable("ENTRY_PROVENANCE_NOT_VERIFIED",id);
 if(!validTime(entry.fillTime)||!validTime(entry.snapshotTime)||!validTime(entry.capturedAt)||
   Date.parse(entry.snapshotTime)>Date.parse(entry.capturedAt)||
   Date.parse(entry.fillTime)>Date.parse(entry.capturedAt))
   return unavailable("ENTRY_CAPTURE_TIMESTAMPS_INVALID",id);
 // A snapshot later than the actual fill is NEVER admissible as the original thesis.
 if(Date.parse(entry.snapshotTime)>Date.parse(entry.fillTime))return unavailable("ENTRY_SNAPSHOT_POSTDATES_FILL",id);
 const owner=entry.ownerState;
 if(owner?.degree!=="micro"||!text(owner.activeWave)||!UP_DOWN.has(owner.direction)||
   !text(owner.source)||!text(owner.countId))
   return unavailable("ENTRY_MICRO_OWNER_IDENTITY_MISSING",id);
 // Engine10's historical context cannot be completed using today's Engine22 model.
 const frozen={ownerDegree:"micro",countId:owner.countId,activeWave:owner.activeWave,direction:owner.direction,
   stage:owner.stage??null,lifecycle:owner.lifecycle??null,revision:owner.revision??null,
   source:owner.source,snapshotTime:entry.snapshotTime,fillTime:entry.fillTime,
   invalidation:owner.invalidation??null,setupIdentity:trade.setup?.candidateId??trade.identity?.candidateId??null};
 const base={schema:THESIS_SCHEMA,mode:"READ_ONLY",degree:"micro",available:true,tradeId:id,
   entryThesis:frozen,currentComparison:null,reasonCodes:[],noExecution:true,noPermissionCreated:true,noJournalWrite:true,noOrderModification:true};
 if(currentOwner?.degree!=="micro"||!text(currentOwner.countId)||!UP_DOWN.has(currentOwner.direction))
   return {...base,state:"THESIS_WEAKENING",reasonCodes:["CURRENT_OWNER_NOT_VERIFIED"],currentComparison:{available:false}};
 const current={available:true,countId:currentOwner.countId,direction:currentOwner.direction,activeWave:currentOwner.activeWave??null,
  structuralIdentityChanged:currentOwner.countId!==owner.countId};
 // Only explicit matched owner/count invalidation confirmation can establish BROKEN.
 const broken=ownerInvalidationEvidence?.source==="ENGINE22"&&
   ownerInvalidationEvidence?.confirmed===true&&ownerInvalidationEvidence?.degree==="micro"&&
   ownerInvalidationEvidence?.entryCountId===owner.countId&&
   text(ownerInvalidationEvidence.ruleVersion)&&validTime(ownerInvalidationEvidence.confirmedAt)&&
   Date.parse(ownerInvalidationEvidence.confirmedAt)<=Date.now();
 if(broken)return {...base,state:"THESIS_BROKEN",currentComparison:current,reasonCodes:["VERIFIED_ENTRY_COUNT_INVALIDATION"]};
 if(current.structuralIdentityChanged||opposite(owner.direction,current.direction)||
   (currentOwner.activeWave&&currentOwner.activeWave!==owner.activeWave))
   return {...base,state:"THESIS_WEAKENING",currentComparison:current,reasonCodes:["CURRENT_STRUCTURE_DIFFERS_FROM_ENTRY"]};
 const lower=currentNeighbors?.submicro;
 if(lower?.available!==true||!UP_DOWN.has(lower.direction))
   return {...base,state:"EARLY_WARNING",currentComparison:current,reasonCodes:["LOWER_DEGREE_EVIDENCE_UNAVAILABLE"]};
 if(opposite(lower.direction,owner.direction))
   return {...base,state:"LOWER_DEGREE_PULLBACK",currentComparison:current,reasonCodes:["COUNTERTREND_LOWER_DEGREE_NOT_INVALIDATION"]};
 return {...base,state:"ALIGNED",currentComparison:current,reasonCodes:["ENTRY_OWNER_STILL_ALIGNED"]};
}
