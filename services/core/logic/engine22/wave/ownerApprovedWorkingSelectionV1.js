// Source-controlled owner-authorized selection manifest. Changes to the approved
// model require a reviewed manifest revision, never an Engine27 selector change.
// No market-price or timestamp heuristic is permitted to approve a model.
export const OWNER_APPROVED_SELECTION_SCHEMA="engine22.ownerApprovedWorkingSelection.v1";
export const ownerApprovedWorkingSelection=Object.freeze({
  schema:OWNER_APPROVED_SELECTION_SCHEMA,
  selectionRevision:7,
  approvalReference:"OWNER_20261116_LATEST_MICRO_SUBMINUTE_ABC_SUBMICRO_W2_MINUTE_W2",
  degrees:Object.freeze({
    submicro:Object.freeze({key:"ownerSubmicroW3Nov9InternalResearch",modelVersion:"engine22.ownerSubmicroW3Nov9InternalResearch.v1",activeWave:"W2",direction:"DOWN",stage:"W2_DOWN_DEVELOPING_OWNER_RESEARCH",parentDegree:"micro",parentWave:"C",approvalReference:"OWNER_20261111_SUBMICRO_W1_END_7625_AND_20261116_W2_DOWN"}),
    micro:Object.freeze({key:"ownerMicroAbcDownNov16Research",modelVersion:"engine22.ownerMicroAbcDownNov16Research.v1",activeWave:"C",direction:"DOWN",stage:"C_DOWN_DEVELOPING_OWNER_RESEARCH",parentDegree:"subminute",parentWave:"C",approvalReference:"OWNER_20261116_MICRO_ABC_DOWN"}),
    subminute:Object.freeze({key:"ownerSubminuteAbcDownNov16Research",modelVersion:"engine22.ownerSubminuteAbcDownNov16Research.v1",activeWave:"C",direction:"DOWN",stage:"C_DOWN_DEVELOPING_OWNER_RESEARCH",parentDegree:"minute",parentWave:"W2",approvalReference:"OWNER_20261116_SUBMINUTE_ABC_DOWN"}),
    minute:Object.freeze({key:"ownerMinuteW1FormingNov9Research",modelVersion:"engine22.minuteW1FormingNov9Research.v1",activeWave:"W2",direction:"DOWN",stage:"W2_DOWN_DEVELOPING_OWNER_RESEARCH",parentDegree:"minor",parentWave:"W3_OWNER_WORKING_RESEARCH",approvalReference:"OWNER_20261111_MINUTE_W1_HIGH_7671_W2_DOWN"}),
    minor:Object.freeze({key:null,source:"degreeStates"}),
    intermediate:Object.freeze({key:null,source:"degreeStates"}),
    primary:Object.freeze({key:null,source:"degreeStates"}),
  })
});
