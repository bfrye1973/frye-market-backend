// #412: independent fixture-compatible summary of observed upstream decisions.
// Input is normalized original Replay evidence, not fabricated cycle receipts.
// Missing snapshots and between-cycle activity remain unproven.
export function summarizeObservedApprovalWindow({snapshots,start,end}={}){
 const a=Date.parse(start),b=Date.parse(end);
 if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)throw Error("INVALID_WINDOW");
 const counts={},rows=[],issues=new Set(),seen=new Set();
 if(!Array.isArray(snapshots))issues.add("REPLAY_UNAVAILABLE");
 for(const s of Array.isArray(snapshots)?snapshots:[]){
  const t=Date.parse(s?.observedAt);
  if(!Number.isFinite(t)||t<a||t>=b||typeof s?.strategyId!=="string"){issues.add("INVALID_REPLAY_OBSERVATION");continue;}
  const k=JSON.stringify([s.strategyId,t]);if(seen.has(k)){issues.add("DUPLICATE_REPLAY_OBSERVATION");continue;}seen.add(k);
  const approval=typeof s.engine6Allowed==="boolean"?s.engine6Allowed:null;
  const executable=typeof s.engine8Executable==="boolean"?s.engine8Executable:null;
  const blocker=typeof s.firstBlocker==="string"?s.firstBlocker:null;
  const reason=typeof s.rootCause==="string"?s.rootCause:null;
  let status="UNKNOWN";
  if(approval===false&&executable===false&&s.orderCreated===false&&blocker&&reason){status="UPSTREAM_BLOCKED";counts[blocker]=(counts[blocker]??0)+1;}
  else if(approval===true&&executable===false&&s.orderCreated===false)status="APPROVAL_OBSERVED_ENGINE8_NOT_EXECUTABLE";
  else if(approval===true)status="APPROVAL_OBSERVED";
  if(status==="UNKNOWN")issues.add("OBSERVATION_INCOMPLETE");
  rows.push({observedAt:s.observedAt,strategyId:s.strategyId,engine6Allowed:approval,engine8Executable:executable,firstBlocker:blocker,rootCause:reason,status});
 }
 rows.sort((x,y)=>Date.parse(x.observedAt)-Date.parse(y.observedAt));
 const approvals=rows.filter(x=>x.engine6Allowed===true).length;
 return {schemaVersion:"engine8.observedApprovalWindow.v1",observedCount:rows.length,observedApprovals:approvals,firstBlockerCounts:counts,classification:approvals?"APPROVAL_OBSERVED":rows.length&&rows.every(x=>x.status==="UPSTREAM_BLOCKED")&&!issues.size?"NO_APPROVAL_OBSERVED":"UNKNOWN",coverage:"UNPROVEN",dailyFillVerdict:"UNKNOWN",rows,issues:[...issues]};
}
