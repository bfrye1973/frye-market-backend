// services/core/logic/engine3/fastImbalanceReaction.js
//
// Engine 3 fast imbalance reaction reader.
//
// Purpose:
// - Fast PAPER_ONLY / RESEARCH_ONLY candle + imbalance reaction read.
// - Designed for Engine 26 FAST_IMBALANCE_WATCH.
// - Reads manual ES imbalance zones from data/es-smz-manual-zones.txt.
// - Reads latest 10m candle behavior around the active imbalance.
// - Does NOT create permission.
// - Does NOT create execution.
// - Does NOT set READY, freshEntryNow, executable, or broker actions.
//
// Output path after attach:
// confluence.context.reaction.engine3FastImbalanceReaction

import fs from "fs";

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
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);

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
      const negMatch = String(rightPartRaw || "").match(/NEG\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i);
      const negZone = negMatch ? normalizeZone(negMatch[1], negMatch[2]) : null;

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

  if (["HELD_LEVEL", "ACCEPTING_VALUE"].includes(state)) {
    return "GOOD";
  }

  if (
    [
      "FAILED_RECLAIM",
      "REJECTING_VALUE",
      "LOST_LEVEL",
      "BREAKOUT_FAILING",
      "CHOP_INSIDE_VALUE",
    ].includes(state)
  ) {
    return "MIXED";
  }

  return "WEAK";
}

function classifyDirection(state) {
  if (
    [
      "WICK_BELOW_AND_RECLAIM",
      "DIP_BOUGHT_FAST",
      "SELLERS_TRAPPED",
      "RECLAIMED_LEVEL",
      "HELD_LEVEL",
      "ACCEPTING_VALUE",
      "BREAKOUT_HOLDING",
    ].includes(state)
  ) {
    return "LONG";
  }

  if (
    [
      "FAILED_RECLAIM",
      "REJECTING_VALUE",
      "LOST_LEVEL",
      "BREAKOUT_FAILING",
    ].includes(state)
  ) {
    return "SHORT";
  }

  return "NEUTRAL";
}

function classifyConfirmed(state) {
  return [
    "WICK_BELOW_AND_RECLAIM",
    "DIP_BOUGHT_FAST",
    "SELLERS_TRAPPED",
    "RECLAIMED_LEVEL",
    "HELD_LEVEL",
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

  const price = toNum(currentPrice) ?? last.close ?? null;

  const lastInside = isInsideZone(zone, last.close);
  const prevInside = isInsideZone(zone, prev.close);

  const lastAbove = last.close != null && last.close > zone.hi;
  const lastBelow = last.close != null && last.close < zone.lo;
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

function makeInactiveResult({
  symbol,
  tf,
  currentPrice,
  state,
  reasonCodes = [],
  imbalance = null,
  lastCandle = null,
  priorCandle = null,
}) {
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

    candleClosed: false,
    earlySignal: false,

    state,
    quality: "WEAK",
    direction: "NEUTRAL",
    confirmed: false,

    currentPrice: currentPrice ?? null,
    imbalance,

    levelAction: { ...DEFAULT_LEVEL_ACTION },

    requiresEngine6PaperApproval: true,
    noPermissionCreated: true,
    noExecution: true,

    lastCandle,
    priorCandle,

    reasonCodes: uniqueReasonCodes([
      ...reasonCodes,
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
} = {}) {
  const bars = Array.isArray(bars10m) ? bars10m.map(normalizeBar) : [];
  const last = bars[bars.length - 1] || null;
  const prev = bars[bars.length - 2] || null;

  const price =
    toNum(currentPrice) ??
    toNum(engine26FastWatch?.currentPrice) ??
    last?.close ??
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

  const state = evaluation.state || "NO_SIGNAL";
  const quality = classifyQuality(state);
  const direction = classifyDirection(state);
  const confirmed = classifyConfirmed(state);

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

    candleClosed: false,
    earlySignal,

    state,
    quality,
    direction,
    confirmed,

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
      earlySignal ? "EARLY_FAST_IMBALANCE_SIGNAL" : null,
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
  });

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    engine3FastImbalanceReaction: fastImbalanceReaction,
  };

  return patchedConfluence;
}

export default buildFastImbalanceReaction;
