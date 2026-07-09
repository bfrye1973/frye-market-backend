// services/core/logic/engine26/paperTrialStore.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

const DEFAULT_SYMBOL = "ES";
const DEFAULT_TIMEFRAME = "10m";
const DEFAULT_EXPIRE_AFTER_CANDLES = 6;

const PAPER_TRIAL_STATUSES = Object.freeze({
  PENDING_LIMIT_PULLBACK: "PENDING_LIMIT_PULLBACK",
  FILLED_PAPER_TRADE: "FILLED_PAPER_TRADE",
  P1_TARGET_HIT: "P1_TARGET_HIT",
  P2_TARGET_HIT: "P2_TARGET_HIT",
  P3_TARGET_HIT: "P3_TARGET_HIT",
  FINAL_TARGET_HIT: "FINAL_TARGET_HIT",
  STOPPED: "STOPPED",
  INVALIDATED_BEFORE_FILL: "INVALIDATED_BEFORE_FILL",
  EXPIRED_NO_FILL: "EXPIRED_NO_FILL",
  CANCELLED_BY_NEW_CONTEXT: "CANCELLED_BY_NEW_CONTEXT",
});

const PAPER_TRIAL_EVENTS = Object.freeze({
  CREATED: "CREATED",
  FILLED: "FILLED",
  P1_TARGET_HIT: "P1_TARGET_HIT",
  P2_TARGET_HIT: "P2_TARGET_HIT",
  P3_TARGET_HIT: "P3_TARGET_HIT",
  FINAL_TARGET_HIT: "FINAL_TARGET_HIT",
  STOPPED: "STOPPED",
  INVALIDATED_BEFORE_FILL: "INVALIDATED_BEFORE_FILL",
  EXPIRED_NO_FILL: "EXPIRED_NO_FILL",
  UPDATED: "UPDATED",
  COMPLETED: "COMPLETED",
});

const TERMINAL_STATUSES = new Set([
  PAPER_TRIAL_STATUSES.STOPPED,
  PAPER_TRIAL_STATUSES.INVALIDATED_BEFORE_FILL,
  PAPER_TRIAL_STATUSES.EXPIRED_NO_FILL,
  PAPER_TRIAL_STATUSES.CANCELLED_BY_NEW_CONTEXT,
  PAPER_TRIAL_STATUSES.FINAL_TARGET_HIT,
]);

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeSymbol(symbol = DEFAULT_SYMBOL) {
  return String(symbol || DEFAULT_SYMBOL).trim().toUpperCase();
}

function getStateFilePath(symbol = DEFAULT_SYMBOL) {
  const safeSymbol = normalizeSymbol(symbol).toLowerCase();
  return path.join(DATA_DIR, `engine26-paper-trial-state-${safeSymbol}.json`);
}

