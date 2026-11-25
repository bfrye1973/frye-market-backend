// Owner-directed CURRENT research selection after Nov 23 recount.
// Archived revision 7 remains the default for older point-in-time snapshots.
import {ownerApprovedWorkingSelection} from "./ownerApprovedWorkingSelectionV1.js";
import {OWNER_RECOUNT_V8_VERSION,OWNER_RECOUNT_V8_EFFECTIVE_AT} from "./buildOwnerRecountDegreesV8.js";
const select=(degree,wave,direction,stage,parentDegree,parentWave)=>Object.freeze({
 key:"ownerRecountNov23V8",
 modelVersion:`${OWNER_RECOUNT_V8_VERSION}.${degree}`,
 activeWave:wave,direction,stage,parentDegree,parentWave,
 approvalReference:"OWNER_20261123_CLEAR_LOWER_DEGREE_COUNTS_AND_RECOUNT_MICRO_SUBMICRO"
});
export const ownerApprovedWorkingSelectionV8=Object.freeze({
 ...ownerApprovedWorkingSelection,
 selectionRevision:8,
 approvalReference:"OWNER_20261123_CLEAR_MINOR_MINUTE_SUBMINUTE_MICRO_UP_CANDIDATE_SUBMICRO_UNRESOLVED",
 effectiveAtUtc:OWNER_RECOUNT_V8_EFFECTIVE_AT,
 degrees:Object.freeze({
   ...ownerApprovedWorkingSelection.degrees,
   minor:select("minor","RECOUNT","NEUTRAL","CURRENT_COUNT_CLEARED_RECOUNT_PENDING","intermediate","W1"),
   minute:select("minute","RECOUNT","NEUTRAL","CURRENT_COUNT_CLEARED_RECOUNT_PENDING","minor","RECOUNT"),
   subminute:select("subminute","RECOUNT","NEUTRAL","CURRENT_COUNT_CLEARED_RECOUNT_PENDING","minute","RECOUNT"),
   micro:select("micro","W1","UP","W1_UP_CANDIDATE_UNCONFIRMED","subminute","RECOUNT"),
   submicro:select("submicro","UNRESOLVED","NEUTRAL","CONSOLIDATION_UNRESOLVED","micro","W1")
 })
});
