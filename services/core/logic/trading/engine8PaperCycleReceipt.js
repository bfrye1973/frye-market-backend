// Diagnostic only. Never changes execution decisions or retries orders.
const code = v => typeof v === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(v) ? v : null;
const bool = v => typeof v === "boolean" ? v : null;
export function buildPaperCycleReceipt(step, observedAt) {
 const base = {event:"ENGINE8_PAPER_CYCLE_RECEIPT", observedAt, code:Number.isInteger(step?.code)?step.code:null};
 try {
  const p=JSON.parse(step.stdout);
  if (!p || typeof p !== "object" || Array.isArray(p) || !code(p.status)) throw Error("invalid");
  return {...base,status:code(p.status),reason:code(p.reason),
   adapterStatus:code(p.engine8?.status),executable:bool(p.engine8?.executable),
   blockers:Array.isArray(p.engine8?.blockers)?p.engine8.blockers.slice(0,30).map(code).filter(Boolean):null,
   skipped:bool(p.skipped),orderCreated:bool(p.execution?.orderCreated),
   fillCreated:bool(p.execution?.fillCreated),journalCompleted:bool(p.execution?.journalCompleted),
   journalPending:bool(p.execution?.journalPending),executionStatus:code(p.execution?.status)};
 } catch {return {...base,status:"RESULT_UNAVAILABLE"};}
}
