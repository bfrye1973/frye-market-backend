// services/core/logic/investigator/joinJournalOutcome.js
//
// Joins a Replay decision to Engine 10 Journal lifecycle.
// Source: <TRADE_JOURNAL_DIR>/trade-journal.json (array of trades).
// The Journal is MUTABLE current state (temp+rename writer); results are
// labelled with journalReadAt and the file sha256. Never treated as a
// point-in-time snapshot. Read-only; never calls tradeJournalStore.js
// (its reader returns [] on a corrupt file, which would hide an error).
//
// Mode: trade.accountMode must be present. PAPER matches PAPER only.
// LIVE and REAL are both real-money modes and never match a PAPER decision.

import path from "node:path";

import { joinByIdentity, splitEventsByDecisionTime } from "./identityJoin.js";
import { readEvidenceJson, storeMeta } from "./readEvidenceFile.js";

const upper = (v) => (typeof v === "string" ? v.trim().toUpperCase() : null);
const str = (v) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function modeOf(accountMode) {
  const m = upper(accountMode);
  if (m === "PAPER") return "PAPER";
  if (m === "REAL" || m === "LIVE") return "REAL";
  return null;
}

export function normalizeJournalTrade(trade) {
  const id = trade?.identity || {};
  const link = trade?.orderLink || {};
  const setup = trade?.setup || {};
  return {
    kind: "ENGINE10_TRADE",
    ref: str(trade?.tradeId),
    mode: modeOf(trade?.accountMode),
    accountMode: upper(trade?.accountMode),
    strategyId: str(trade?.strategyId ?? id.strategyId),
    tradeId: str(trade?.tradeId ?? id.tradeId),
    orderId: str(id.orderId ?? link.orderId),
    executionId: str(id.executionId ?? link.executionId ?? id.openingExecutionId),
    planId: str(id.planId ?? setup.planId),
    candidateId: str(id.candidateId ?? setup.candidateId),
    eventTime: str(trade?.entry?.time ?? trade?.createdAt),
    eventTimeField: trade?.entry?.time ? "entry.time" : trade?.createdAt ? "createdAt" : null,
    trade,
  };
}

function ambiguousTrades(matches) {
  return new Set(matches.map((m) => m.tradeId).filter(Boolean)).size > 1;
}

function lifecycleOf(trade) {
  const qty = trade?.qty || {};
  const s = trade?.summary || {};
  return {
    tradeId: str(trade?.tradeId),
    accountMode: upper(trade?.accountMode),
    status: upper(trade?.status),
    direction: upper(trade?.direction),
    entry: {
      time: str(trade?.entry?.time),
      price: num(trade?.entry?.price),
      qty: num(trade?.entry?.qty),
      fillStatus: str(trade?.entry?.fillStatus),
    },
    qty: {
      originalQty: num(qty.originalQty),
      remainingQty: num(qty.remainingQty),
      cumulativeExitQuantity: num(qty.cumulativeExitQuantity),
    },
    outcome: {
      openTime: str(s.openTime),
      closeTime: str(s.closeTime),
      realizedPnL: num(s.realizedPnL),
      realizedPoints: num(s.realizedPoints),
      realizedR: num(s.realizedR),
      // Engine 10 states realizedPnL is GROSS; fees are not netted here.
      pnlBasis: s.realizedPnL === null || s.realizedPnL === undefined ? null : "GROSS_AS_RECORDED_BY_ENGINE10",
    },
  };
}

function eventsOf(trade) {
  const out = [];
  if (trade?.entry?.time) {
    out.push({
      eventType: "ENGINE10_ENTRY",
      source: "ENGINE10_JOURNAL",
      eventTime: str(trade.entry.time),
      eventTimeField: "entry.time",
      price: num(trade.entry.price),
      qty: num(trade.entry.qty),
    });
  }
  for (const e of Array.isArray(trade?.events) ? trade.events : []) {
    out.push({
      eventType: "ENGINE10_" + (upper(e?.eventType) || "EVENT"),
      source: "ENGINE10_JOURNAL",
      eventTime: str(e?.ts),
      eventTimeField: e?.ts ? "events[].ts" : null,
      price: num(e?.price),
      qtyClosed: num(e?.qtyClosed),
      remainingQty: num(e?.remainingQty),
      orderId: str(e?.orderId),
      executionId: str(e?.executionId),
      exitReason: str(e?.exitReason),
      stopReason: str(e?.stopReason),
      targetId: str(e?.targetId),
    });
  }
  return out;
}

export function joinJournalOutcome({ decision, journalDir, windowMs, maxRecords }) {
  const read = readEvidenceJson(path.join(journalDir, "trade-journal.json"));
  const store = storeMeta(read, { label: "engine10.trade-journal", mutable: true });
  const base = { source: "ENGINE10_JOURNAL", journalReadAt: read.readAt, store };

  if (read.status !== "OK") return { ...base, status: read.status, reason: read.reason };
  if (!Array.isArray(read.value)) return { ...base, status: "ERROR", reason: "JOURNAL_NOT_AN_ARRAY" };

  const records = read.value.map(normalizeJournalTrade);
  const join = joinByIdentity({
    decision,
    records,
    tiers: ["tradeId", "orderId", "executionId", "planId", "candidate"],
    windowMs,
    maxRecords,
    isAmbiguous: ambiguousTrades,
  });

  if (join.status !== "MATCHED") {
    return {
      ...base, status: join.status, matchTier: join.matchTier,
      ambiguousCandidates: join.ambiguousCandidates || [],
      conflicts: join.conflicts, excluded: join.excluded, notes: join.notes,
      trade: null, priorEvents: [], subsequentEvents: [], undatedEvents: [],
    };
  }

  const match = join.matches[0];
  const split = splitEventsByDecisionTime(eventsOf(match.trade), decision.decisionTime);
  return {
    ...base,
    status: "MATCHED",
    matchTier: join.matchTier,
    trade: lifecycleOf(match.trade),
    identity: {
      tradeId: match.tradeId, orderId: match.orderId, executionId: match.executionId,
      planId: match.planId, candidateId: match.candidateId, strategyId: match.strategyId,
    },
    conflicts: join.conflicts,
    excluded: join.excluded,
    notes: join.notes,
    priorEvents: split.prior,
    subsequentEvents: split.subsequent,
    undatedEvents: split.undated,
  };
}
