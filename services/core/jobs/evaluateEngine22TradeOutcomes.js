// services/core/jobs/evaluateEngine22TradeOutcomes.js
// Engine 24 Outcome Tracker v1
//
// Purpose:
// Read the Engine 22 paper trade learning log and create a reviewed outcome file.
//
// This job does NOT:
// - place trades
// - route orders
// - call brokers
// - execute options
// - modify the original learning log
// - aggressively auto-label trades
//
// Run manually:
// node jobs/evaluateEngine22TradeOutcomes.js

import fs from "fs";

const DATA_DIR = "/opt/render/project/src/services/core/data";

const SYMBOL = String(process.env.SYMBOL || "SPY").toUpperCase();
const STRATEGY_ID = process.env.STRATEGY_ID || "intraday_scalp@10m";
const TF = process.env.TF || "10m";

const CORE_BASE = process.env.CORE_BASE || "http://127.0.0.1:10000";

const LOG_FILE = `${DATA_DIR}/engine22-trade-learning-log.json`;
const REVIEWED_FILE = `${DATA_DIR}/engine22-trade-learning-reviewed.json`;

const WINDOWS = [3, 6, 12, 18, 36];

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
    console.error(`[Outcome Tracker] Failed to read JSON: ${file}`);
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

function upper(x) {
  return String(x || "").trim().toUpperCase();
}

function normalizeTimeToMs(t) {
  const n = Number(t);

  if (!Number.isFinite(n)) return null;

  // Seconds timestamp.
  if (n > 1_000_000_000 && n < 10_000_000_000) {
    return n * 1000;
  }

  // Milliseconds timestamp.
  if (n > 1_000_000_000_000) {
    return n;
  }

  return null;
}

function getBarTimeMs(bar) {
  return normalizeTimeToMs(
    bar?.time ??
      bar?.t ??
      bar?.tSec ??
      bar?.timestamp ??
      bar?.datetime
  );
}

function normalizeBars(payload) {
  const rawBars =
    Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.bars)
        ? payload.bars
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

  return rawBars
    .map((bar) => {
      const timeMs = getBarTimeMs(bar);

      const open = toNum(bar?.open ?? bar?.o);
      const high = toNum(bar?.high ?? bar?.h);
      const low = toNum(bar?.low ?? bar?.l);
      const close = toNum(bar?.close ?? bar?.c);
      const volume = toNum(bar?.volume ?? bar?.v);

      return {
        timeMs,
        timeSec: timeMs !== null ? Math.floor(timeMs / 1000) : null,
        timeIso: timeMs !== null ? new Date(timeMs).toISOString() : null,
        open,
        high,
        low,
        close,
        volume,
        raw: bar,
      };
    })
    .filter((bar) => {
      return (
        bar.timeMs !== null &&
        bar.open !== null &&
        bar.high !== null &&
        bar.low !== null &&
        bar.close !== null
      );
    })
    .sort((a, b) => a.timeMs - b.timeMs);
}

