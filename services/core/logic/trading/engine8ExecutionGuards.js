// Engine 8 execution guards: the ONLY reasons Engine 8 may refuse an Engine 6-approved trade.
//
// Owner directive (#425, Nov 27, 2026): Engine 6 is the final authority on whether a trade
// is allowed. Engine 8 answers "what actually executed?". It never makes a permission
// decision and never stops an approved trade, except for:
//   1. Kill switch, PAPER-only and live-flag guards (checked at the bridge, route and broker
//      layers; unchanged).
//   2. The PAPER on/off switch (ENGINE8_PAPER_OPERATOR_DISABLED === "1").
//   3. The true duplicate guard: the same candidate, plan or idempotency key was already
//      ordered, the same trade is already active, or the same trade's fill is still waiting
//      for its Engine 10 Journal acknowledgment.
// Missing or mismatched upstream inputs (no Engine 9 plan, no Engine 7 size, identity or
// geometry mismatch) are not permission decisions; they are refused elsewhere with their
// own reason codes because there is nothing correct to execute.
//
// Removed (owner directive): the legacy one-time acceptance-trial lock and the
// "a Strategy 1 trade is already open" refusal. Preventing overlap is Engine 6's job.
// The acceptance file is still written on close as audit evidence but never gates an order.
//
// This pure function is shared by the snapshot adapter and the executor, so the two
// layers cannot drift. Order = priority; the first code is the primary reason.

export const ENGINE8_BLOCK_REASONS = Object.freeze({
  PAPER_TRADING_DISABLED: "PAPER trading switched off by the operator (ENGINE8_PAPER_OPERATOR_DISABLED)",
  IDEMPOTENCY_KEY_ALREADY_USED: "This exact instruction was already sent",
  PLAN_ALREADY_ORDERED: "An order already exists for this Engine 9 plan",
  CANDIDATE_ALREADY_ORDERED: "This Engine 26 candidate was already ordered or journaled",
  SAME_TRADE_ALREADY_ACTIVE: "This same candidate/plan already has an active Engine 8 trade",
  SAME_TRADE_JOURNAL_PENDING: "This same trade's fill is waiting for its Engine 10 Journal acknowledgment",
});

export function engine8ExecutionBlockers(duplicateState) {
  const s = duplicateState || {};
  const blockers = [];
  if (s.paperTradingDisabled === true) blockers.push("PAPER_TRADING_DISABLED");
  if (s.idempotencyKeyAlreadyUsed === true) blockers.push("IDEMPOTENCY_KEY_ALREADY_USED");
  if (s.orderExistsForPlanId === true) blockers.push("PLAN_ALREADY_ORDERED");
  if (s.candidateAlreadyOrdered === true) blockers.push("CANDIDATE_ALREADY_ORDERED");
  if (s.activeTradeIdExists === true) blockers.push("SAME_TRADE_ALREADY_ACTIVE");
  if (s.journalPendingExecution === true) blockers.push("SAME_TRADE_JOURNAL_PENDING");
  return blockers;
}

export function engine8PrimaryStatus(blockers) {
  if (!blockers || blockers.length === 0) return null;
  return blockers[0] === "PAPER_TRADING_DISABLED" ? "PAPER_TRADING_DISABLED" : "DUPLICATE_ORDER_BLOCKED";
}

export default engine8ExecutionBlockers;
