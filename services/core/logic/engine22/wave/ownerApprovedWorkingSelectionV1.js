// Source-controlled owner-authorized selection manifest. Changes to the approved
// model require a reviewed manifest revision, never an Engine27 selector change.
// No market-price or timestamp heuristic is permitted to approve a model.
export const OWNER_APPROVED_SELECTION_SCHEMA="engine22.ownerApprovedWorkingSelection.v1";
export const ownerApprovedWorkingSelection=Object.freeze({
  schema:OWNER_APPROVED_SELECTION_SCHEMA,
  selectionRevision:5,
  approvalReference:"OWNER_SUBMICRO_TWO_OPTIONS_20261031",
  degrees:Object.freeze({
    submicro:Object.freeze({key:"submicroCompare",modelVersion:"engine22.submicroCompareNov1.v1",activeWave:"ALTERNATIVES",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",parentDegree:"micro",parentWave:"C"}),
    micro:Object.freeze({key:"ownerMicroCDownOct31",modelVersion:"engine22.microCDownOct31OwnerWorking.v1",activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",parentDegree:"subminute",parentWave:"C"}),
    subminute:Object.freeze({key:"ownerSubminuteCDownOct31",modelVersion:"engine22.subminuteCDownOct31OwnerWorking.v1",activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",parentDegree:"minute",parentWave:"W2"}),
    minute:Object.freeze({key:"ownerMinuteW2Retracement",modelVersion:"engine22.minuteW2RetracementOwner.v1",activeWave:"W2",direction:"DOWN",stage:"DEVELOPING",parentDegree:"minor",parentWave:null}),
    minor:Object.freeze({key:null,source:"degreeStates"}),
    intermediate:Object.freeze({key:null,source:"degreeStates"}),
    primary:Object.freeze({key:null,source:"degreeStates"}),
  })
});
