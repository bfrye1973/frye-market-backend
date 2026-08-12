// - Fast PAPER_ONLY / RESEARCH_ONLY candle + imbalance reaction read.
// - Designed for Engine 26 FAST_IMBALANCE_WATCH.
// - Reads manual ES imbalance zones from data/es-smz-manual-zones.txt.
// - Reads latest 10m candle behavior around the active imbalance.
// - Consumes Engine 22 degreeStates wave context.
// - Consumes Engine 26 structural locationContext.
// - Does NOT create permission.
// - Does NOT create execution.
// - Does NOT set READY, freshEntryNow, executable, or broker actions.
//
// Output path after attach:
// confluence.context.reaction.engine3FastImbalanceReaction

import fs from "fs";
import { buildEngine22DegreeWaveContext } from "./engine22DegreeWaveContext.js";
import { buildEngine26LocationReactionContext } from "./engine26LocationReactionContext.js";
import { deriveCandleCompletionTruth } from "./candleCompletionTruth.js";

const ENGINE = "engine3.fastImbalanceReaction.v1";
const SOURCE = "ENGINE26_IMBALANCE_WATCH";

const DATA_DIR = "/opt/render/project/src/services/core/data";
const MANUAL_ZONES_FILE = `${DATA_DIR}/es-smz-manual-zones.txt`;

const FAST_WATCH_BUFFER_PTS = 12;

const DEFAULT_LEVEL_ACTION = {
  heldLevel: false,
  lostLevel: false,
  reclaimedLevel: false,
  failedReclaim: false,
  wickBelowAndReclaim: false,
  dipBoughtFast: false,
  sellersTrapped: false,
  acceptingValue: false,
  rejectingValue: false,
  chopInsideValue: false,
  breakoutHolding: false,
  breakoutFailing: false,
};

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function uniqueReasonCodes(reasonCodes = []) {
  return [...new Set(reasonCodes.filter(Boolean))];
}

function normalizeBar(bar) {
  return {
    open: toNum(bar?.open ?? bar?.o),
    high: toNum(bar?.high ?? bar?.h),
    low: toNum(bar?.low ?? bar?.l),
    close: toNum(bar?.close ?? bar?.c),
    volume: toNum(bar?.volume ?? bar?.v),
    time: bar?.time ?? bar?.t ?? bar?.tSec ?? null,
  };
}

function normalizeZone(lo, hi) {
  const a = toNum(lo);
  const b = toNum(hi);

  if (a == null || b == null) return null;

  return {
    lo: Math.min(a, b),
    hi: Math.max(a, b),
    mid: round2((Math.min(a, b) + Math.max(a, b)) / 2),
  };
}

function parseRange(text) {
  const match = String(text || "").match(
    /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/
  );

  if (!match) return null;

  return normalizeZone(match[1], match[2]);
}

function distanceToZone(zone, price) {
  const p = toNum(price);

  if (!zone || p == null) return null;

  if (p >= zone.lo && p <= zone.hi) return 0;
  return p < zone.lo ? round2(zone.lo - p) : round2(p - zone.hi);
}

function isInsideZone(zone, price) {
  const p = toNum(price);

  if (!zone || p == null) return false;

  return p >= zone.lo && p <= zone.hi;
}

