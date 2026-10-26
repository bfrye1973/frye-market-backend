// Engine22E Micro V2 migration REHEARSAL only.
// This audits copies of the ORIGINAL count states/JSONL records in memory.
// It does not transform missing history into fabricated events, select an
// active canonical pointer, or modify Micro V2 files.
import {validateCanonicalMicroState} from "../microV2/canonicalMicroState.js";
import {projectEngine22CountLineage} from "./projectCountLineage.js";
export const ENGINE22_MICRO_MIGRATION_REHEARSAL_SCHEMA="engine22.microV2MigrationRehearsal.v1";
const str=x=>typeof x==="string"&&x.length>0;
const invalid=(code)=>({ok:false,safeToMigrate:false,reasonCodes:[code],
  verifiedCountIds:[],uncertainties:[],noExecution:true,shadowOnly:true});
export function rehearseEngine22MicroV2Migration({
  counts=[],transitions=[],recounts=[],activeCount=null,instrumentContextId="ES-CONTINUOUS"
}={}){
 if(!str(instrumentContextId)||!Array.isArray(counts)||!Array.isArray(transitions)||
    !Array.isArray(recounts)||!counts.length)return invalid("COMPLETE_MICRO_V2_INPUT_REQUIRED");
 const original=new Map();
 for(const state of counts){
   if(!validateCanonicalMicroState(state).ok||!str(state.countId)||
      /^ES-V3-BASELINE-/i.test(state.countId)||
      !Number.isSafeInteger(state.revision)||state.revision<0||
      original.has(state.countId))return invalid("INVALID_OR_DUPLICATE_ORIGINAL_COUNT");
   original.set(state.countId,state);
 }
 const uncertainty=[];
 for(const [id,state] of original){
   const history=transitions.filter(t=>t?.countId===id);
   const revisions=history.map(h=>h.revision);
   if(history.some(h=>!Number.isSafeInteger(h.revision)||h.revision<1)||
     new Set(revisions).size!==revisions.length)return invalid("INVALID_TRANSITION_REVISION_SET");
   const ordered=[...revisions].sort((a,b)=>a-b);
   for(let r=1;r<=state.revision;r++){
     if(ordered[r-1]!==r)uncertainty.push({countId:id,code:"TRANSITION_REVISION_EVIDENCE_MISSING",revision:r});
   }
   if(ordered.some(r=>r>state.revision))
     return invalid("TRANSITION_EXCEEDS_COUNT_REVISION");
 }
 for(const t of transitions){
   if(!original.has(t?.countId))return invalid("ORPHAN_TRANSITION_COUNT");
 }
 for(const record of recounts){
   if(!str(record?.oldCountId)||!str(record?.newCountId)||
     record.oldCountId===record.newCountId||
     !original.has(record.oldCountId)||!original.has(record.newCountId))
      return invalid("RECOUNT_LINEAGE_INCOMPLETE");
   if(original.get(record.oldCountId).countStatus!=="HISTORICAL"||
      original.get(record.oldCountId).supersededByCountId!==record.newCountId)
      return invalid("RECOUNT_PREVIOUS_COUNT_MISMATCH");
 }
 if(activeCount){
   if(!validateCanonicalMicroState(activeCount).ok||
      !original.has(activeCount.countId)||
      activeCount.countStatus==="HISTORICAL")
      return invalid("ACTIVE_POINTER_CONFLICT");
   if(JSON.stringify(activeCount)!==JSON.stringify(original.get(activeCount.countId)))
      return invalid("ACTIVE_COUNT_COPY_DISAGREEMENT");
 }
 const imported=counts.map(c=>({
   originalCountId:c.countId,originalSequenceId:c.sequenceId,originalRevision:c.revision,
   countStatus:c.countStatus,sourceTimestamp:c.sourceTimestamp,
   provenance:"MICRO_V2_SOURCE_STATE",preserveRawRecord:true
 }));
 // No synthetic timestamp, transition, recount or authorized 22G approval event
 // is generated. A separate migration implementation must store raw originals.
 return {ok:true,schema:ENGINE22_MICRO_MIGRATION_REHEARSAL_SCHEMA,
   safeToMigrate:uncertainty.length===0,
   reasonCodes:uncertainty.length?["MISSING_HISTORICAL_REVISION_EVIDENCE"]:["ORIGINAL_MICRO_V2_EVIDENCE_INTERNALLY_CONSISTENT"],
   verifiedCountIds:[...original.keys()],originalStates:imported,
   transitionRecords:transitions.length,recountRecords:recounts.length,
   uncertainties:uncertainty,
   syntheticHistoryCreated:false,activeCountId:activeCount?.countId??null,
   activePointerChangeAuthorized:false,noExecution:true,noPermissionCreated:true,shadowOnly:true};
}
