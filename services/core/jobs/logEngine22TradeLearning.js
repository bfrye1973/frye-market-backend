// services/core/jobs/logEngine22TradeLearning.js
// Engine 22G Trade Learning Log
//
// Purpose:
// Manually append the current Engine 22G paper trade decision to a learning log.
//
// This job does NOT:
// - place trades
// - route orders
// - call brokers
// - execute options
// - update outcomes
// - run automatically
//
// Run manually:
// node jobs/logEngine22TradeLearning.js

import fs from "fs";

const DATA_DIR = "/opt/render/project/src/services/core/data";

const SYMBOL = String(process.env.SYMBOL || "SPY").toUpperCase();
const STRATEGY_ID = process.env.STRATEGY_ID || "intraday_scalp@10m";

const SNAPSHOT_FILE =
  SYMBOL === "SPY"
    ? `${DATA_DIR}/strategy-snapshot.json`
    : `${DATA_DIR}/strategy-snapshot-${SYMBOL.toLowerCase()}.json`;

const LOG_FILE = `${DATA_DIR}/engine22-trade-learning-log.json`;

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const text = fs.readFileSync(file, "utf8");
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch (err) {
    console.error(`[Engine22 Learning Log] Failed to read JSON: ${file}`);
    console.error(err);
    return fallback;
  }
}