function readManualImbalanceZones() {
  if (!fs.existsSync(MANUAL_ZONES_FILE)) {
    return {
      ok: false,
      zones: [],
      reasonCodes: ["MANUAL_IMBALANCE_FILE_MISSING"],
    };
  }

  const text = fs.readFileSync(MANUAL_ZONES_FILE, "utf8");

  const zones = text
    .split(/\r?\n/)
    .map((line, idx) => {
      const raw = String(line || "").trim();

      if (!raw || raw.startsWith("#")) return null;

      const [leftPart, rightPartRaw = ""] = raw.split("|");
      const mainZone = parseRange(leftPart);

      const negMatch = String(rightPartRaw || "").match(
        /NEG\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i
      );

      const negZone = negMatch
        ? normalizeZone(negMatch[1], negMatch[2])
        : null;

      if (!mainZone && !negZone) return null;

      const comment = raw.includes("#")
        ? raw.slice(raw.indexOf("#") + 1).trim()
        : null;

      return {
        id: `ES_MANUAL_IMBALANCE_${idx + 1}`,
        symbol: "ES",
        source: "es-smz-manual-zones.txt",
        raw,
        comment,
        side: "GREEN",
        zoneType: "MANUAL_IMBALANCE",
        lo: mainZone?.lo ?? negZone?.lo ?? null,
        hi: mainZone?.hi ?? negZone?.hi ?? null,
        mid: mainZone?.mid ?? negZone?.mid ?? null,
        negZone,
      };
    })
    .filter(Boolean);

  return {
    ok: true,
    zones,
    reasonCodes: zones.length
      ? ["MANUAL_IMBALANCE_ZONES_LOADED"]
      : ["MANUAL_IMBALANCE_ZONES_EMPTY"],
  };
}

function pickActiveImbalance({ zones = [], price }) {
  const p = toNum(price);

  if (p == null || !Array.isArray(zones) || !zones.length) return null;

  const scored = zones
    .map((zone) => {
      const distancePts = distanceToZone(zone, p);
      const inside = isInsideZone(zone, p);
      const near =
        distancePts != null &&
        distancePts > 0 &&
        distancePts <= FAST_WATCH_BUFFER_PTS;

      return {
        ...zone,
        distancePts,
        inside,
        near,
        fastWatch: inside || near,
      };
    })
    .filter((zone) => zone.distancePts != null)
    .sort((a, b) => Number(a.distancePts) - Number(b.distancePts));

  return scored[0] || null;
}

function classifyQuality(state) {
  if (
    [
      "WICK_BELOW_AND_RECLAIM",
      "DIP_BOUGHT_FAST",
      "SELLERS_TRAPPED",
      "RECLAIMED_LEVEL",
      "BREAKOUT_HOLDING",
    ].includes(state)
  ) {
    return "STRONG";
  }

  if (["ACCEPTING_VALUE"].includes(state)) {
    return "GOOD";
  }

  if (state === "HELD_LEVEL") {
    return "MIXED";
  }

  if (
    [
      "FAILED_RECLAIM",
      "REJECTING_VALUE",
      "LOST_LEVEL",
      "BREAKOUT_FAILING",
      "CHOP_INSIDE_VALUE",
      "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",
      "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",
    ].includes(state)
  ) {
    return "MIXED";
  }

  if (
    [
      "FAILED_ACCEPTANCE_SHORT",
      "LOST_SHORT_TRIGGER_LEVEL",
    ].includes(state)
  ) {
    return "GOOD";
  }

  return "WEAK";
}

