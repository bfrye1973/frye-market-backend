// Engine 3 v6 Phase 2 read-only SLOW path: all directional evidence is
// recomputed from ONLY completed post-activation bars. No v5 pre-activation
// control, v5 establishedNow, Engine22 opinion, or Phase4 1m fast path.
import {build1mEvidence} from "../v5/timeframe/build1mEvidence.js";
import {build5mReaction} from "../v5/timeframe/build5mReaction.js";
import {buildPriceActionControl} from "../v5/priceAction/buildPriceActionControl.js";

const toRaw=bars=>(Array.isArray(bars)?bars:[]).map(b=>({
  time:b.startMs/1000,open:b.open,high:b.high,low:b.low,close:b.close,
}));
export function buildEngine3V6Phase2SlowControl({
 phase2Evidence=null,normalizedZoneInput=null,evaluationTimeMs=null,
}={}){
 const one=toRaw(phase2Evidence?.completed1mEligible);
 const five=toRaw(phase2Evidence?.completed5mEligible);
 const valid=phase2Evidence?.eligible===true&&normalizedZoneInput?.eligible===true&&
   phase2Evidence?.activationStartedAtMs!=null;
 const zoneInput=valid?normalizedZoneInput:{...normalizedZoneInput,eligible:false};
 const oneMinute=build1mEvidence({bars:one,normalizedZoneInput:zoneInput,evaluationTimeMs});
 const fiveMinute=build5mReaction({bars:five,normalizedZoneInput:zoneInput,evaluationTimeMs});
 const control=buildPriceActionControl({
   normalizedZoneInput:zoneInput,
   priceActionEvidence:five.length>=2?fiveMinute.completed:null,
   sourceResolution:"PHASE2_POST_ACTIVATION_COMPLETED_5M_ONLY",
 });
 const direction=control.controlState==="SELLERS_CONTROL"?"SHORT":
   control.controlState==="BUYERS_CONTROL"?"LONG":"NEUTRAL";
 const qualified=valid&&five.length>=2&&control.eligible===true&&
   control.controlResolved===true&&["GOOD","STRONG"].includes(control.quality);
 return {
  schema:"engine3.v6.phase2.slowControl.v1",mode:"SHADOW_READ_ONLY",
  qualified,direction:qualified?direction:"NEUTRAL",
  observedControl:control.controlState??"NO_CONTROL",
  observedQuality:control.quality??"WEAK",
  observedReactionBias:oneMinute?.completed?.reaction?.reactionBias??"NONE",
  postActivation1mCount:one.length,postActivation5mCount:five.length,
  oneMinute, fiveMinute, control,
  noPermissionCreated:true,noExecution:true,authoritativeDownstream:false,
  reasonCodes:[five.length<2?"INSUFFICIENT_POST_ACTIVATION_5M":"POST_ACTIVATION_5M_EVALUATED",
    qualified?"INDEPENDENT_POST_ACTIVATION_CONTROL_CONFIRMED":"POST_ACTIVATION_CONTROL_NOT_QUALIFIED"],
 };
}
export default buildEngine3V6Phase2SlowControl;