function getJournalFilePath(symbol = DEFAULT_SYMBOL) {
  const safeSymbol = normalizeSymbol(symbol).toLowerCase();
  return path.join(DATA_DIR, `engine26-paper-trial-journal-${safeSymbol}.jsonl`);
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  const n = asNumber(value);
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeDirection(direction) {
  if (!direction) return null;
  return String(direction).trim().toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function ymdFromIso(iso) {
  return String(iso || nowIso()).slice(0, 10).replaceAll("-", "");
}

function hhmmFromIso(iso) {
  const d = new Date(iso || nowIso());
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}${mm}`;
}

function sanitizeIdPart(value) {
  return String(value || "UNKNOWN")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function buildPaperTrialId({
  symbol,
  direction,
  setupType,
  createdAtUtc,
} = {}) {
  const s = normalizeSymbol(symbol);
  const ymd = ymdFromIso(createdAtUtc);
  const hhmm = hhmmFromIso(createdAtUtc);
  const setup = sanitizeIdPart(setupType || "MANUAL_PAPER_TRIAL");
  const dir = sanitizeIdPart(direction || "UNKNOWN");
  return `E26-${s}-${ymd}-${hhmm}-${setup}-${dir}`;
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function loadActivePaperTrial(symbol = DEFAULT_SYMBOL) {
  ensureDataDir();

  const filePath = getStateFilePath(symbol);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    return {
      active: false,
      terminal: true,
      status: "STATE_FILE_READ_ERROR",
      error: err.message,
      filePath,
      updatedAtUtc: nowIso(),
    };
  }
}

function saveActivePaperTrial(trial, symbol = DEFAULT_SYMBOL) {
  ensureDataDir();

  const targetSymbol = normalizeSymbol(trial?.symbol || symbol);
  const filePath = getStateFilePath(targetSymbol);

  const payload = {
    ...trial,
    symbol: targetSymbol,
    updatedAtUtc: nowIso(),
  };

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function appendPaperTrialJournalEvent(event, symbol = DEFAULT_SYMBOL) {
  ensureDataDir();

  const targetSymbol = normalizeSymbol(event?.symbol || symbol);
  const filePath = getJournalFilePath(targetSymbol);

  const payload = {
    ...event,
    symbol: targetSymbol,
    eventAtUtc: event?.eventAtUtc || nowIso(),
  };

  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}

function calculateBlockPoints({ direction, entryPrice, exitPrice }) {
  const dir = normalizeDirection(direction);
  const entry = asNumber(entryPrice);
  const exit = asNumber(exitPrice);

  if (entry == null || exit == null) return null;

  if (dir === "SHORT") return round2(entry - exit);
  if (dir === "LONG") return round2(exit - entry);

  return null;
}

function summarizeBlocks(blocks = []) {
  const safeBlocks = asArray(blocks);

  const closedBlocks = safeBlocks.filter((block) => block.status === "CLOSED");
  const openBlocks = safeBlocks.filter((block) => block.status === "ACTIVE");
  const pendingBlocks = safeBlocks.filter((block) => block.status === "PENDING");

  const totalPoints = round2(
    safeBlocks.reduce((sum, block) => {
      const points = asNumber(block.points);
      return sum + (points || 0);
    }, 0)
  );

  return {
    totalBlocks: safeBlocks.length,
    closedBlocks: closedBlocks.length,
    openBlocks: openBlocks.length,
    pendingBlocks: pendingBlocks.length,
    totalPoints,
  };
}

function buildBlocksFromGeometry(geometry) {
  const geometryBlocks = asArray(geometry?.blocks);

  return geometryBlocks.map((block) => ({
    block: block.block,
    label: block.label,
    sizeFraction: block.sizeFraction,
    entryPrice: block.entryPrice,
    stopPrice: block.stopPrice,
    targetPrice: block.targetPrice,
    riskPoints: block.riskPoints,
    rewardPoints: block.rewardPoints,
    rr: block.rr,
    status: "PENDING",
    exitPrice: null,
    exitReason: null,
    points: null,
    openedAtUtc: null,
    closedAtUtc: null,
  }));
}

function createPaperTrialFromManualSignal(signal, options = {}) {
  const now = nowIso();

  if (!signal || typeof signal !== "object") {
    return {
      created: false,
      trial: null,
      error: "MISSING_SIGNAL",
    };
  }

  if (signal.active !== true) {
    return {
      created: false,
      trial: null,
      error: signal.invalidReason || "SIGNAL_NOT_ACTIVE",
      signalStatus: signal.status,
    };
  }

  if (signal.geometry?.valid !== true) {
    return {
      created: false,
      trial: null,
      error: signal.geometry?.invalidReason || "INVALID_GEOMETRY",
      signalStatus: signal.status,
    };
  }

  const symbol = normalizeSymbol(signal.symbol || DEFAULT_SYMBOL);
  const direction = normalizeDirection(signal.direction);
  const geometry = signal.geometry;
  const entryPrice = asNumber(geometry.entryPrice ?? signal.requestedEntryPrice);
  const stopPrice = asNumber(geometry.stopPrice ?? signal.requestedStopPrice);

  const setupType =
    options.setupType ||
    signal.setupType ||
    "BRIAN_MANUAL_ENGINE26_PAPER_TRIAL";

  const createdAtUtc = options.createdAtUtc || now;

  const tradeId =
    options.tradeId ||
    buildPaperTrialId({
      symbol,
      direction,
      setupType,
      createdAtUtc,
    });

  const blocks = buildBlocksFromGeometry(geometry);

  const trial = {
    active: true,
    terminal: false,
    tradeId,
    engine26PaperTrialId: tradeId,

    status: PAPER_TRIAL_STATUSES.PENDING_LIMIT_PULLBACK,
    result: null,

    source: signal.source || "BRIAN_MANUAL_TEST",
    signalType: signal.signalType || "ENGINE26_MANUAL_PAPER_SIGNAL",
    setupType,

    symbol,
    strategyId: signal.strategyId || "intraday_scalp@10m",
    timeframe: options.timeframe || DEFAULT_TIMEFRAME,
    direction,

    mode: "PAPER_ONLY",
    paperTrial: true,
    paperOnly: true,
    researchOnly: true,
    manualTest: signal.manualTest === true,
    permissionMode: signal.permissionMode,

    noExecution: true,
    noBrokerOrder: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    engine6ObservedOnly: signal.engine6ObservedOnly === true,
    engine6BypassedForResearchOnly:
      signal.engine6BypassedForResearchOnly === true,

    entryType: options.entryType || "LIMIT_PULLBACK",
    limitPrice: entryPrice,
    entryPrice,
    stopPrice,
    targets: blocks.map((block) => block.targetPrice),

    filled: false,
    fillPrice: null,
    filledAtUtc: null,

    expired: false,
    invalidated: false,
    stopped: false,

    triggerPrice:
      asNumber(options.triggerPrice) ??
      asNumber(signal.triggerPrice) ??
      asNumber(signal.requestedEntryPrice) ??
      entryPrice,

    triggerTimeUtc: options.triggerTimeUtc || createdAtUtc,
    triggerTimeAz: options.triggerTimeAz || null,

    expireAfterCandles:
      Number.isFinite(Number(options.expireAfterCandles))
        ? Number(options.expireAfterCandles)
        : DEFAULT_EXPIRE_AFTER_CANDLES,
    candlesElapsed: 0,

    geometry,
    blocks,

    engine6Evidence: signal.engine6Evidence || null,
    permissionDecision: signal.permissionDecision || null,

    evidence: options.evidence || {
      engine6: signal.engine6Evidence || null,
      geometry: {
        riskPoints: geometry.riskPoints,
        p2Rr: geometry.p2Rr,
        bestRr: geometry.bestRr,
      },
    },

    replay: options.replay || null,
    note: signal.note || options.note || null,

    events: [
      {
        eventType: PAPER_TRIAL_EVENTS.CREATED,
        ts: createdAtUtc,
        status: PAPER_TRIAL_STATUSES.PENDING_LIMIT_PULLBACK,
        price: entryPrice,
        note: "Engine 26 manual paper trial created.",
      },
    ],

    summary: summarizeBlocks(blocks),

    createdAtUtc,
    updatedAtUtc: createdAtUtc,
    closedAtUtc: null,
  };

  const saved = saveActivePaperTrial(trial, symbol);

  appendPaperTrialJournalEvent(
    {
      eventType: PAPER_TRIAL_EVENTS.CREATED,
      tradeId,
      engine26PaperTrialId: tradeId,
      status: saved.status,
      source: saved.source,
      setupType: saved.setupType,
      direction: saved.direction,
      entryPrice: saved.entryPrice,
      stopPrice: saved.stopPrice,
      targets: saved.targets,
      permissionMode: saved.permissionMode,
      engine6Evidence: saved.engine6Evidence,
      noExecution: true,
      noBrokerOrder: true,
      schwabExecutionAllowed: false,
    },
    symbol
  );

  return {
    created: true,
    trial: saved,
    error: null,
  };
}

function closeBlock(block, { direction, exitPrice, exitReason, closedAtUtc }) {
  const points = calculateBlockPoints({
    direction,
    entryPrice: block.entryPrice,
    exitPrice,
  });

  return {
    ...block,
    status: "CLOSED",
    exitPrice,
    exitReason,
    points,
    closedAtUtc,
  };
}

function activateBlocks(blocks = [], filledAtUtc) {
  return asArray(blocks).map((block) => ({
    ...block,
    status: "ACTIVE",
    openedAtUtc: filledAtUtc,
  }));
}

function markFilled(trial, currentPrice, eventTimeUtc) {
  const fillPrice = trial.limitPrice;

  const updated = {
    ...trial,
    active: true,
    terminal: false,
    status: PAPER_TRIAL_STATUSES.FILLED_PAPER_TRADE,
    filled: true,
    fillPrice,
    filledAtUtc: eventTimeUtc,
    blocks: activateBlocks(trial.blocks, eventTimeUtc),
    events: [
      ...asArray(trial.events),
      {
        eventType: PAPER_TRIAL_EVENTS.FILLED,
        ts: eventTimeUtc,
        status: PAPER_TRIAL_STATUSES.FILLED_PAPER_TRADE,
        price: currentPrice,
        fillPrice,
        note: "Paper limit pullback filled.",
      },
    ],
  };

  return updated;
}

function completeTrial(trial, {
  status,
  result,
  eventType,
  price,
  note,
  eventTimeUtc,
  blocks = null,
} = {}) {
  const finalBlocks = blocks || trial.blocks;

  const updated = {
    ...trial,
    active: false,
    terminal: true,
    status,
    result,
    blocks: finalBlocks,
    summary: summarizeBlocks(finalBlocks),
    closedAtUtc: eventTimeUtc,
    updatedAtUtc: eventTimeUtc,
    events: [
      ...asArray(trial.events),
      {
        eventType,
        ts: eventTimeUtc,
        status,
        result,
        price,
        note,
      },
      {
        eventType: PAPER_TRIAL_EVENTS.COMPLETED,
        ts: eventTimeUtc,
        status,
        result,
        price,
        note: "Engine 26 paper trial completed.",
      },
    ],
  };

  return updated;
}

function maybeExpirePendingTrial(trial, eventTimeUtc) {
  if (trial.filled === true) return trial;

  const candlesElapsed = Number(trial.candlesElapsed || 0) + 1;
  const expireAfterCandles = Number(
    trial.expireAfterCandles || DEFAULT_EXPIRE_AFTER_CANDLES
  );

  const updated = {
    ...trial,
    candlesElapsed,
  };

  if (candlesElapsed >= expireAfterCandles) {
    return completeTrial(updated, {
      status: PAPER_TRIAL_STATUSES.EXPIRED_NO_FILL,
      result: "NO_FILL",
      eventType: PAPER_TRIAL_EVENTS.EXPIRED_NO_FILL,
      price: trial.lastPrice ?? null,
      note: `Paper limit did not fill after ${expireAfterCandles} candles.`,
      eventTimeUtc,
      blocks: asArray(trial.blocks).map((block) => ({
        ...block,
        status: "EXPIRED",
        exitReason: "EXPIRED_NO_FILL",
        closedAtUtc: eventTimeUtc,
      })),
    });
  }

  return updated;
}

function shouldFill({ direction, currentPrice, limitPrice }) {
  if (direction === "SHORT") return currentPrice >= limitPrice;
  if (direction === "LONG") return currentPrice <= limitPrice;
  return false;
}

function shouldInvalidateBeforeFill({ direction, currentPrice, stopPrice }) {
  if (direction === "SHORT") return currentPrice >= stopPrice;
  if (direction === "LONG") return currentPrice <= stopPrice;
  return false;
}

function shouldStop({ direction, currentPrice, stopPrice }) {
  if (direction === "SHORT") return currentPrice >= stopPrice;
  if (direction === "LONG") return currentPrice <= stopPrice;
  return false;
}

function targetHit({ direction, currentPrice, targetPrice }) {
  if (direction === "SHORT") return currentPrice <= targetPrice;
  if (direction === "LONG") return currentPrice >= targetPrice;
  return false;
}

function statusForBlockLabel(label) {
  if (label === "P1") return PAPER_TRIAL_STATUSES.P1_TARGET_HIT;
  if (label === "P2") return PAPER_TRIAL_STATUSES.P2_TARGET_HIT;
  if (label === "P3_RUNNER") return PAPER_TRIAL_STATUSES.P3_TARGET_HIT;
  return PAPER_TRIAL_STATUSES.FILLED_PAPER_TRADE;
}

function eventForBlockLabel(label) {
  if (label === "P1") return PAPER_TRIAL_EVENTS.P1_TARGET_HIT;
  if (label === "P2") return PAPER_TRIAL_EVENTS.P2_TARGET_HIT;
  if (label === "P3_RUNNER") return PAPER_TRIAL_EVENTS.P3_TARGET_HIT;
  return PAPER_TRIAL_EVENTS.UPDATED;
}

function updateTargets(trial, currentPrice, eventTimeUtc) {
  let status = trial.status;
  let eventsToAdd = [];
  let blocks = asArray(trial.blocks).map((block) => {
    if (block.status !== "ACTIVE") return block;

    if (
      targetHit({
        direction: trial.direction,
        currentPrice,
        targetPrice: block.targetPrice,
      })
    ) {
      const closedBlock = closeBlock(block, {
        direction: trial.direction,
        exitPrice: block.targetPrice,
        exitReason: `${block.label}_TARGET_HIT`,
        closedAtUtc: eventTimeUtc,
      });

      const blockStatus = statusForBlockLabel(block.label);
      const blockEvent = eventForBlockLabel(block.label);

      status = blockStatus;

      eventsToAdd.push({
        eventType: blockEvent,
        ts: eventTimeUtc,
        status: blockStatus,
        block: block.block,
        label: block.label,
        price: currentPrice,
        exitPrice: block.targetPrice,
        points: closedBlock.points,
        note: `${block.label} paper target hit.`,
      });

      return closedBlock;
    }

    return block;
  });

  const allClosed = blocks.length > 0 && blocks.every((block) => block.status === "CLOSED");

  if (allClosed) {
    status = PAPER_TRIAL_STATUSES.FINAL_TARGET_HIT;
    eventsToAdd.push({
      eventType: PAPER_TRIAL_EVENTS.FINAL_TARGET_HIT,
      ts: eventTimeUtc,
      status,
      price: currentPrice,
      note: "All Engine 26 paper-trial blocks closed at targets.",
    });
  }

  return {
    ...trial,
    status,
    blocks,
    summary: summarizeBlocks(blocks),
    events: [...asArray(trial.events), ...eventsToAdd],
  };
}

function stopOpenBlocks(trial, currentPrice, eventTimeUtc) {
  const stoppedBlocks = asArray(trial.blocks).map((block) => {
    if (block.status !== "ACTIVE") return block;

    return closeBlock(block, {
      direction: trial.direction,
      exitPrice: trial.stopPrice,
      exitReason: "STOPPED",
      closedAtUtc: eventTimeUtc,
    });
  });

  return completeTrial(trial, {
    status: PAPER_TRIAL_STATUSES.STOPPED,
    result: "LOSS",
    eventType: PAPER_TRIAL_EVENTS.STOPPED,
    price: currentPrice,
    note: "Paper stop touched. Open blocks stopped.",
    eventTimeUtc,
    blocks: stoppedBlocks,
  });
}

function invalidateBeforeFill(trial, currentPrice, eventTimeUtc) {
  const invalidatedBlocks = asArray(trial.blocks).map((block) => ({
    ...block,
    status: "INVALIDATED",
    exitReason: "INVALIDATED_BEFORE_FILL",
    closedAtUtc: eventTimeUtc,
  }));

  return completeTrial(trial, {
    status: PAPER_TRIAL_STATUSES.INVALIDATED_BEFORE_FILL,
    result: "NO_FILL",
    eventType: PAPER_TRIAL_EVENTS.INVALIDATED_BEFORE_FILL,
    price: currentPrice,
    note: "Stop/invalidation touched before paper limit fill.",
    eventTimeUtc,
    blocks: invalidatedBlocks,
  });
}

function updatePaperTrialFromPrice({
  trial = null,
  currentPrice,
  eventTimeUtc = nowIso(),
  symbol = DEFAULT_SYMBOL,
} = {}) {
  const loadedTrial = trial || loadActivePaperTrial(symbol);

  if (!loadedTrial) {
    return {
      updated: false,
      trial: null,
      event: null,
      reason: "NO_ACTIVE_PAPER_TRIAL",
    };
  }

  if (loadedTrial.terminal === true || isTerminalStatus(loadedTrial.status)) {
    return {
      updated: false,
      trial: loadedTrial,
      event: null,
      reason: "PAPER_TRIAL_ALREADY_TERMINAL",
    };
  }

  const price = asNumber(currentPrice);

  if (price == null) {
    return {
      updated: false,
      trial: loadedTrial,
      event: null,
      reason: "MISSING_CURRENT_PRICE",
    };
  }

  let working = {
    ...loadedTrial,
    lastPrice: price,
    lastUpdatePrice: price,
    updatedAtUtc: eventTimeUtc,
  };

  const startingStatus = working.status;

  if (working.filled !== true) {
    if (
      shouldInvalidateBeforeFill({
        direction: working.direction,
        currentPrice: price,
        stopPrice: working.stopPrice,
      })
    ) {
      working = invalidateBeforeFill(working, price, eventTimeUtc);
    } else if (
      shouldFill({
        direction: working.direction,
        currentPrice: price,
        limitPrice: working.limitPrice,
      })
    ) {
      working = markFilled(working, price, eventTimeUtc);
    } else {
      working = maybeExpirePendingTrial(working, eventTimeUtc);
    }
  } else {
    if (
      shouldStop({
        direction: working.direction,
        currentPrice: price,
        stopPrice: working.stopPrice,
      })
    ) {
      working = stopOpenBlocks(working, price, eventTimeUtc);
    } else {
      working = updateTargets(working, price, eventTimeUtc);

      if (working.status === PAPER_TRIAL_STATUSES.FINAL_TARGET_HIT) {
        working = completeTrial(working, {
          status: PAPER_TRIAL_STATUSES.FINAL_TARGET_HIT,
          result: "WIN",
          eventType: PAPER_TRIAL_EVENTS.FINAL_TARGET_HIT,
          price,
          note: "Final runner target reached.",
          eventTimeUtc,
          blocks: working.blocks,
        });
      }
    }
  }

  working.summary = summarizeBlocks(working.blocks);

  const saved = saveActivePaperTrial(working, working.symbol);

  const changed = saved.status !== startingStatus;

  appendPaperTrialJournalEvent(
    {
      eventType: changed ? saved.status : PAPER_TRIAL_EVENTS.UPDATED,
      tradeId: saved.tradeId,
      engine26PaperTrialId: saved.engine26PaperTrialId,
      status: saved.status,
      result: saved.result,
      price,
      filled: saved.filled,
      fillPrice: saved.fillPrice,
      summary: saved.summary,
      terminal: saved.terminal,
      active: saved.active,
    },
    saved.symbol
  );

  return {
    updated: true,
    changed,
    trial: saved,
    event: changed ? saved.status : PAPER_TRIAL_EVENTS.UPDATED,
    reason: null,
  };
}

export {
  PAPER_TRIAL_STATUSES,
  PAPER_TRIAL_EVENTS,
  getStateFilePath,
  getJournalFilePath,
  loadActivePaperTrial,
  saveActivePaperTrial,
  appendPaperTrialJournalEvent,
  createPaperTrialFromManualSignal,
  updatePaperTrialFromPrice,
  completeTrial,
  summarizeBlocks,
};