export function classifyTenMinuteDiagnosticDirection(completedBars = []) {
  const bars = Array.isArray(completedBars)
    ? completedBars.filter(Boolean).map(normalizeBar)
    : [];

  /*
   * Deterministic V1 10m diagnostic classifier.
   *
   * Guardrails:
   * - completed 10m candles only
   * - ATR(14) from completed candles only
   * - four-candle evaluation window
   * - minimum absolute net-close displacement >= 1.25 ATR
   * - signed net displacement chooses candidate direction
   * - aggregate candle-body magnitude must agree
   * - materially opposite high/low structure cancels to NEUTRAL
   * - structure may never reverse direction
   * - no fallback to the retired point-voting scorer
   */
  if (bars.length < 15) {
    return "NEUTRAL";
  }

  const atrBars = bars.slice(-15);

  for (const bar of atrBars) {
    if (
      bar.open == null ||
      bar.high == null ||
      bar.low == null ||
      bar.close == null
    ) {
      return "NEUTRAL";
    }
  }

  const trueRanges = [];

  for (let index = 1; index < atrBars.length; index += 1) {
    const previousClose = atrBars[index - 1].close;
    const current = atrBars[index];

    const trueRange = Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose)
    );

    if (!Number.isFinite(trueRange)) {
      return "NEUTRAL";
    }

    trueRanges.push(trueRange);
  }

  if (trueRanges.length !== 14) {
    return "NEUTRAL";
  }

  const atr14 =
    trueRanges.reduce((sum, value) => sum + value, 0) /
    trueRanges.length;

  if (!Number.isFinite(atr14) || atr14 <= 0) {
    return "NEUTRAL";
  }

  const window = bars.slice(-4);

  if (window.length !== 4) {
    return "NEUTRAL";
  }

  const netClose =
    window[window.length - 1].close -
    window[0].close;

  if (!Number.isFinite(netClose) || netClose === 0) {
    return "NEUTRAL";
  }

  const normalizedDisplacement =
    Math.abs(netClose) / atr14;

  if (
    !Number.isFinite(normalizedDisplacement) ||
    normalizedDisplacement < 1.25
  ) {
    return "NEUTRAL";
  }

  const candidateDirection =
    netClose > 0
      ? "LONG"
      : "SHORT";

  let bullishBodyPoints = 0;
  let bearishBodyPoints = 0;

  for (const bar of window) {
    const body = bar.close - bar.open;

    if (!Number.isFinite(body)) {
      return "NEUTRAL";
    }

    if (body > 0) {
      bullishBodyPoints += body;
    } else if (body < 0) {
      bearishBodyPoints += Math.abs(body);
    }
  }

  if (
    candidateDirection === "LONG" &&
    !(bullishBodyPoints > bearishBodyPoints)
  ) {
    return "NEUTRAL";
  }

  if (
    candidateDirection === "SHORT" &&
    !(bearishBodyPoints > bullishBodyPoints)
  ) {
    return "NEUTRAL";
  }

  let higherHighs = 0;
  let higherLows = 0;
  let lowerHighs = 0;
  let lowerLows = 0;

  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1];
    const current = window[index];

    if (current.high > previous.high) higherHighs += 1;
    if (current.low > previous.low) higherLows += 1;
    if (current.high < previous.high) lowerHighs += 1;
    if (current.low < previous.low) lowerLows += 1;
  }

  if (
    candidateDirection === "LONG" &&
    lowerHighs >= 2 &&
    lowerLows >= 2
  ) {
    return "NEUTRAL";
  }

  if (
    candidateDirection === "SHORT" &&
    higherHighs >= 2 &&
    higherLows >= 2
  ) {
    return "NEUTRAL";
  }

  return candidateDirection;
}

function classifyDirection(state) {
  if (
    [
      "HELD_LEVEL",
      "RECLAIMED_LEVEL",
      "WICK_BELOW_AND_RECLAIM",
      "DIP_BOUGHT_FAST",
      "SELLERS_TRAPPED",
      "ACCEPTING_VALUE",
      "BREAKOUT_HOLDING",
    ].includes(state)
  ) {
    return "LONG";
  }

  if (
    [
      "LOST_LEVEL",
      "FAILED_RECLAIM",
      "REJECTING_VALUE",
      "BREAKOUT_FAILING",
      "FAILED_ACCEPTANCE_SHORT",
      "LOST_SHORT_TRIGGER_LEVEL",
    ].includes(state)
  ) {
    return "SHORT";
  }

  return "NEUTRAL";
}

function classifyConfirmed(state) {
  return [
    "HELD_LEVEL",
    "RECLAIMED_LEVEL",
    "WICK_BELOW_AND_RECLAIM",
    "DIP_BOUGHT_FAST",
    "SELLERS_TRAPPED",
    "ACCEPTING_VALUE",
    "BREAKOUT_HOLDING",
  ].includes(state);
}

