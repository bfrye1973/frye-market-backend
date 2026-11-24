// services/core/tests/fixtures/tradeInvestigator/syntheticScenarios.js
//
// SYNTHETIC fixtures for the Engine 12 Trade Investigator.
//
// Edge-case SHAPES modelled on the documented Nov 24 outcomes, using the real
// Replay field layout. They are NOT production bytes and are used only for
// mutation/edge tests. Real acceptance uses the production-hash-verified
// fixtures in ./real-2026-11-24 (tests/tradeInvestigatorRealNov24.test.js).
//
// Lifecycle cases (OPEN / PARTIAL / CLOSED) are SYNTHETIC and use 2026-11-24
// only because the authority registry is evidence-backed for that date alone.
// They run in isolated temp directories and describe no real Nov 24 trade.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const S1 = "intraday_scalp@10m";

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Strategy 1 lane in the real Replay layout. Pass null to omit an engine. */
export function lane({
  e26a, e3, e3v6 = null, e4, e4v2 = null, e6, e26b, e7, e9, e8, e10 = null, e28a = null, extra = {},
}) {
  const reaction = {};
  if (e3) reaction.paperScalpReaction = e3;
  if (e3v6) reaction.engine3V6Shadow = e3v6;
  const volume = {};
  if (e4) volume.engine4AuthorizedReactionParticipation = e4;
  if (e4v2) volume.engine4V2Shadow = e4v2;
  const out = {
    strategyId: S1,
    confluence: { context: { reaction, volume } },
    ...extra,
  };
  if (e26a) out.engine26LocationCandidate = e26a;
  if (e6) out.permission = { paper: e6 };
  if (e26b) out.engine26ProposedGeometry = e26b;
  if (e7) out.engine7PositionSizing = e7;
  if (e9) out.engine9OfficialManagementPlan = e9;
  if (e8) out.engine8PaperOrder = e8;
  if (e10) out.engine10Journal = e10;
  if (e28a) out.engine28APipelineDoctor = e28a;
  return out;
}

export function replayRoot({ snapshotTime, generatedAtUtc, dateYmd, timeHHMM, strategies, currentPrice }) {
  return {
    schema: "engine12.multiStrategyReplay.v1",
    replayContract: "CANONICAL_MULTI_STRATEGY_REPLAY",
    immutable: true,
    symbol: "ES",
    snapshotTime,
    dateYmd,
    timeHHMM,
    timezone: "America/Phoenix",
    generatedAtUtc,
    currentPrice,
    strategies,
  };
}

function doctor({ snapshotTime, generatedAt, firstFailingEngine, pipelineStatus, failureType, rootCause, stages }) {
  return {
    active: true,
    engine: "engine28a.pipelineDoctor.v1",
    contractVersion: "engine28a.pipelineDoctor.v1",
    mode: "READ_ONLY_PIPELINE_DIAGNOSTIC",
    strategyId: S1,
    symbol: "ES",
    pipelineStatus, firstFailingEngine, failureType, rootCause,
    stages: stages.map(([engine, state]) => ({ engine, state })),
    warnings: [],
    snapshotTime,
    generatedAt,
  };
}

// ---- Nov 24 documented cases ----------------------------------------------

const CAND = "E26C-NOV24-SYN-A";
const ZONE = "E26Z-NOV24-SYN-A";

function e26a(snapshotTime, price) {
  return { status: "ACTIVE", direction: "LONG", candidateId: CAND, zoneId: ZONE, currentPrice: price, snapshotTime };
}

/** 07:46 AZ: Engine 3 not qualified. */
export function nov24_0746() {
  const snap = "2026-11-24T14:45:50.000Z";
  const s1 = lane({
    e26a: e26a(snap, 7206.75),
    e3: {
      engine: "engine3.v5.strategy1Handoff.v1", state: "WATCHING", direction: "NEUTRAL", quality: null,
      allowed: false, engine3Strategy1QualifiedForEngine6: false,
      blockers: ["ENGINE3_STRATEGY1_NOT_QUALIFIED"], reasonCodes: [], snapshotTime: snap,
      evaluatedAt: "2026-11-24T14:45:55.000Z",
    },
    e4: {
      engine: "engine4.authorizedReactionParticipation.v1", participationState: "WAITING_FOR_ENGINE3",
      direction: null, participationConfirmed: false, allowed: false, hardBlocked: false, blockers: [], snapshotTime: snap,
    },
    e6: { decision: "STAND_DOWN", direction: null, allowed: false, paperAllowed: false, locked: false, candidateId: CAND, zoneId: ZONE, snapshotTime: snap },
    e8: null, e26b: null, e7: null, e9: null,
    e28a: doctor({
      snapshotTime: snap, generatedAt: "2026-11-24T14:46:05.000Z",
      firstFailingEngine: "engine3", pipelineStatus: "WAITING", failureType: "WAITING_FOR_MARKET",
      rootCause: "ENGINE3_STRATEGY1_NOT_QUALIFIED",
      stages: [["engine26A", "PASS_CONTEXT"], ["engine3", "WAITING"]],
    }),
  });
  return replayRoot({
    snapshotTime: snap, generatedAtUtc: "2026-11-24T14:46:20.000Z", dateYmd: "2026-11-24", timeHHMM: "0746",
    currentPrice: 7206.75, strategies: { [S1]: s1 },
  });
}