function writeJsonFile(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function pickPrice(strategy, engine22WaveStrategy) {
  return round2(
    engine22WaveStrategy?.tradeDecision?.currentPrice ??
      engine22WaveStrategy?.currentPrice ??
      engine22WaveStrategy?.waveFibState?.currentPrice ??
      strategy?.engine16?.latestClose ??
      strategy?.engine16?.regimeLayers?.trigger10m?.close ??
      strategy?.engine22Scalp?.regimeLayers?.tenMinute?.close ??
      strategy?.engine22Scalp?.regimeLayers?.trigger10m?.close ??
      null
  );
}

function pickReactionContext(strategy, engine22WaveStrategy) {
  return (
    engine22WaveStrategy?.reactionContext ||
    strategy?.engine22Scalp?.reactionContext ||
    strategy?.confluence?.context?.reaction ||
    null
  );
}

function pickVolumeContext(strategy, engine22WaveStrategy) {
  return (
    engine22WaveStrategy?.volumeContext ||
    strategy?.engine22Scalp?.volumeContext ||
    strategy?.confluence?.context?.volume ||
    null
  );
}

function buildDedupeKey({
  symbol,
  strategyId,
  tradeDecision,
  engine22WaveStrategy,
} = {}) {
  const decision = tradeDecision?.decision ?? "UNKNOWN";
  const setupType = tradeDecision?.setupType ?? "UNKNOWN";
  const grade = tradeDecision?.grade ?? "UNKNOWN";
  const topCandidate =
    tradeDecision?.topCandidate ??
    engine22WaveStrategy?.topCandidate ??
    null;
  const hardInvalidation =
    tradeDecision?.hardInvalidation ??
    engine22WaveStrategy?.hardInvalidation ??
    null;
  const action = engine22WaveStrategy?.action ?? "UNKNOWN";

  return [
    symbol,
    strategyId,
    decision,
    setupType,
    grade,
    topCandidate,
    hardInvalidation,
    action,
  ].join("|");
}

function buildLearningLogEntry({ snapshot, strategy, symbol, strategyId }) {
  const engine22WaveStrategy = strategy?.engine22WaveStrategy || null;
  const tradeDecision = engine22WaveStrategy?.tradeDecision || null;

  if (!engine22WaveStrategy) {
    throw new Error("Missing strategy.engine22WaveStrategy");
  }

  if (!tradeDecision) {
    throw new Error("Missing strategy.engine22WaveStrategy.tradeDecision");
  }

  const price = pickPrice(strategy, engine22WaveStrategy);

  const reactionContext = pickReactionContext(strategy, engine22WaveStrategy);
  const volumeContext = pickVolumeContext(strategy, engine22WaveStrategy);

  const entryReference = {
    topCandidate:
      tradeDecision?.topCandidate ??
      engine22WaveStrategy?.topCandidate ??
      null,
    reclaimLadder:
      tradeDecision?.reclaimLadder ??
      engine22WaveStrategy?.reclaimLadder ??
      null,
    entryPlan: tradeDecision?.entryPlan ?? null,
  };

  const stopReference = {
    hardInvalidation:
      tradeDecision?.hardInvalidation ??
      engine22WaveStrategy?.hardInvalidation ??
      null,
    invalidation: tradeDecision?.invalidation ?? null,
  };

  const targetReferences = {
    targets: tradeDecision?.targets ?? null,
  };

  const dedupeKey = buildDedupeKey({
    symbol,
    strategyId,
    tradeDecision,
    engine22WaveStrategy,
  });

  return {
    timestamp: nowIso(),
    sourceSnapshotNow: snapshot?.now ?? null,

    symbol,
    strategyId,
    price,

    waveFibState: engine22WaveStrategy?.waveFibState ?? null,
    tradeContextSummary: engine22WaveStrategy?.tradeContextSummary ?? null,
    timelineRead: engine22WaveStrategy?.timelineRead ?? null,
    tradeDecision,

    engine15: strategy?.engine15 ?? null,
    engine16: strategy?.engine16 ?? null,
    reactionContext,
    volumeContext,

    decision: tradeDecision?.decision ?? null,
    direction: tradeDecision?.direction ?? null,
    setupType: tradeDecision?.setupType ?? null,
    grade: tradeDecision?.grade ?? null,

    entryReference,
    stopReference,
    targetReferences,

    dedupeKey,

    outcomePending: true,
    labels: [],
    notes: null,

    safety: {
      mode: tradeDecision?.mode ?? "PAPER_ONLY",
      paperOnly: true,
      liveTradingEnabled: false,
      brokerCallsEnabled: false,
      orderRoutingEnabled: false,
      optionsExecutionEnabled: false,
    },
  };
}

function main() {
  console.log("[Engine22 Learning Log] Starting manual log job...");
  console.log("[Engine22 Learning Log] Snapshot:", SNAPSHOT_FILE);
  console.log("[Engine22 Learning Log] Log file:", LOG_FILE);
  console.log("[Engine22 Learning Log] Symbol:", SYMBOL);
  console.log("[Engine22 Learning Log] Strategy:", STRATEGY_ID);

  const snapshot = readJsonFile(SNAPSHOT_FILE, null);

  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`Snapshot file missing or invalid: ${SNAPSHOT_FILE}`);
  }

  const strategy = snapshot?.strategies?.[STRATEGY_ID] || null;

  if (!strategy) {
    throw new Error(`Strategy not found in snapshot: ${STRATEGY_ID}`);
  }

  const entry = buildLearningLogEntry({
    snapshot,
    strategy,
    symbol: SYMBOL,
    strategyId: STRATEGY_ID,
  });

  const existing = readJsonFile(LOG_FILE, []);

  const log = Array.isArray(existing) ? existing : [];

  log.push(entry);

  writeJsonFile(LOG_FILE, log);

  console.log("[Engine22 Learning Log] Append complete.");
  console.log("[Engine22 Learning Log] Total entries:", log.length);
  console.log("[Engine22 Learning Log] Last entry summary:", {
    timestamp: entry.timestamp,
    symbol: entry.symbol,
    strategyId: entry.strategyId,
    decision: entry.decision,
    direction: entry.direction,
    setupType: entry.setupType,
    grade: entry.grade,
    price: entry.price,
    dedupeKey: entry.dedupeKey,
  });
}

try {
  main();
} catch (err) {
  console.error("[Engine22 Learning Log] FAILED");
  console.error(err);
  process.exitCode = 1;
}
