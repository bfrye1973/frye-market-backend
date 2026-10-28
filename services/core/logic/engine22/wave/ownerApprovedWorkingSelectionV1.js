// Source-controlled owner-authorized selection manifest. Changes to the approved
// model require a reviewed manifest revision, never an Engine27 selector change.
// No market-price or timestamp heuristic is permitted to approve a model.
export const OWNER_APPROVED_SELECTION_SCHEMA="engine22.ownerApprovedWorkingSelection.v1";
export const ownerApprovedWorkingSelection=Object.freeze({
  schema:OWNER_APPROVED_SELECTION_SCHEMA,
  selectionRevision:2,
  approvalReference:"OWNER_20261028_W4_A",
  degrees:Object.freeze({
    submicro:Object.freeze({key:"ownerSubmicroADownInsideMicroW4",modelVersion:"engine22.submicroADownMicroW4Oct28OwnerWorking.v1",activeWave:"A",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",parentDegree:"micro",parentWave:"W4"}),
    micro:Object.freeze({key:"ownerMicroW4Down",modelVersion:"engine22.microW4DownOct28OwnerWorking.v1",activeWave:"W4",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",parentDegree:"subminute",parentWave:"D"}),
    subminute:Object.freeze({key:"ownerCurrentDUp",modelVersion:"engine22.subminuteDUpOwnerWorking.v1",activeWave:"D",direction:"UP",stage:"DEVELOPING_CANDIDATE",parentDegree:"minute",parentWave:"W2"}),
    minute:Object.freeze({key:"ownerMinuteW2Retracement",modelVersion:"engine22.minuteW2RetracementOwner.v1",activeWave:"W2",direction:"DOWN",stage:"DEVELOPING",parentDegree:"minor",parentWave:null}),
    minor:Object.freeze({key:null,source:"degreeStates"}),
    intermediate:Object.freeze({key:null,source:"degreeStates"}),
    primary:Object.freeze({key:null,source:"degreeStates"}),
  })
});