function evaluateFastImbalanceAction({ imbalance, last, prev, currentPrice }) {
  const flags = { ...DEFAULT_LEVEL_ACTION };
  const reasonCodes = [];

  if (!imbalance) {
    return {
      state: "NO_FAST_IMBALANCE",
      flags,
      reasonCodes: ["NO_ACTIVE_MANUAL_IMBALANCE"],
    };
  }

  if (!last || !prev) {
    return {
      state: "INSUFFICIENT_CANDLES",
      flags,
      reasonCodes: ["INSUFFICIENT_CANDLES"],
    };
  }

  const zone = {
    lo: imbalance.lo,
    hi: imbalance.hi,
    mid: imbalance.mid,
  };

  const lastInside = isInsideZone(zone, last.close);
  const prevInside = isInsideZone(zone, prev.close);

  const prevAbove = prev.close != null && prev.close > zone.hi;
  const prevBelow = prev.close != null && prev.close < zone.lo;

  const wickBelowAndReclaim =
    last.low != null &&
    last.close != null &&
    last.low < zone.lo &&
    last.close >= zone.lo;

  const wickAboveAndReject =
    last.high != null &&
    last.close != null &&
    last.high > zone.hi &&
    last.close <= zone.hi;

  const reclaimedLevel =
    (prevBelow || prevInside) &&
    last.close != null &&
    last.close > zone.hi;

  const lostLevel =
    (prevInside || prevAbove) &&
    last.close != null &&
    last.close < zone.lo;

  const heldLevel =
    last.low != null &&
    last.close != null &&
    last.low <= zone.hi &&
    last.close >= zone.lo &&
    !wickBelowAndReclaim &&
    !wickAboveAndReject;

  const breakoutHolding =
    last.close != null &&
    prev.high != null &&
    last.close > zone.hi &&
    last.close > prev.high;

  const breakoutFailing =
    last.high != null &&
    prev.high != null &&
    last.high > prev.high &&
    last.close != null &&
    last.close <= zone.hi;

  const sweptPriorLow =
    prev.low != null &&
    last.low != null &&
    last.low < prev.low;

  const sweptPriorHigh =
    prev.high != null &&
    last.high != null &&
    last.high > prev.high;

  const dipBoughtFast =
    sweptPriorLow &&
    last.open != null &&
    last.close != null &&
    last.close > last.open &&
    prev.close != null &&
    last.close > prev.close;

  const sellersTrapped =
    sweptPriorLow &&
    prev.high != null &&
    last.close != null &&
    last.close > prev.high;

  const failedReclaim =
    last.high != null &&
    last.close != null &&
    last.high >= zone.hi &&
    last.close < zone.hi;

  const rejectingValue =
    wickAboveAndReject ||
    (
      sweptPriorHigh &&
      last.close != null &&
      prev.close != null &&
      last.close < prev.close
    );

  const acceptingValue =
    last.close != null &&
    last.close > zone.hi &&
    !breakoutFailing;

  const chopInsideValue =
    lastInside &&
    prevInside &&
    !wickBelowAndReclaim &&
    !wickAboveAndReject &&
    !reclaimedLevel &&
    !lostLevel;

  if (sellersTrapped) {
    flags.sellersTrapped = true;
    flags.dipBoughtFast = true;
    flags.wickBelowAndReclaim = wickBelowAndReclaim;
    reasonCodes.push("SELLERS_TRAPPED_BELOW_PRIOR_LOW");
    return { state: "SELLERS_TRAPPED", flags, reasonCodes };
  }

  if (dipBoughtFast) {
    flags.dipBoughtFast = true;
    flags.wickBelowAndReclaim = wickBelowAndReclaim;
    reasonCodes.push("DIP_BOUGHT_FAST_AFTER_PRIOR_LOW_SWEEP");
    return { state: "DIP_BOUGHT_FAST", flags, reasonCodes };
  }

  if (wickBelowAndReclaim) {
    flags.wickBelowAndReclaim = true;
    flags.reclaimedLevel = true;
    reasonCodes.push("WICK_BELOW_IMBALANCE_AND_RECLAIMED");
    return { state: "WICK_BELOW_AND_RECLAIM", flags, reasonCodes };
  }

  if (breakoutHolding) {
    flags.breakoutHolding = true;
    flags.reclaimedLevel = true;
    flags.acceptingValue = true;
    reasonCodes.push("BREAKOUT_HOLDING_ABOVE_IMBALANCE");
    return { state: "BREAKOUT_HOLDING", flags, reasonCodes };
  }

  if (breakoutFailing) {
    flags.breakoutFailing = true;
    flags.failedReclaim = true;
    reasonCodes.push("BREAKOUT_FAILING_BACK_INTO_IMBALANCE");
    return { state: "BREAKOUT_FAILING", flags, reasonCodes };
  }

  if (reclaimedLevel) {
    flags.reclaimedLevel = true;
    reasonCodes.push("IMBALANCE_RECLAIMED");
    return { state: "RECLAIMED_LEVEL", flags, reasonCodes };
  }

  if (lostLevel) {
    flags.lostLevel = true;
    reasonCodes.push("IMBALANCE_LOST");
    return { state: "LOST_LEVEL", flags, reasonCodes };
  }

  if (failedReclaim || rejectingValue) {
    flags.failedReclaim = failedReclaim;
    flags.rejectingValue = true;
    reasonCodes.push("REJECTING_IMBALANCE_VALUE");
    return { state: "REJECTING_VALUE", flags, reasonCodes };
  }

  if (acceptingValue) {
    flags.acceptingValue = true;
    reasonCodes.push("ACCEPTING_ABOVE_IMBALANCE_VALUE");
    return { state: "ACCEPTING_VALUE", flags, reasonCodes };
  }

  if (heldLevel) {
    flags.heldLevel = true;
    reasonCodes.push("IMBALANCE_HELD");
    return { state: "HELD_LEVEL", flags, reasonCodes };
  }

  if (chopInsideValue) {
    flags.chopInsideValue = true;
    reasonCodes.push("CHOP_INSIDE_IMBALANCE_VALUE");
    return { state: "CHOP_INSIDE_VALUE", flags, reasonCodes };
  }

  return {
    state: "NO_SIGNAL",
    flags,
    reasonCodes: ["NO_CLEAR_FAST_IMBALANCE_ACTION"],
  };
}