/** 07:52 AZ: Engine 3 LONG qualified, canonical Engine 4 v1 waiting, v2 shadow supportive. */
export function nov24_0752() {
  const snap = "2026-11-24T14:51:48.000Z";
  const s1 = lane({
    e26a: e26a(snap, 7223.0),
    e3: {
      engine: "engine3.v5.strategy1Handoff.v1", state: "QUALIFIED", direction: "LONG", quality: "STRONG",
      allowed: true, engine3Strategy1QualifiedForEngine6: true, blockers: [], reasonCodes: [], snapshotTime: snap,
    },
    e3v6: { version: "engine3.v6", canonical: { canonical: { direction: "LONG", quality: "GOOD" } }, state: "QUALIFIED" },
    e4: {
      engine: "engine4.authorizedReactionParticipation.v1", participationState: "WAITING_FOR_CONFIRMATION",
      direction: "LONG", participationQuality: "WEAK", participationConfirmed: false, allowed: false,
      hardBlocked: false, blockers: ["ENGINE4_PARTICIPATION_NOT_CONFIRMED"], snapshotTime: snap,
    },
    e4v2: {
      version: "engine4.v2.participationShadow.v1", participationState: "SUPPORTIVE",
      confirmationState: "CONFIRMED", direction: "LONG", evidence: { relVol: 1.31 },
    },
    e6: { decision: "WAIT", direction: "LONG", allowed: false, paperAllowed: false, locked: false, candidateId: CAND, zoneId: ZONE, snapshotTime: snap },
    e8: null, e26b: null, e7: null, e9: null,
    e28a: doctor({
      snapshotTime: snap, generatedAt: "2026-11-24T14:52:02.000Z",
      firstFailingEngine: "engine4", pipelineStatus: "WAITING", failureType: "WAITING_FOR_MARKET",
      rootCause: "ENGINE4_PARTICIPATION_NOT_CONFIRMED",
      stages: [["engine26A", "PASS_CONTEXT"], ["engine3", "PASS"], ["engine4", "WAITING"]],
    }),
  });
  return replayRoot({
    snapshotTime: snap, generatedAtUtc: "2026-11-24T14:52:15.000Z", dateYmd: "2026-11-24", timeHHMM: "0752",
    currentPrice: 7223.0, strategies: { [S1]: s1 },
  });
}

function passingUpstream(snap, { planId, entry = 7230, stop = 7224, targets = [7236, 7242, 7250], cand = CAND, zone = ZONE }) {
  return {
    e3: {
      engine: "engine3.v5.strategy1Handoff.v1", state: "QUALIFIED", direction: "LONG", quality: "STRONG",
      allowed: true, engine3Strategy1QualifiedForEngine6: true, blockers: [], reasonCodes: [], snapshotTime: snap,
    },
    e4: {
      engine: "engine4.authorizedReactionParticipation.v1", participationState: "CONFIRMED",
      direction: "LONG", participationQuality: "GOOD", participationConfirmed: true, allowed: true,
      hardBlocked: false, blockers: [], snapshotTime: snap,
    },
    e6: { decision: "FAST_INTRADAY_PAPER_ALLOW", direction: "LONG", allowed: true, paperAllowed: true, locked: true, candidateId: cand, zoneId: zone, sizeMultiplier: 1, snapshotTime: snap },
    e26b: {
      status: "GEOMETRY_READY", direction: "LONG", geometryReady: true, candidateId: cand, zoneId: zone,
      proposedEntryPrice: entry, proposedStopPrice: stop, proposedTargets: targets.map((price) => ({ price })), snapshotTime: snap,
    },
    e7: {
      status: "SIZED", direction: "LONG", allowed: true, executableSizing: true, finalContracts: 3,
      estimatedTotalRiskDollars: 97.5, permissionAdjustedRiskBudget: 150, planId, candidateId: cand, snapshotTime: snap,
    },
    e9: {
      planStatus: "OFFICIAL", direction: "LONG", managementReady: true, official: true, planId, candidateId: cand,
      officialEntryPrice: entry, officialStopPrice: stop, officialTargets: targets.map((price) => ({ price })),
      waitingFor: [], blockers: [], snapshotTime: snap,
    },
  };
}

