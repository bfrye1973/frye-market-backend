// Engine22 owner working-count transition proposal — 2026-10-27.
// Owner nominated a shared 7648.50 reference on Oct 23 07:00 Arizona.
// This is an explicitly PROVISIONAL recount plan, not verified Elliott completion.
// No existing wave models, touches, canonical pointers, or trading data are mutated.
export const ENGINE22_OWNER_OCT23_RECOUNT_SCHEMA="engine22.ownerOct23LowerDegreeRecountProposal.v1";
const nominated=Object.freeze({
  price:7648.50,
  localTime:"2026-10-23 07:00",
  timezone:"America/Phoenix",
  instant:"2026-10-23T14:00:00.000Z",
  basis:"OWNER_CHART_NOMINATED_NOT_CANDLE_VERIFIED",
});
const snapshots=Object.freeze([
  ["submicro","engine22.submicroCDownOwnerWatch.v1","UPWARD_STRUCTURE_REVIEW"],
  ["micro","engine22.microCDownOwnerWatch.v1","UPWARD_STRUCTURE_REVIEW"],
  ["subminute","engine22.subminuteCurrentCDownReference.v1","D_UP_DEVELOPING_CANDIDATE"],
]);
export function buildEngine22Oct23OwnerRecountProposal({currentWavelength=null}={}){
 const degrees=currentWavelength?.degrees;
 if(!degrees||typeof degrees!=="object")return {ok:false,reasonCodes:["CURRENT_DEGREE_MODELS_REQUIRED"],approvedForPublication:false};
 const entries={};
 for(const [degree,expectedModel,next] of snapshots){
  const existing=degree==="subminute"?degrees[degree]?.ownerCurrentCDown:
    degree==="micro"?degrees[degree]?.ownerMicroCDown:
    degrees[degree]?.ownerSubmicroCDown;
  if(existing?.version!==expectedModel || existing?.activeWave!=="C" ||
    existing?.direction!=="DOWN")
   return {ok:false,reasonCodes:["EXPECTED_OWNER_C_DOWN_VERSION_MISMATCH",degree],
     approvedForPublication:false,noExecution:true};
  entries[degree]={
   degree,priorModelVersion:expectedModel,
   priorWave:"C",priorDirection:"DOWN",priorModelPreserved:true,
   nominatedCDownEndpoint:{...nominated},
   completionStatus:"OWNER_PROPOSED_PENDING_INDEPENDENT_STRUCTURAL_VALIDATION",
   proposedNextStructure:next,
   changeType:"OWNER_RECOUNT_REVIEW_ONLY",
   canonicalCountId:null,activePointerChangeAuthorized:false,
   tradePermissionCreated:false,
  };
 }
 const minute=degrees.minute?.ownerMinuteW2Retracement;
 if(minute?.version!=="engine22.minuteW2RetracementOwner.v1" ||
   minute.activeWave!=="W2"||minute.nextWaveStarted!==false)
  return {ok:false,reasonCodes:["MINUTE_W2_PROTECTION_REQUIRED"],
    approvedForPublication:false,noExecution:true};
 return {
  ok:true,schema:ENGINE22_OWNER_OCT23_RECOUNT_SCHEMA,
  source:"OWNER_DIRECTED_2026_10_27",
  models:entries,
  minutePreservation:{
   activeWave:"W2",correctionComplete:false,
   nextWave:"W3",nextWaveStarted:false,
   originalMinuteModelVersion:minute.version,
  },
  reasons:[
   "OWNER_LOW_REFERENCE_NOT_AUTHENTICATED_TO_OHLC",
   "THREE_DEGREES_MUST_BE_VALIDATED_SEPARATELY",
   "NO_AUTO_CONFIRMATION_OR_ACTIVE_COUNT_TRANSITION",
  ],
  approvedForPublication:false,activePointerChangeAuthorized:false,
  requiresEngine22ManagerReleaseReview:true,legacyModelsPreserved:true,
  noExecution:true,noPermissionCreated:true,shadowOnly:true,
 };
}
