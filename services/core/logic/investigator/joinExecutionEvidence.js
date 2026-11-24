// services/core/logic/investigator/joinExecutionEvidence.js
//
// Joins a Replay decision to Engine 8 PAPER persisted orders/executions.
// Source: Engine 8 PAPER-only durable store (engine8PaperDurableStore.js),
//   <ENGINE8_PAPER_DATA_DIR>/paper-orders.json and paper-executions.json.
// Read-only. Never calls a broker, never calls a live API, never calls Engine 8
// functions. These files are mutable (cancellation rewrites orders), so every
// result carries store readAt + sha256.

import path from "node:path";

import { joinByIdentity, splitEventsByDecisionTime } from "./identityJoin.js";
import { readEvidenceJson, storeMeta } from "./readEvidenceFile.js";

const upper = (v) => (typeof v === "string" ? v.trim().toUpperCase() : null);
const str = (v) => (v === null || v === undefined || v === "" ? null : String(v));

export function normalizeEngine8Order(order) {
  const sig = order?.sourceSignal || {};
  return {
    kind: "ENGINE8_ORDER",
    ref: str(order?.orderId),
    // PAPER store: order.paper === true is required; anything else fails closed.
    mode: order?.paper === true ? "PAPER" : order?.paper === false ? "NON_PAPER" : null,
    strategyId: str(order?.strategyId),
    tradeId: null,
    orderId: str(order?.orderId),
    executionId: str(sig.executionId),
    planId: str(sig.planId),
    candidateId: str(sig.candidateId),
    action: upper(order?.action),
    side: upper(order?.side),
    qty: order?.qty ?? null,
    filledQty: order?.filledQty ?? null,
    avgPrice: order?.avgPrice ?? null,
    status: str(order?.status),
    eventTime: str(order?.filledAt ?? order?.ts),
    eventTimeField: order?.filledAt ? "filledAt" : order?.ts ? "ts" : null,
  };
}

function ambiguousOrders(matches, tier) {
  const openings = matches.filter((m) => m.action === "NEW_ENTRY");
  if (openings.length > 1) return true;
  if (tier === "candidate") {
    const plans = new Set(matches.map((m) => m.planId).filter(Boolean));
    if (plans.size > 1) return true;
  }
  return false;
}

/**
 * @param {object} p
 * @param {object} p.decision lane identity { strategyId, mode, decisionTime, orderId,
 *                            executionId, planId, candidateId, tradeId }
 * @param {string} p.storeDir Engine 8 PAPER data dir
 */
export function joinExecutionEvidence({ decision, storeDir, windowMs, maxRecords }) {
  const ordersRead = readEvidenceJson(path.join(storeDir, "paper-orders.json"));
  const execRead = readEvidenceJson(path.join(storeDir, "paper-executions.json"));
  const stores = [
    storeMeta(ordersRead, { label: "engine8.paper-orders", mutable: true }),
    storeMeta(execRead, { label: "engine8.paper-executions", mutable: true }),
  ];

  if (decision.mode !== "PAPER") {
    return { source: "ENGINE8_PAPER_STORE", status: "NOT_APPLICABLE", reason: "DECISION_MODE_NOT_PAPER", stores };
  }
  if (ordersRead.status !== "OK") {
    return { source: "ENGINE8_PAPER_STORE", status: ordersRead.status, reason: ordersRead.reason, stores };
  }
  if (!Array.isArray(ordersRead.value)) {
    return { source: "ENGINE8_PAPER_STORE", status: "ERROR", reason: "ORDERS_NOT_AN_ARRAY", stores };
  }

  const orders = ordersRead.value.map(normalizeEngine8Order);
  const join = joinByIdentity({
    decision,
    records: orders,
    tiers: ["orderId", "executionId", "planId", "candidate"],
    windowMs,
    maxRecords,
    isAmbiguous: ambiguousOrders,
  });

  // Executions are attached only through an already-matched orderId.
  let executions = [];
  if (join.status === "MATCHED" && execRead.status === "OK" && Array.isArray(execRead.value)) {
    const ids = new Set(join.matches.map((m) => m.orderId));
    executions = execRead.value
      .filter((e) => e?.orderId && ids.has(String(e.orderId)))
      .map((e) => ({
        kind: "ENGINE8_EXECUTION",
        orderId: String(e.orderId),
        action: upper(e.action),
        qty: e.qty ?? null,
        filledQty: e.filledQty ?? null,
        avgPrice: e.avgPrice ?? null,
        status: str(e.status),
        eventTime: str(e.ts),
        eventTimeField: e.ts ? "ts" : null,
      }));
  }

  const events = join.status === "MATCHED"
    ? join.matches.map((m) => ({
        eventType: "ENGINE8_ORDER_" + (m.status ? m.status.toUpperCase() : "RECORDED"),
        source: "ENGINE8_PAPER_STORE",
        eventTime: m.eventTime,
        eventTimeField: m.eventTimeField,
        orderId: m.orderId, action: m.action, side: m.side,
        qty: m.qty, filledQty: m.filledQty, avgPrice: m.avgPrice,
      }))
    : [];
  const split = splitEventsByDecisionTime(events, decision.decisionTime);

  return {
    source: "ENGINE8_PAPER_STORE",
    status: join.status,
    matchTier: join.matchTier,
    orders: join.matches,
    executions,
    ambiguousCandidates: join.ambiguousCandidates || [],
    conflicts: join.conflicts,
    excluded: join.excluded,
    notes: join.notes,
    truncated: join.truncated,
    priorEvents: split.prior,
    subsequentEvents: split.subsequent,
    undatedEvents: split.undated,
    stores,
  };
}