function buildWaveContext({ engine22WaveStrategy, state, direction }) {
  return buildEngine22DegreeWaveContext({
    engine22WaveStrategy,
    reactionState: state,
    reactionDirection: direction,
  });
}

function applyEngine26LocationContext({
  engine26ReactionHandoff = null,
  engine26StructuralContext,
  state,
  quality,
  direction,
  confirmed,
  price,
  last,
}) {
  const engine26LocationContext = buildEngine26LocationReactionContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionInput: {
      state,
      quality,
      direction,
      confirmed,
      currentPrice: price,
      lastCandle: last,
      noPermissionCreated: true,
      noExecution: true,
    },
  });

  return {
    // Phase C: Engine 26 context is diagnostic here only.
    // Primary fast reaction facts remain the raw candle classification.
    state,
    quality,
    direction,
    confirmed,
    engine26LocationContext,
  };
}

function makeInactiveResult({
  symbol,
  tf,
  currentPrice,
  state,
  reasonCodes = [],
  imbalance = null,
  lastCandle = null,
  priorCandle = null,
  engine22WaveStrategy = null,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  candleCompletionTruth = null,
}) {
  const quality = "WEAK";
  const direction = "NEUTRAL";
  const confirmed = false;

  const locationAdjusted = applyEngine26LocationContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    state,
    quality,
    direction,
    confirmed,
    price: currentPrice,
    last: lastCandle,
  });

  return {
    active: false,
    engine: ENGINE,
    source: SOURCE,

    mode: "FAST_IMBALANCE_WATCH",
    fastMode: true,
    paperOnly: true,
    researchOnly: true,

    symbol: symbol || "ES",
    tf: tf || "10m",

    candleClosed:
      candleCompletionTruth?.latestBarCompletionState === "COMPLETED"
        ? true
        : candleCompletionTruth?.latestBarCompletionState === "FORMING"
        ? false
        : null,
    candleCompletionState:
      candleCompletionTruth?.latestBarCompletionState || "NO_BARS",
    evaluationTimeMs: candleCompletionTruth?.evaluationTimeMs ?? null,
    supportingBarTime: lastCandle?.time ?? null,
    supportingExpectedCloseTimeMs:
      candleCompletionTruth?.latestExpectedCloseTimeMs ?? null,
    earlySignal: false,

    state: locationAdjusted.state,
    quality: locationAdjusted.quality,
    direction: locationAdjusted.direction,
    confirmed: locationAdjusted.confirmed,
    rawState: state,
    rawQuality: quality,
    rawDirection: direction,
    rawConfirmed: confirmed,

    waveContext: buildWaveContext({
      engine22WaveStrategy,
      state: locationAdjusted.state,
      direction: locationAdjusted.direction,
    }),

    engine26LocationContext: locationAdjusted.engine26LocationContext,

    currentPrice: currentPrice ?? null,
    imbalance,

    levelAction: { ...DEFAULT_LEVEL_ACTION },

    requiresEngine6PaperApproval: true,
    noPermissionCreated: true,
    noExecution: true,

    lastCandle: lastCandle || null,
    priorCandle: priorCandle || null,

    reasonCodes: uniqueReasonCodes([
      ...reasonCodes,
      ...(locationAdjusted.engine26LocationContext?.reasonCodes || []),
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
      "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
    ]),
  };
}

