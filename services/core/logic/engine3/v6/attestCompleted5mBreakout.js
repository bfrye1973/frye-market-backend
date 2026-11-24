// Engine 3 Phase C SHADOW-ONLY causal breakout attestation.
// Not an Engine 26 zone mutation, production trading rule, or order authority.
// A completed 5m candle's *entire real body* must lie beyond the zone edge;
// preceding completed 5m range must have interacted with the authorized zone.
const finite = x => typeof x === "number" && Number.isFinite(x);
const directions = new Set(["LONG", "SHORT"]);
export function attestCompleted5mBreakout({
  completed5mEligible=[], zone=null, direction="NEUTRAL",
  evaluationTimeMs=null, activationStartedAtMs=null,
}={}) {
  const base={status:"UNVERIFIED",breakoutContext:null,
    reasonCode:"FULL_BODY_BREAK_NOT_ATTESTED",mode:"SHADOW_READ_ONLY",
    noPermissionCreated:true,noExecution:true};
  if(!directions.has(direction)||!zone||!finite(zone.low)||!finite(zone.high)||
      !finite(evaluationTimeMs)||!finite(activationStartedAtMs)||
      !Array.isArray(completed5mEligible)) return base;
  const bars=completed5mEligible.filter(b=>
    finite(b.open)&&finite(b.close)&&finite(b.high)&&finite(b.low)&&
    finite(b.closeTimeMs)&&b.closeTimeMs>activationStartedAtMs&&
    b.closeTimeMs<=evaluationTimeMs&&b.high>=b.low)
    .sort((a,b)=>a.closeTimeMs-b.closeTimeMs);
  if(bars.length<2) return base;
  const edge=direction==="LONG"?zone.high:zone.low;
  // Only the final completed bar may attest *current* establishment.
  const current=bars.at(-1),previous=bars.at(-2);
  const touched=previous.high>=zone.low&&previous.low<=zone.high;
  const bodyBeyond=direction==="LONG"
    ?current.open>edge&&current.close>edge
    :current.open<edge&&current.close<edge;
  if(!touched||!bodyBeyond)return base;
  return {status:"VERIFIED_COMPLETED_5M_BREAK",
    breakoutContext:{direction,edge,source:"COMPLETED_5M_FULL_BODY_BREAK",
      barCloseTimeMs:current.closeTimeMs},
    reasonCode:"CAUSAL_FULL_BODY_BREAK_ATTESTED",
    mode:"SHADOW_READ_ONLY",noPermissionCreated:true,noExecution:true};
}
export default attestCompleted5mBreakout;