async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const text = await res.text();

    try {
      const json = JSON.parse(text);
      return { ok: res.ok, status: res.status, json, text };
    } catch {
      return { ok: false, status: res.status, json: null, text };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function isFuturesSymbol(sym) {
  const s = String(sym || "").toUpperCase();

  return ["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K"].includes(s);
}

function ohlcPathForSymbol(sym) {
  return isFuturesSymbol(sym) ? "/api/v1/futures/ohlc" : "/api/v1/ohlc";
}

async function fetchBars({ symbol, tf, limit = 500 }) {
  const path = ohlcPathForSymbol(symbol);
  const u = new URL(`${CORE_BASE}${path}`);

  u.searchParams.set("symbol", symbol);
  u.searchParams.set("timeframe", tf);
  u.searchParams.set("limit", String(limit));

  const r = await fetchJson(u.toString(), 30000);

  if (!r?.ok || !r?.json) {
    throw new Error(
      `Failed to fetch bars for ${symbol} ${tf}: ${r?.status || 0} ${r?.text || ""}`
    );
  }

  return normalizeBars(r.json);
}

function pickEntryPrice(row) {
  return round2(
    row?.price ??
      row?.tradeDecision?.currentPrice ??
      row?.tradeDecision?.entryPlan?.entryPrice ??
      row?.tradeDecision?.topCandidate ??
      null
  );
}

function pickTopCandidate(row) {
  return round2(
    row?.tradeDecision?.topCandidate ??
      row?.entryReference?.topCandidate ??
      row?.tradeContextSummary?.topCandidate ??
      null
  );
}

function pickHardInvalidation(row) {
  return round2(
    row?.tradeDecision?.hardInvalidation ??
      row?.stopReference?.hardInvalidation ??
      row?.tradeContextSummary?.hardInvalidation ??
      null
  );
}

function findFirstFutureBarIndex(bars, timestampIso) {
  const entryMs = Date.parse(timestampIso);

  if (!Number.isFinite(entryMs)) return -1;

  return bars.findIndex((bar) => bar.timeMs > entryMs);
}

function summarizeWindow({ bars, startIdx, windowSize, entryPrice, direction }) {
  const endIdx = startIdx + windowSize;
  const slice = bars.slice(startIdx, endIdx);

  if (slice.length < windowSize) {
    return {
      complete: false,
      requestedBars: windowSize,
      availableBars: slice.length,
      startBar: slice[0] || null,
      endBar: slice[slice.length - 1] || null,
      high: null,
      low: null,
      close: null,
      mfePts: null,
      maePts: null,
      maxUpPts: null,
      maxDownPts: null,
    };
  }

  const highs = slice.map((b) => b.high).filter((x) => Number.isFinite(x));
  const lows = slice.map((b) => b.low).filter((x) => Number.isFinite(x));
  const last = slice[slice.length - 1];

  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const close = last?.close ?? null;

  const maxUpPts = round2(high - entryPrice);
  const maxDownPts = round2(entryPrice - low);

  let mfePts = null;
  let maePts = null;

  if (direction === "LONG") {
    mfePts = maxUpPts;
    maePts = maxDownPts;
  } else if (direction === "SHORT") {
    mfePts = maxDownPts;
    maePts = maxUpPts;
  } else {
    // WAIT/NONE decision: keep neutral movement stats.
    mfePts = null;
    maePts = null;
  }

  return {
    complete: true,
    requestedBars: windowSize,
    availableBars: slice.length,
    startBar: {
      timeIso: slice[0]?.timeIso ?? null,
      open: slice[0]?.open ?? null,
      high: slice[0]?.high ?? null,
      low: slice[0]?.low ?? null,
      close: slice[0]?.close ?? null,
    },
    endBar: {
      timeIso: last?.timeIso ?? null,
      open: last?.open ?? null,
      high: last?.high ?? null,
      low: last?.low ?? null,
      close: last?.close ?? null,
    },
    high: round2(high),
    low: round2(low),
    close: round2(close),
    mfePts,
    maePts,
    maxUpPts,
    maxDownPts,
  };
}

function evaluateHitLevels({ windows, topCandidate, hardInvalidation }) {
  const byWindow = {};

  for (const [key, w] of Object.entries(windows)) {
    const reclaimHit =
      topCandidate !== null &&
      w?.complete === true &&
      Number(w.high) >= Number(topCandidate);

    const invalidationHit =
      hardInvalidation !== null &&
      w?.complete === true &&
      Number(w.low) <= Number(hardInvalidation);

    byWindow[key] = {
      reclaimHit,
      invalidationHit,
      topCandidate,
      hardInvalidation,
    };
  }

  return byWindow;
}

function evaluateWaitDecision({ windows, levelHits }) {
  const w36 = windows?.plus36 ?? null;
  const h36 = levelHits?.plus36 ?? null;

  if (!w36 || w36.complete !== true) {
    return {
      outcomeLabel: "PENDING_NOT_ENOUGH_BARS",
      waitWasCorrect: null,
      explanation: "Not enough future bars are available to evaluate the WAIT decision yet.",
    };
  }

  const invalidationHit = h36?.invalidationHit === true;
  const reclaimHit = h36?.reclaimHit === true;

  const maxUpPts = toNum(w36?.maxUpPts);
  const maxDownPts = toNum(w36?.maxDownPts);

  if (invalidationHit) {
    return {
      outcomeLabel: "WAIT_PROTECTED_FROM_LOSS",
      waitWasCorrect: true,
      explanation: "Price hit hard invalidation within the review window. Waiting protected the system from a bad entry.",
    };
  }

  if (!reclaimHit) {
    return {
      outcomeLabel: "WAIT_CORRECT_NO_RECLAIM",
      waitWasCorrect: true,
      explanation: "Price did not reclaim the top candidate within the review window. Waiting was correct.",
    };
  }

  if (reclaimHit && maxUpPts !== null && maxUpPts >= 2 && !invalidationHit) {
    return {
      outcomeLabel: "WAIT_TOO_CAUTIOUS_RECLAIM_WORKED",
      waitWasCorrect: false,
      explanation: "Price reclaimed the top candidate and moved higher without hitting invalidation. WAIT may have been too cautious.",
    };
  }

  if (
    reclaimHit &&
    maxUpPts !== null &&
    maxDownPts !== null &&
    maxUpPts > maxDownPts
  ) {
    return {
      outcomeLabel: "WAIT_INCONCLUSIVE_RECLAIM_MIXED",
      waitWasCorrect: null,
      explanation: "Price reclaimed but movement was mixed. More context is needed before judging the WAIT decision.",
    };
  }

  return {
    outcomeLabel: "WAIT_INCONCLUSIVE",
    waitWasCorrect: null,
    explanation: "The WAIT decision outcome is inconclusive in the current review window.",
  };
}

function evaluateTradeDecision({ windows, levelHits, direction }) {
  const w36 = windows?.plus36 ?? null;
  const h36 = levelHits?.plus36 ?? null;

  if (!w36 || w36.complete !== true) {
    return {
      outcomeLabel: "PENDING_NOT_ENOUGH_BARS",
      tradeWorked: null,
      explanation: "Not enough future bars are available to evaluate the trade decision yet.",
    };
  }

  const invalidationHit = h36?.invalidationHit === true;
  const reclaimHit = h36?.reclaimHit === true;

  if (direction === "LONG") {
    if (invalidationHit) {
      return {
        outcomeLabel: "LONG_STOP_RISK_HIT",
        tradeWorked: false,
        explanation: "Long setup hit hard invalidation during the review window.",
      };
    }

    if (reclaimHit) {
      return {
        outcomeLabel: "LONG_RECLAIM_FOLLOWED_THROUGH",
        tradeWorked: true,
        explanation: "Long setup reclaimed the top candidate and did not hit hard invalidation.",
      };
    }
  }

  if (direction === "SHORT") {
    return {
      outcomeLabel: "SHORT_REVIEW_NOT_BUILT_V1",
      tradeWorked: null,
      explanation: "Short outcome review is intentionally not built in v1 unless Engine 22 confirms short setup rules.",
    };
  }

  return {
    outcomeLabel: "TRADE_INCONCLUSIVE",
    tradeWorked: null,
    explanation: "Trade decision outcome is inconclusive.",
  };
}

function evaluateRow({ row, bars }) {
  const timestamp = row?.timestamp ?? null;
  const symbol = String(row?.symbol || SYMBOL).toUpperCase();
  const strategyId = row?.strategyId || STRATEGY_ID;

  const decision = upper(row?.decision ?? row?.tradeDecision?.decision);
  const direction = upper(row?.direction ?? row?.tradeDecision?.direction);

  const entryPrice = pickEntryPrice(row);
  const topCandidate = pickTopCandidate(row);
  const hardInvalidation = pickHardInvalidation(row);

  const firstFutureBarIdx = findFirstFutureBarIndex(bars, timestamp);

  if (firstFutureBarIdx < 0 || entryPrice === null) {
    return {
      ...row,
      outcomeReview: {
        reviewedAt: nowIso(),
        reviewer: "engine24.outcomeTracker.v1",
        ok: false,
        reviewStatus: "PENDING_NOT_ENOUGH_DATA",
        reason: "Missing future bars or entry price.",
        firstFutureBarIdx,
        entryPrice,
      },
    };
  }

  const windows = {};

  for (const size of WINDOWS) {
    windows[`plus${size}`] = summarizeWindow({
      bars,
      startIdx: firstFutureBarIdx,
      windowSize: size,
      entryPrice,
      direction,
    });
  }

  const levelHits = evaluateHitLevels({
    windows,
    topCandidate,
    hardInvalidation,
  });

  const isWaitDecision =
    decision === "WAIT" ||
    decision === "WATCH" ||
    direction === "NONE" ||
    row?.entryAllowed === false ||
    row?.tradeDecision?.entryAllowed === false;

  const decisionQuality = isWaitDecision
    ? evaluateWaitDecision({ windows, levelHits })
    : evaluateTradeDecision({ windows, levelHits, direction });

  const complete36 = windows?.plus36?.complete === true;

  return {
    ...row,

    outcomePending: complete36 ? false : true,
    reviewStatus: complete36 ? "REVIEWED_V1" : "PENDING_NOT_ENOUGH_BARS",
    outcomeTrackingEnabled: true,

    outcomeReview: {
      reviewedAt: nowIso(),
      reviewer: "engine24.outcomeTracker.v1",
      ok: true,
      symbol,
      strategyId,
      tf: TF,

      originalTimestamp: timestamp,
      firstFutureBarIdx,
      entryPrice,
      topCandidate,
      hardInvalidation,

      decision,
      direction,
      setupType: row?.setupType ?? row?.tradeDecision?.setupType ?? null,
      grade: row?.grade ?? row?.tradeDecision?.grade ?? null,

      windows,
      levelHits,
      decisionQuality,

      safety: {
        readOnly: true,
        originalLogModified: false,
        liveTradingEnabled: false,
        brokerCallsEnabled: false,
        orderRoutingEnabled: false,
        optionsExecutionEnabled: false,
      },
    },
  };
}

async function main() {
  console.log("[Outcome Tracker] Starting Engine 24 outcome evaluation...");
  console.log("[Outcome Tracker] Symbol:", SYMBOL);
  console.log("[Outcome Tracker] Strategy:", STRATEGY_ID);
  console.log("[Outcome Tracker] Timeframe:", TF);
  console.log("[Outcome Tracker] Log file:", LOG_FILE);
  console.log("[Outcome Tracker] Reviewed file:", REVIEWED_FILE);

  const log = readJsonFile(LOG_FILE, []);

  if (!Array.isArray(log)) {
    throw new Error(`Learning log is not an array: ${LOG_FILE}`);
  }

  const pendingRows = log.filter((row) => {
    if (!row || typeof row !== "object") return false;

    const rowSymbol = String(row?.symbol || "").toUpperCase();
    const rowStrategy = row?.strategyId || "";

    return (
      rowSymbol === SYMBOL &&
      rowStrategy === STRATEGY_ID &&
      row?.outcomePending === true
    );
  });

  console.log("[Outcome Tracker] Total log rows:", log.length);
  console.log("[Outcome Tracker] Pending rows:", pendingRows.length);

  const bars = await fetchBars({
    symbol: SYMBOL,
    tf: TF,
    limit: 500,
  });

  console.log("[Outcome Tracker] Bars fetched:", bars.length);

  const reviewed = log.map((row) => {
    const rowSymbol = String(row?.symbol || "").toUpperCase();
    const rowStrategy = row?.strategyId || "";

    const shouldReview =
      rowSymbol === SYMBOL &&
      rowStrategy === STRATEGY_ID &&
      row?.outcomePending === true;

    if (!shouldReview) return row;

    return evaluateRow({ row, bars });
  });

  writeJsonFile(REVIEWED_FILE, reviewed);

  const reviewedPending = reviewed.filter((row) => {
    return (
      String(row?.symbol || "").toUpperCase() === SYMBOL &&
      row?.strategyId === STRATEGY_ID &&
      row?.outcomeReview?.reviewer === "engine24.outcomeTracker.v1"
    );
  });

  const lastReviewed = reviewedPending[reviewedPending.length - 1] || null;

  console.log("[Outcome Tracker] Reviewed output written:", REVIEWED_FILE);
  console.log("[Outcome Tracker] Reviewed rows:", reviewedPending.length);

  if (lastReviewed) {
    console.log("[Outcome Tracker] Last reviewed summary:", {
      timestamp: lastReviewed.timestamp,
      symbol: lastReviewed.symbol,
      strategyId: lastReviewed.strategyId,
      decision: lastReviewed.decision,
      direction: lastReviewed.direction,
      setupType: lastReviewed.setupType,
      grade: lastReviewed.grade,
      outcomePending: lastReviewed.outcomePending,
      reviewStatus: lastReviewed.reviewStatus,
      outcomeLabel:
        lastReviewed?.outcomeReview?.decisionQuality?.outcomeLabel ?? null,
      waitWasCorrect:
        lastReviewed?.outcomeReview?.decisionQuality?.waitWasCorrect ?? null,
      entryPrice: lastReviewed?.outcomeReview?.entryPrice ?? null,
      topCandidate: lastReviewed?.outcomeReview?.topCandidate ?? null,
      hardInvalidation: lastReviewed?.outcomeReview?.hardInvalidation ?? null,
    });
  }

  console.log("[Outcome Tracker] Complete.");
  console.log("[Outcome Tracker] Original log was NOT modified.");
}

try {
  await main();
} catch (err) {
  console.error("[Outcome Tracker] FAILED");
  console.error(err);
  process.exitCode = 1;
}
