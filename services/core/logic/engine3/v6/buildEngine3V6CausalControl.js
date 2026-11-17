// Phase2 v6-only causal control. Reuses the actual v5 evidence modules, but
// NEVER reuses v5 control calculated from pre-activation market bars.
import {build1mEvidence} from "../v5/timeframe/build1mEvidence.js";
import {build5mReaction} from "../v5/timeframe/build5mReaction.js";
import {buildPriceActionControl} from "../v5/priceAction/buildPriceActionControl.js";
const toRaw=b=>({time:b.startMs/1000,open:b.open,high:b.high,low:b.low,close:b.close});
const direction=c=>c==="BUYERS_CONTROL"?"LONG":c==="SELLERS_CONTROL"?"SHORT":"NEUTRAL";
export function buildEngine3V6CausalControl({
 phase2Evidence=null,normalizedZoneInput=null,evaluationTimeMs=null,
}={}){
 const one=(phase2Evidence?.completed1mEligible||[]).map(toRaw);
 const five=(phase2Evidence?.completed5mEligible||[]).map(toRaw);
 const zoneEligible=normalizedZoneInput?.eligible===true&&
   phase2Evidence?.eligible===true;
 const zone=zoneEligible?normalizedZoneInput:{...normalizedZoneInput,eligible:false};
 const observation=build1mEvidence({bars:one,normalizedZoneInput:zone,evaluationTimeMs});
 const validation=build5mReaction({bars:five,normalizedZoneInput:zone,evaluationTimeMs});
 const control=buildPriceActionControl({normalizedZoneInput:zone,
   priceActionEvidence:five.length>=2?validation.completed:null,
   sourceResolution:"POST_ACTIVATION_COMPLETED_5M_ONLY"});
 const observedDirection=direction(control.controlState);
 const qualified=zoneEligible&&five.length>=2&&control.eligible===true&&
   control.controlResolved===true&&["GOOD","STRONG"].includes(control.quality)&&
   observedDirection!=="NEUTRAL";
 return {schema:"engine3.v6.causalControl.v1",mode:"SHADOW_READ_ONLY",
  observation1m:observation,validation5m:validation,control,
  observedDirection,qualified,postActivationBars1m:one.length,
  postActivationBars5m:five.length,
  controlSource:"POST_ACTIVATION_COMPLETED_5M_EVIDENCE",
  v5CanonicalControlReused:false,
  noPermissionCreated:true,noExecution:true,
  reasonCodes:[qualified?"INDEPENDENT_CAUSAL_CONTROL_QUALIFIED":
    "WAITING_FOR_POST_ACTIVATION_MATURE_CONTROL"]};
}
export default buildEngine3V6CausalControl;
