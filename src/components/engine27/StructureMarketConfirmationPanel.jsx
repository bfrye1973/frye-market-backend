import React from "react";
// Pure, advisory display: caller supplies the evaluated warning. No trading actions.
export default function StructureMarketConfirmationPanel({warning}) {
 const state=warning?.state??"INSUFFICIENT_CONFIRMATION";
 const conflict=state==="STRUCTURE_MARKET_CONFLICT";
 const color=conflict?"#b91c1c":state==="INSUFFICIENT_CONFIRMATION"?"#92400e":"#334155";
 return <section aria-label="Elliott Wave confirmation" style={{border:"1px solid #cbd5e1",borderLeft:`5px solid ${color}`,borderRadius:8,padding:16}}>
  <h3 style={{margin:"0 0 10px"}}>ELLIOTT WAVE CONFIRMATION</h3>
  <p>Engine 22: {warning?.wave?.activeWave??"Unavailable"} {warning?.wave?.direction??""} — {warning?.wave?.stage??"Not verified"}</p>
  <p>Engine 25: {warning?.market?.score??"Unavailable"} / 100 — {warning?.market?.bias??"Not verified"}</p>
  <strong style={{color}} role="status">{warning?.headline??"MARKET CONFIRMATION UNAVAILABLE"}</strong>
  <p>{warning?.explanation??"Independent market confirmation is not available."}</p>
  {warning?.lowerDegreeConflicts?.length>0&&<p>Lower-degree disagreement: {warning.lowerDegreeConflicts.join(", ")}</p>}
  <small>Advisory only · {warning?.provenance==="RETROSPECTIVE_RESEARCH_NOT_ORIGINAL_WARNING"?"Retrospective research — not a historical live warning":"Provisional confirmation"} · Wave completion: {warning?.wave?.completionConfirmed?"Confirmed by Engine 22":"Not confirmed"}</small>
 </section>;
}