/** 10:16 AZ (evaluation 10:15:57): Engine 8 not executable, paper acceptance state unavailable. */
export function nov24_1016() {
  const snap = "2026-11-24T17:15:57.000Z";
  const up = passingUpstream(snap, { planId: "E9P-NOV24-SYN-1016" });
  const s1 = lane({
    e26a: e26a(snap, 7229.25), ...up,
    e8: {
      status: "NOT_EXECUTABLE", direction: "LONG", executable: false, finalContracts: 3,
      planId: "E9P-NOV24-SYN-1016", candidateId: CAND, zoneId: ZONE, strategyId: S1,
      orderCreated: false, orderId: null, tradeId: null, executionId: null,
      blockers: ["PAPER_ACCEPTANCE_STATE_UNAVAILABLE"], reasonCodes: [],
      snapshotTime: snap, evaluatedAt: "2026-11-24T17:15:58.000Z",
    },
    e28a: doctor({
      snapshotTime: snap, generatedAt: "2026-11-24T17:16:01.000Z",
      firstFailingEngine: "engine8", pipelineStatus: "BLOCKED", failureType: "ENGINE_LOGIC",
      rootCause: "ENGINE8_NOT_EXECUTABLE",
      stages: [
        ["engine26A", "PASS_CONTEXT"], ["engine3", "PASS"], ["engine4", "PASS"], ["engine6", "PASS"],
        ["engine26B", "PASS"], ["engine7", "PASS"], ["engine9", "PASS"], ["engine8", "BLOCKED"],
      ],
    }),
  });
  return replayRoot({
    snapshotTime: snap, generatedAtUtc: "2026-11-24T17:16:12.000Z", dateYmd: "2026-11-24", timeHHMM: "1016",
    currentPrice: 7229.25, strategies: { [S1]: s1 },
  });
}

/** 10:25 AZ: SYNTHETIC continuity placeholder (same candidate, Engine 8 still not executable). */
export function nov24_1025() {
  const snap = "2026-11-24T17:24:40.000Z";
  const r = nov24_1016();
  const s1 = clone(r.strategies[S1]);
  for (const k of ["engine26LocationCandidate", "engine26ProposedGeometry", "engine7PositionSizing", "engine9OfficialManagementPlan", "engine8PaperOrder"]) {
    s1[k].snapshotTime = snap;
  }
  s1.permission.paper.snapshotTime = snap;
  s1.confluence.context.reaction.paperScalpReaction.snapshotTime = snap;
  s1.confluence.context.volume.engine4AuthorizedReactionParticipation.snapshotTime = snap;
  s1.engine26LocationCandidate.currentPrice = 7231.5;
  s1.engine8PaperOrder.evaluatedAt = "2026-11-24T17:24:41.000Z";
  s1.engine28APipelineDoctor.snapshotTime = snap;
  s1.engine28APipelineDoctor.generatedAt = "2026-11-24T17:24:44.000Z";
  return replayRoot({
    snapshotTime: snap, generatedAtUtc: "2026-11-24T17:24:58.000Z", dateYmd: "2026-11-24", timeHHMM: "1025",
    currentPrice: 7231.5, strategies: { [S1]: s1 },
  });
}

// ---- Lifecycle cases (SYNTHETIC; dated 2026-11-24 for registry coverage only) ----

export const LIFE_DATE = "2026-11-24"; // only evidence-backed registry date; scenarios are isolated temp dirs

/** Replay at decision: pipeline passed, Engine 8 READY (order not yet created at archive). */
export function lifecycleReplay({ timeHHMM = "1000", snap = "2026-11-24T17:00:00.000Z", planId = "E9P-LIFE-A", cand = "E26C-LIFE-A", e8Overrides = {} } = {}) {
  const up = passingUpstream(snap, { planId, cand, zone: "E26Z-LIFE-A" });
  const s1 = lane({
    e26a: { status: "ACTIVE", direction: "LONG", candidateId: cand, zoneId: "E26Z-LIFE-A", currentPrice: 7230, snapshotTime: snap },
    ...up,
    e8: {
      status: "READY_TO_CREATE_PAPER_ORDER", direction: "LONG", executable: true, finalContracts: 3,
      planId, candidateId: cand, zoneId: "E26Z-LIFE-A", strategyId: S1,
      orderCreated: false, orderId: null, tradeId: null, executionId: null,
      blockers: [], reasonCodes: [], snapshotTime: snap, evaluatedAt: "2026-11-24T17:00:02.000Z",
      ...e8Overrides,
    },
    e28a: doctor({
      snapshotTime: snap, generatedAt: "2026-11-24T17:00:04.000Z",
      firstFailingEngine: null, pipelineStatus: "ORDER_READY", failureType: null, rootCause: null,
      stages: [
        ["engine26A", "PASS_CONTEXT"], ["engine3", "PASS"], ["engine4", "PASS"], ["engine6", "PASS"],
        ["engine26B", "PASS"], ["engine7", "PASS"], ["engine9", "PASS"], ["engine8", "PASS"],
      ],
    }),
  });
  return replayRoot({
    snapshotTime: snap, generatedAtUtc: "2026-11-24T17:00:10.000Z", dateYmd: LIFE_DATE, timeHHMM,
    currentPrice: 7230, strategies: { [S1]: s1 },
  });
}