export function buildFastImbalanceReaction({
  symbol = "ES",
  tf = "10m",
  bars10m = [],
  currentPrice = null,
  engine26FastWatch = null,
  confluence = null,
  engine22WaveStrategy = null,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  previousCanonicalDirection = "NEUTRAL",
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  evaluationTimeMs = null,
} = {}) {
  const bars = Array.isArray(bars10m) ? bars10m.map(normalizeBar) : [];
  const last = bars[bars.length - 1] || null;
  const prev = bars[bars.length - 2] || null;
  const candleCompletionTruth = deriveCandleCompletionTruth({
    bars,
    timeframe: tf,
    evaluationTimeMs,
  });

  const price =
    validPrice(currentPrice) ??
    validPrice(last?.close) ??
    validPrice(confluence?.price) ??
    validPrice(confluence?.currentPrice) ??
    validPrice(engine26FastWatch?.currentPrice) ??
    null;

  const manualZonesRead = readManualImbalanceZones();

  if (!manualZonesRead.ok || !manualZonesRead.zones.length) {
    return makeInactiveResult({
      symbol,
      tf,
      currentPrice: price,
      state: "NO_MANUAL_IMBALANCE_ZONES",
      lastCandle: last,
      priorCandle: prev,
      engine22WaveStrategy,
      engine26ReactionHandoff,
      engine26StructuralContext,
      candleCompletionTruth,
      reasonCodes: manualZonesRead.reasonCodes,
    });
  }

  const activeImbalance = pickActiveImbalance({
    zones: manualZonesRead.zones,
    price,
  });

  if (!activeImbalance || activeImbalance.fastWatch !== true) {
    return makeInactiveResult({
      symbol,
      tf,
      currentPrice: price,
      state: "NO_FAST_IMBALANCE_WATCH",
      imbalance: activeImbalance || null,
      lastCandle: last,
      priorCandle: prev,
      engine22WaveStrategy,
      engine26ReactionHandoff,
      engine26StructuralContext,
      candleCompletionTruth,
      reasonCodes: [
        "PRICE_NOT_NEAR_MANUAL_IMBALANCE",
        ...manualZonesRead.reasonCodes,
      ],
    });
  }

  if (!last || !prev) {
    return makeInactiveResult({
      symbol,
      tf,
      currentPrice: price,
      state: "INSUFFICIENT_CANDLES",
      imbalance: activeImbalance,
      lastCandle: last,
      priorCandle: prev,
      engine22WaveStrategy,
      engine26ReactionHandoff,
      engine26StructuralContext,
      candleCompletionTruth,
      reasonCodes: [
        "INSUFFICIENT_CANDLES",
        ...manualZonesRead.reasonCodes,
      ],
    });
  }

  const evaluation = evaluateFastImbalanceAction({
    imbalance: activeImbalance,
    last,
    prev,
    currentPrice: price,
  });

  const rawState = evaluation.state || "NO_SIGNAL";

  const candleDirectionRaw =
    classifyTenMinuteDiagnosticDirection(
      candleCompletionTruth.completedBars
    );

  const previousDirection =
    String(previousCanonicalDirection || "NEUTRAL").toUpperCase();

  const completedClose =
    toNum(tenMinuteCompletedClose);

  const ema10 =
    toNum(tenMinuteEma10);

  let candleDirection =
    candleDirectionRaw;

  let ema10PersistenceState =
    null;

  if (
    previousDirection === "SHORT" &&
    completedClose != null &&
    ema10 != null
  ) {
    if (completedClose < ema10) {
      candleDirection = "SHORT";
      ema10PersistenceState =
        "SHORT_PERSISTED_BELOW_10M_EMA10";
    } else if (completedClose > ema10) {
      candleDirection = "NEUTRAL";
      ema10PersistenceState =
        "SHORT_RESET_BY_COMPLETED_CLOSE_ABOVE_10M_EMA10";
    }
  } else if (
    previousDirection === "LONG" &&
    completedClose != null &&
    ema10 != null
  ) {
    if (completedClose > ema10) {
      candleDirection = "LONG";
      ema10PersistenceState =
        "LONG_PERSISTED_ABOVE_10M_EMA10";
    } else if (completedClose < ema10) {
      candleDirection = "NEUTRAL";
      ema10PersistenceState =
        "LONG_RESET_BY_COMPLETED_CLOSE_BELOW_10M_EMA10";
    }
  }

  const rawQuality =
    rawState === "HELD_LEVEL"
      ? (
          candleDirection === "NEUTRAL"
            ? "MIXED"
            : "GOOD"
        )
      : classifyQuality(rawState);

  const rawDirection = candleDirection;
  const rawConfirmed =
    classifyConfirmed(rawState) &&
    candleCompletionTruth.latestBarCompletionState === "COMPLETED";

  const locationAdjusted = applyEngine26LocationContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    state: rawState,
    quality: rawQuality,
    direction: rawDirection,
    confirmed: rawConfirmed,
    price,
    last,
  });

  const state = locationAdjusted.state;
  const quality = locationAdjusted.quality;
  const direction = locationAdjusted.direction;
  const confirmed = locationAdjusted.confirmed;

  const earlySignal =
    [
      "WICK_BELOW_AND_RECLAIM",
      "DIP_BOUGHT_FAST",
      "SELLERS_TRAPPED",
      "RECLAIMED_LEVEL",
      "FAILED_RECLAIM",
      "REJECTING_VALUE",
      "BREAKOUT_FAILING",
      "LOST_LEVEL",
      "HELD_LEVEL",
      "ACCEPTING_VALUE",
      "BREAKOUT_HOLDING",
      "FAILED_ACCEPTANCE_SHORT",
      "LOST_SHORT_TRIGGER_LEVEL",
      "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",
      "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",
    ].includes(state);

  return {
    active: true,
    engine: ENGINE,
    source: SOURCE,

    mode: "FAST_IMBALANCE_WATCH",
    fastMode: true,
    paperOnly: true,
    researchOnly: true,

    symbol,
    tf,

    candleClosed:
      candleCompletionTruth.latestBarCompletionState === "COMPLETED"
        ? true
        : candleCompletionTruth.latestBarCompletionState === "FORMING"
        ? false
        : null,
    candleCompletionState: candleCompletionTruth.latestBarCompletionState,
    evaluationTimeMs: candleCompletionTruth.evaluationTimeMs,
    supportingBarTime: last?.time ?? null,
    supportingExpectedCloseTimeMs:
      candleCompletionTruth.latestExpectedCloseTimeMs,
    earlySignal,

    state,
    rawState,
    quality,
    rawQuality,
    direction,
    rawDirection,
    confirmed,
    rawConfirmed,

    candleDirectionRaw,
    previousCanonicalDirection:
      previousDirection,
    tenMinuteCompletedClose:
      completedClose,
    tenMinuteEma10:
      ema10,
    ema10PersistenceState,

    waveContext: buildWaveContext({
      engine22WaveStrategy,
      state,
      direction,
    }),

    engine26LocationContext: locationAdjusted.engine26LocationContext,

    currentPrice: price,

    imbalance: {
      id: activeImbalance.id,
      source: activeImbalance.source,
      side: activeImbalance.side,
      zoneType: activeImbalance.zoneType,
      lo: activeImbalance.lo,
      hi: activeImbalance.hi,
      mid: activeImbalance.mid,
      negZone: activeImbalance.negZone || null,
      distancePts: activeImbalance.distancePts,
      inside: activeImbalance.inside,
      near: activeImbalance.near,
      raw: activeImbalance.raw,
      comment: activeImbalance.comment || null,
    },

    levelAction: {
      ...DEFAULT_LEVEL_ACTION,
      ...(evaluation.flags || {}),
    },

    requiresEngine6PaperApproval: true,
    noPermissionCreated: true,
    noExecution: true,

    lastCandle: last,
    priorCandle: prev,

    reasonCodes: uniqueReasonCodes([
      "ENGINE26_FAST_IMBALANCE_WATCH",
      "ENGINE3_FAST_IMBALANCE_REACTION",
      "MANUAL_IMBALANCE_ZONE_ACTIVE",
      ...(manualZonesRead.reasonCodes || []),
      ...(evaluation.reasonCodes || []),
      ...(locationAdjusted.engine26LocationContext?.reasonCodes || []),
      earlySignal ? "EARLY_FAST_IMBALANCE_SIGNAL" : null,
      ema10PersistenceState,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
      "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
    ]),
  };
}

export function attachFastImbalanceReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy = null,
  bars10m = [],
  engine26FastWatch = null,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  previousCanonicalDirection = "NEUTRAL",
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  evaluationTimeMs = null,
}) {
  const currentPrice =
    engine22WaveStrategy?.currentLifecycleState?.confirmationContext?.reference?.currentPrice ??
    engine22WaveStrategy?.currentLifecycleState?.currentPrice ??
    null;

  const fastImbalanceReaction = buildFastImbalanceReaction({
    symbol: engine22WaveStrategy?.symbol || "ES",
    tf: engine22WaveStrategy?.tf || "10m",
    bars10m,
    currentPrice,
    engine26FastWatch,
    confluence: patchedConfluence,
    engine22WaveStrategy,
    engine26ReactionHandoff,
    engine26StructuralContext,
    previousCanonicalDirection,
    tenMinuteCompletedClose,
    tenMinuteEma10,
    evaluationTimeMs,
  });

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    engine3FastImbalanceReaction: fastImbalanceReaction,
  };

  return patchedConfluence;
}

export default buildFastImbalanceReaction;
render@srv-d2ds5nodl3ps73b7i2og-59478b5978-7ldfs:~/project/src
