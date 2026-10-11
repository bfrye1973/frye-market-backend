// Engine 22 read-only Submicro migration candidate from an existing canonical
// Micro lifecycle state. NEVER rewrites its source or persists candidate state.
// Explicit approval and replay validation belong to the publication gate.
import {validateCanonicalMicroState} from "../microV2/canonicalMicroState.js";
export const SUBMICRO_MIGRATION_SCHEMA="engine22.submicroMigrationCandidate.v1";
const clone=x=>JSON.parse(JSON.stringify(x));
export function buildSubmicroMigrationCandidate({sourceMicroState=null,parentMicroCountId=null}={}){
 const v=validateCanonicalMicroState(sourceMicroState);
 if(!v.ok) return {ok:false,reasonCodes:["INVALID_SOURCE_MICRO_CANONICAL_STATE",...v.errors]};
 const parent=String(parentMicroCountId||"").trim();
 if(!parent) return {ok:false,reasonCodes:["PARENT_MICRO_COUNT_ID_REQUIRED"]};
 const sourceId=sourceMicroState.countId;
 const id=`ES-SUBMICRO-MIGRATED-FROM-${sourceId}`;
 const seq=`ES-SUBMICRO-SEQ-FROM-${sourceMicroState.sequenceId}`;
 if(id===sourceId||seq===sourceMicroState.sequenceId||parent===id)
   return {ok:false,reasonCodes:["COUNT_ID_COLLISION"]};
 const candidate={
   schema:SUBMICRO_MIGRATION_SCHEMA,degree:"SUBMICRO",countId:id,sequenceId:seq,
   migrationStatus:"PROPOSED_READ_ONLY",parentContext:{degree:"MICRO",countId:parent},
   sourceProvenance:{sourceDegree:"MICRO",sourceCountId:sourceId,
      sourceSequenceId:sourceMicroState.sequenceId,sourceRevision:sourceMicroState.revision,
      sourceSchema:sourceMicroState.schema,sourceTimestamp:sourceMicroState.sourceTimestamp},
   sequenceDirection:sourceMicroState.sequenceDirection,
   countStatus:sourceMicroState.countStatus,activeWave:sourceMicroState.activeWave,
   origin:clone(sourceMicroState.origin),waves:clone(sourceMicroState.waves),
   history:clone(sourceMicroState.history||[]),
   publicationEligible:false,automationEligible:false,noPermissionCreated:true,
   noExecution:true,noSizing:true,noManagement:true,noJournalMutation:true
 };
 return {ok:true,candidate};
}
