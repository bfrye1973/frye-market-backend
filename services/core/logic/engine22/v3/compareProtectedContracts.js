// Engine22 V3 — read-only contract comparison. This is a verification tool,
// never a shadow structural owner or live downstream publisher.
const clone=x=>structuredClone(x);
const keys=["degreeStates","currentWavelength","microExecutionContext",
 "engine22Display","waveOpportunity","currentLifecycleState","activeFibModel"];
export function compareEngine22V3ProtectedOutputs({legacy=null,candidate=null}={}){
 if(!legacy||!candidate)return {pass:false,reasonCodes:["BOTH_SNAPSHOTS_REQUIRED"],differences:[]};
 const differences=[];
 for(const key of keys){
  const before=legacy[key] ?? null,after=candidate[key] ?? null;
  if(JSON.stringify(before)!==JSON.stringify(after)){
   differences.push({key,before:clone(before),after:clone(after)});
  }
 }
 const sideEffectKeys=["tradeDecision","tradeContextSummary","topCandidate","action","bias",
 "engine26Strategy1","engine28ManualPaper","engine27Strategies","engine6Permission"];
 const protectedChanges=sideEffectKeys.filter(key=>
  JSON.stringify(legacy[key]??null)!==JSON.stringify(candidate[key]??null));
 return {pass:differences.length===0&&protectedChanges.length===0,
   differences,protectedChanges,
   reasonCodes:differences.length||protectedChanges.length?["CONTRACT_DRIFT_REQUIRES_REVIEW"]:[],
 };
}

/**
 * Shadow-only compatibility preview. Existing consumers keep their exact
 * legacy contract shapes; independent V3 degree truth is a sidecar.
 * This function neither publishes nor writes either representation.
 */
export function buildEngine22V3CompatibilityPreview({legacy=null,shadow=null}={}){
 if(!legacy || typeof legacy!=="object" || !shadow?.available || shadow.shadowOnly!==true)
  return {available:false,reasonCodes:["LEGACY_AND_VALID_V3_SHADOW_REQUIRED"]};
 const candidate=clone(legacy);
 candidate.engine22V3Shadow=clone(shadow);
 const comparison=compareEngine22V3ProtectedOutputs({legacy,candidate});
 return {available:true,shadowOnly:true,pass:comparison.pass,
  protectedContractComparison:comparison,candidate,
  publicationEligible:false,noExecution:true,noPermissionCreated:true};
}