export function paperOrder({ orderId, planId = "E9P-LIFE-A", cand = "E26C-LIFE-A", executionId = orderId + "-X", action = "NEW_ENTRY", filledAt = "2026-11-24T17:00:12.000Z", strategyId = S1, paper = true, qty = 3, avgPrice = 7230.25 }) {
  return {
    orderId, idempotencyKey: "IK-" + orderId, ts: filledAt, paper, symbol: "ES", strategyId, action,
    side: action === "NEW_ENTRY" ? "BUY" : "SELL", qty, status: "filled", filledQty: qty, avgPrice, filledAt,
    sourceSignal: { engine: "engine8", executionId, orderId, planId, candidateId: cand },
  };
}

export function journalTrade({ tradeId, orderId, planId = "E9P-LIFE-A", cand = "E26C-LIFE-A", executionId = orderId + "-X", status = "OPEN", accountMode = "PAPER", strategyId = S1, events = [], remainingQty = 3, realizedPnL = null, entryTime = "2026-11-24T17:00:12.500Z", closeTime = null, extra = {} }) {
  return {
    tradeId,
    identity: { tradeId, executionId, orderId, planId, candidateId: cand, strategyId },
    symbol: "ES", strategyId, direction: "LONG", accountMode, status,
    orderLink: { orderId, executionId },
    setup: { planId, candidateId: cand },
    entry: { time: entryTime, price: 7230.25, qty: 3, fillStatus: "FILLED" },
    qty: { originalQty: 3, remainingQty, cumulativeExitQuantity: 3 - remainingQty },
    events,
    summary: { openTime: entryTime, closeTime, realizedPnL, realizedPoints: null, realizedR: null },
    createdAt: entryTime,
    ...extra,
  };
}

// ---- disk layout ------------------------------------------------------------

export function makeScenario({ replays = {}, orders, executions, journal, journalRaw } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "e12-investigator-"));
  const replayRoot = path.join(base, "replay", "es");
  const engine8PaperDir = path.join(base, "replay", "engine8-paper");
  const journalDir = path.join(base, "replay", "journal");
  fs.mkdirSync(replayRoot, { recursive: true });
  fs.mkdirSync(engine8PaperDir, { recursive: true });
  fs.mkdirSync(journalDir, { recursive: true });
  for (const [key, value] of Object.entries(replays)) {
    const [date, time] = key.split("/");
    fs.mkdirSync(path.join(replayRoot, date), { recursive: true });
    fs.writeFileSync(path.join(replayRoot, date, time + ".json"), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
  if (orders !== undefined) fs.writeFileSync(path.join(engine8PaperDir, "paper-orders.json"), JSON.stringify(orders));
  if (executions !== undefined) fs.writeFileSync(path.join(engine8PaperDir, "paper-executions.json"), JSON.stringify(executions));
  if (journal !== undefined) fs.writeFileSync(path.join(journalDir, "trade-journal.json"), JSON.stringify(journal));
  if (journalRaw !== undefined) fs.writeFileSync(path.join(journalDir, "trade-journal.json"), journalRaw);
  return { base, config: { replayRoot, engine8PaperDir, journalDir } };
}

export function nov24Scenario(extra = {}) {
  return makeScenario({
    replays: {
      "2026-11-24/0746": nov24_0746(),
      "2026-11-24/0752": nov24_0752(),
      "2026-11-24/1016": nov24_1016(),
      "2026-11-24/1025": nov24_1025(),
    },
    orders: [],
    executions: [],
    journal: [],
    ...extra,
  });
}

export function query(overrides = {}) {
  return {
    date: "2026-11-24", time: "0746", strategyId: S1, candidateId: null, planId: null, tradeId: null,
    windowMinutes: 15, detail: "summary", ...overrides,
  };
}
