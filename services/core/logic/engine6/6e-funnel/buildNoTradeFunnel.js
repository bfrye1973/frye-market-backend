// Engine 6E — read-only Strategy 1 no-trade diagnostic.
// Pure evaluator: no filesystem, network, execution, journal or permission writes.
// Executor evidence must be passed independently; a READY adapter is never a created order.
const SID = "intraday_scalp@10m";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const up = v => typeof v === "string" ? v.trim().toUpperCase() : "";
const codes = v => Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
const evidence = (v) => ({status: v?.status ?? null, blockers: codes(v?.blockers), reasonCodes: codes(v?.reasonCodes)});
const gate = (id, state, reason, observed = {}) => ({gate:id, state, reason, observed});
const absent = (id, reason="EVIDENCE_UNAVAILABLE") => gate(id,"UNAVAILABLE",reason);
const waiting = (id, reason) => gate(id,"WAIT",reason);
const blocked = (id, reason) => gate(id,"BLOCK",reason);
const passed = (id, observed={}) => gate(id,"PASS","QUALIFIED",observed);
const hasHard = v => ["COMPLETED","INVALIDATED","CANCELLED","RETIRED"].includes(up(v?.status??v?.candidateState)) || v?.hardBlocked === true || v?.invalidated === true || v?.candidateInvalidated === true || v?.locationInvalidated === true || codes(v?.blockers).some(x=>/INVALIDAT|MISMATCH|HARD_BLOCK|CONFLICT|DISABLED/.test(up(x)));
const truthful = (id, v, ok, neg, reason) => !isObj(v) ? absent(id) : ok ? passed(id,evidence(v)) : neg ? blocked(id,reason) : waiting(id,reason);
const advisory = v => isObj(v) ? {available:true, timestamp:v.timestamp??v.snapshotTime??v.generatedAt??null, status:v.status??v.state??null, dataDegraded:v.dataDegraded===true, reasonCodes:codes(v.reasonCodes)} : {available:false};
function match(executor, order, candidate, zone) {
  if (!isObj(executor) || !isObj(order) || !candidate || !zone) return false;
  const e = isObj(executor.execution) ? executor.execution : executor;
  if (e.candidateId !== candidate) return false;
  // Zone is mandatory if published by both; a missing executor zone requires a matching plan.
  if (e.zoneId != null && e.zoneId !== zone) return false;
  if (e.snapshotTime != null && order.snapshotTime != null && e.snapshotTime !== order.snapshotTime) return false;
  if (e.planId == null || order.planId == null || e.planId !== order.planId) return false;
  if (order.orderId != null && e.orderId != null && order.orderId !== e.orderId) return false;
  return Boolean(e.orderId || e.executionId) && e.orderCreated === true && e.ok !== false && executor.ok !== false;
}
export function buildNoTradeFunnel(snapshot, {executorResult=null, lifecycleOutcome=null}={}) {
  const root=isObj(snapshot)?snapshot:null;
  const s=root?.strategies?.[SID];
  const v=isObj(s)?s:null;
  const c=v?.engine26LocationCandidate;
  const r=v?.confluence?.context?.reaction?.paperScalpReaction;
  const p=v?.confluence?.context?.volume?.engine4AuthorizedReactionParticipation;
  const perm=v?.permission?.paper;
  const geom=v?.engine26ProposedGeometry, mgmt=v?.engine9OfficialManagementPlan;
  const size=v?.engine7PositionSizing?.finalSizingReady === true ? v.engine7PositionSizing : (v?.engine7SizingPreview?.finalSizingReady === true ? v.engine7SizingPreview : (v?.engine7PositionSizing ?? v?.engine7SizingPreview));
  const order=v?.engine8PaperOrder;
  const candidateId=c?.candidateId??null, zoneId=c?.zoneId??null;
  const direction=up(r?.direction||perm?.direction||c?.direction);
  const gates=[];
  gates.push(!root ? absent("G0","SNAPSHOT_MISSING") : root.ok === true && up(root.symbol)==="ES" && v ? passed("G0") : root.ok === false || (root.symbol && up(root.symbol)!=="ES") ? blocked("G0","SNAPSHOT_INVALID") : absent("G0","SNAPSHOT_SCHEMA_UNVERIFIED"));
  gates.push(truthful("G1",c,Boolean(candidateId&&zoneId&&!hasHard(c)),hasHard(c),"CANDIDATE_NOT_VALID"));
  const handoff=v?.engine26ReactionHandoff;
  const auth = handoff?.authorizeEngine3Evaluation ?? r?.authorizeEngine3Evaluation ?? r?.evaluationAuthorized ?? c?.engine3EvaluationAuthorized ?? c?.evaluationAuthorized;
  gates.push(auth === true ? passed("G2") : auth === false ? waiting("G2","REACTION_NOT_AUTHORIZED") : absent("G2","AUTHORIZATION_FIELD_UNAVAILABLE"));
  gates.push(truthful("G3",r,r?.allowed===true&&r?.engine3Strategy1QualifiedForEngine6===true&&["LONG","SHORT"].includes(up(r?.direction)),hasHard(r),"ENGINE3_NOT_QUALIFIED"));
  gates.push(truthful("G4",p,p?.allowed===true&&p?.participationConfirmed===true&&p?.hardBlocked!==true&&up(p?.direction||p?.intendedDirection)===up(r?.direction),hasHard(p),"ENGINE4_NOT_CONFIRMED"));
  gates.push(truthful("G5",perm,perm?.allowed===true&&up(perm?.decision)==="FAST_INTRADAY_PAPER_ALLOW",hasHard(perm)||perm?.decision==="BLOCK","ENGINE6_NOT_ALLOWED"));
  gates.push(!isObj(perm)?absent("G6"):perm.locked===true?passed("G6"):perm.locked===false?waiting("G6","ENGINE6_APPROVAL_NOT_LOCKED"):absent("G6","LOCK_FIELD_UNAVAILABLE"));
  const feasible=geom?.geometryReady === true && geom?.geometryFeasible === true ? true : geom?.geometryReady === false || geom?.geometryFeasible === false ? false : undefined;
  gates.push(!isObj(geom)?absent("G7"):feasible===true?passed("G7",evidence(geom)):feasible===false?waiting("G7","GEOMETRY_NOT_FEASIBLE"):absent("G7","GEOMETRY_FEASIBILITY_FIELD_UNAVAILABLE"));
  gates.push(truthful("G8",mgmt,mgmt?.managementReady===true,hasHard(mgmt),"MANAGEMENT_PLAN_NOT_READY"));
  const count=size?.finalContracts;
  gates.push(!isObj(size)?absent("G9"):size?.finalSizingReady===true&&Number.isInteger(count)&&count>=1?passed("G9",{contracts:count}):count!=null?waiting("G9","NO_VALID_FINAL_SIZE"):absent("G9","AUTHORITATIVE_FINAL_SIZE_UNAVAILABLE"));
  gates.push(!isObj(order)?absent("G10"):up(order.status)==="READY_TO_CREATE_PAPER_ORDER"&&order.executable===true?passed("G10",evidence(order)):hasHard(order)?blocked("G10","PAPER_ADAPTER_BLOCKED"):waiting("G10","PAPER_ADAPTER_NOT_READY"));
  const ex=isObj(executorResult?.execution)?executorResult.execution:executorResult;
  gates.push(match(executorResult,order,candidateId,zoneId)?passed("G11",{orderId:ex.orderId??null,executionId:ex.executionId??null,planId:ex.planId??null}):isObj(executorResult)&&ex?.rejected===true&&ex?.candidateId===candidateId&&ex?.planId===order?.planId?blocked("G11","EXECUTOR_REJECTED"):absent("G11","EXECUTOR_ORDER_CREATION_NOT_VERIFIED"));
  // Unreached downstream stages remain evidence-only; never create additional independent failures.
  const first=gates.find(x=>x.state!=="PASS")??null;
  return {schema:"engine6e.noTradeFunnel.v1",readOnly:true,symbol:"ES",strategyId:SID,
    snapshotTime:v?.snapshotTime??root?.snapshotTime??root?.generatedAt??null,
    price:c?.currentPrice??v?.price??null,candidateId,zoneId,
    candidateLifecycleStartTime:c?.candidateLifecycleStartTime??c?.zoneMemorySummary?.candidateLifecycleStartTime??null,
    direction:direction||null,
    firstFailedGate:first?.gate??null,firstFailureState:first?.state??null,
    gates:gates.map((x,i)=>first && i>gates.indexOf(first)?{...x,reached:false}: {...x,reached:true}),
    advisory:{engine6:v?.engine6AdvisoryContext??null,engine22:advisory(v?.engine22WaveStrategy?.authorizedWorkingStructure),engine25:advisory(v?.engine25Context??v?.engine25Participation),engine29:advisory(v?.engine29CrossMarketStress),engine27:advisory(v?.engine27MinuteDecision)},
    executor:{available:isObj(executorResult),orderCreated:match(executorResult,order,candidateId,zoneId),candidateId:ex?.candidateId??null,planId:ex?.planId??null,orderId:ex?.orderId??null,status:ex?.status??null},
    lifecycle:{available:isObj(lifecycleOutcome),status:lifecycleOutcome?.status??null}
  };
}
export default buildNoTradeFunnel;
