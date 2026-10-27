// Source-controlled owner-authorized selection manifest. Changes to the approved
// model require a reviewed manifest revision, never an Engine27 selector change.
// No market-price or timestamp heuristic is permitted to approve a model.
export const OWNER_APPROVED_SELECTION_SCHEMA="engine22.ownerApprovedWorkingSelection.v1";
export const ownerApprovedWorkingSelection=Object.freeze({
  schema:OWNER_APPROVED_SELECTION_SCHEMA,
  selectionRevision:1,
  approvalReference:"OWNER_WORKING_COUNTS_2026_10_27",
  degrees:Object.freeze({
    submicro:Object.freeze({key:"ownerSubmicroFiveUp",modelVersion:"engine22.submicroFiveUpOct27OwnerWatch.v1",activeWave:"W5",direction:"UP",stage:"PROJECTED_W5_WATCH",parentDegree:"micro",parentWave:"W3"}),
    micro:Object.freeze({key:"ownerMicroW3Up",modelVersion:"engine22.microW3UpOct27Owner.v1",activeWave:"W3",direction:"UP",stage:"DEVELOPING_CANDIDATE",parentDegree:"subminute",parentWave:"D"}),
    subminute:Object.freeze({key:"ownerCurrentDUp",modelVersion:"engine22.subminuteDUpOwnerWorking.v1",activeWave:"D",direction:"UP",stage:"DEVELOPING_CANDIDATE",parentDegree:"minute",parentWave:"W2"}),
    minute:Object.freeze({key:"ownerMinuteW2Retracement",modelVersion:"engine22.minuteW2RetracementOwner.v1",activeWave:"W2",direction:"DOWN",stage:"DEVELOPING",parentDegree:"minor",parentWave:null}),
    minor:Object.freeze({key:null,source:"degreeStates"}),
    intermediate:Object.freeze({key:null,source:"degreeStates"}),
    primary:Object.freeze({key:null,source:"degreeStates"}),
  })
});
