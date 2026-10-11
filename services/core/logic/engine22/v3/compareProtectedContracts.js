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
 const sideEffectKeys=["tradeDecision","tradeContextSummary","topCandidate","action","bias"];
 const protectedChanges=sideEffectKeys.filter(key=>
  JSON.stringify(legacy[key]??null)!==JSON.stringify(candidate[key]??null));
 return {pass:differences.length===0&&protectedChanges.length===0,
   differences,protectedChanges,
   reasonCodes:differences.length||protectedChanges.length?["CONTRACT_DRIFT_REQUIRES_REVIEW"]:[],
 };
}
