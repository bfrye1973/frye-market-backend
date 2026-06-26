// services/core/logic/priceAction/currentLevelAction.js
//
// Shared current candle / level action reader.
//
// Contract:
// - Reads raw candle / level behavior only.
// - Does not create permission.
// - Does not create execution.
// - Does not create readiness.
// - Does not create freshEntryNow.
// - Engine 22 may consume this later for livePriceAction / alertLevel / watchIntensity only.
//
// Output path after attach:
// confluence.context.reaction.currentLevelAction

const ENGINE = "engine3.currentLevelAction.v1";
const SOURCE = "priceAction.currentLevelAction";

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

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
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

function normalizeBars(bars = []) {
  return Array.isArray(bars) ? bars.map(normalizeBar) : [];
}

function normalizeZone(zone) {
  if (!zone || typeof zone !== "object") return null;

  const lo = toNum(zone.lo ?? zone.low ?? zone.from);
  const hi = toNum(zone.hi ?? zone.high ?? zone.to);

  if (lo == null || hi == null) return null;

  return {
    ...zone,
    lo: Math.min(lo, hi),
    hi: Math.max(lo, hi),
    mid:
      toNum(zone.mid) ??
      round2((Math.min(lo, hi) + Math.max(lo, hi)) / 2),
  };
}

function containsPrice(zone, price) {
  const z = normalizeZone(zone);
  const p = toNum(price);

  if (!z || p == null) return false;
  return p >= z.lo && p <= z.hi;
}

function distanceToZone(zone, price) {
  const z = normalizeZone(zone);
  const p = toNum(price);

  if (!z || p == null) return null;

  if (p >= z.lo && p <= z.hi) return 0;
  return p < z.lo ? round2(z.lo - p) : round2(p - z.hi);
}

function calcEma(values = [], period = 10) {
  const nums = values
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

  if (nums.length < period) return null;

  const k = 2 / (period + 1);

  let ema =
    nums.slice(0, period).reduce((sum, x) => sum + x, 0) / period;

  for (let i = period; i < nums.length; i += 1) {
    ema = nums[i] * k + ema * (1 - k);
  }

  return round2(ema);
}

function buildLocalRange(bars = [], lookback = 6) {
  const recent = bars.slice(-lookback);

  const highs = recent
    .map((bar) => bar.high)
    .filter((x) => Number.isFinite(x));

  const lows = recent
    .map((bar) => bar.low)
    .filter((x) => Number.isFinite(x));

  if (!highs.length || !lows.length) {
    return {
      localRangeHigh: null,
      localRangeLow: null,
    };
  }

  return {
    localRangeHigh: round2(Math.max(...highs)),
    localRangeLow: round2(Math.min(...lows)),
  };
}

function pickPriceProgressReference(reference = {}) {
  const progress = reference?.priceProgress || {};

  const candidates = [
    progress?.micro?.currentRetraceZone,
    progress?.minute?.currentRetraceZone,
    progress?.minor?.currentRetraceZone,
    progress?.intermediate?.currentRetraceZone,
  ].filter(Boolean);

  const scored = candidates
    .map((item) => ({
      ...item,
      price: toNum(item.price),
      absDistancePts: toNum(item.absDistancePts),
    }))
    .filter((item) => item.price != null)
    .sort((a, b) => {
      const da = a.absDistancePts ?? 999999;
      const db = b.absDistancePts ?? 999999;
      return da - db;
    });

  return scored[0] || null;
}

function getEngine25NearestZone(engine25Context) {
  return (
    normalizeZone(engine25Context?.zoneAwareRead?.nearestZone) ||
    normalizeZone(engine25Context?.nearestZone) ||
    normalizeZone(engine25Context?.esPermission?.nearestZone) ||
    normalizeZone(engine25Context?.zoneAwareRead?.context?.nearestZone) ||
    null
  );
}

function getEngine25ZoneState(engine25Context) {
  return (
    engine25Context?.zoneAwareRead?.zoneState ||
    engine25Context?.zoneState ||
    engine25Context?.esPermission?.zoneState ||
    null
  );
}

function getEngine1Zones(engine1Context) {
  const active = engine1Context?.active || {};
  const nearest = engine1Context?.nearest || {};
  const render = engine1Context?.render || {};

  const negotiated =
    normalizeZone(active.negotiated) ||
    normalizeZone(nearest.negotiated) ||
    null;

  const institutional =
    normalizeZone(active.institutional) ||
    normalizeZone(nearest.institutional) ||
    null;

  const shelf =
    normalizeZone(active.shelf) ||
    normalizeZone(nearest.shelf) ||
    null;

  const renderedNegotiated = Array.isArray(render.negotiated)
    ? render.negotiated.map(normalizeZone).filter(Boolean)
    : [];

  const renderedInstitutional = Array.isArray(render.institutional)
    ? render.institutional.map(normalizeZone).filter(Boolean)
    : [];

  const renderedShelves = Array.isArray(render.shelves)
    ? render.shelves.map(normalizeZone).filter(Boolean)
    : [];

  return {
    negotiated,
    institutional,
    shelf,
    renderedNegotiated,
    renderedInstitutional,
    renderedShelves,
  };
}

function getReferenceZones({ zones, confirmationReference, engine25Context, engine1Context }) {
  const engine1Zones = getEngine1Zones(engine1Context);

  const fromConfirmation =
    normalizeZone(confirmationReference?.pullbackZone) ||
    normalizeZone(confirmationReference?.zone) ||
    normalizeZone(confirmationReference?.zones?.pullbackZone) ||
    normalizeZone(confirmationReference?.zones?.zone) ||
    normalizeZone(zones?.pullbackZone) ||
    normalizeZone(zones?.zone) ||
    null;

  return {
    confirmationZone: fromConfirmation,
    engine25NearestZone: getEngine25NearestZone(engine25Context),
    negotiatedZone: engine1Zones.negotiated,
    institutionalZone: engine1Zones.institutional,
    shelfZone: engine1Zones.shelf,
    renderedNegotiated: engine1Zones.renderedNegotiated,
    renderedInstitutional: engine1Zones.renderedInstitutional,
    renderedShelves: engine1Zones.renderedShelves,
    engine25ZoneState: getEngine25ZoneState(engine25Context),
  };
}

function addReferenceCandidate(candidates, candidate) {
  if (!candidate) return;

  const level = toNum(candidate.level);
  const zone = normalizeZone(candidate.zone);

  if (level == null && !zone) return;

  candidates.push({
    type: candidate.type || "LEVEL",
    label: candidate.label || candidate.type || "Reference",
    level,
    zone,
    priority: Number(candidate.priority ?? 50),
  });
}

function collectReferenceCandidates({
  referenceLevels = null,
  confirmationReference = {},
  referenceZones,
  priorCandleHigh,
  priorCandleLow,
  localRangeHigh,
  localRangeLow,
  ema10,
  ema20,
}) {
  const candidates = [];

  const progressRef = pickPriceProgressReference(confirmationReference);

  addReferenceCandidate(candidates, {
    type: "RECLAIM_LEVEL",
    label: "Reclaim Level",
    level: confirmationReference?.reclaimLevel,
    priority: 5,
  });

  addReferenceCandidate(candidates, {
    type: "TRIGGER_LEVEL",
    label: "Trigger Level",
    level: confirmationReference?.triggerLevel,
    priority: 6,
  });

  addReferenceCandidate(candidates, {
    type: "WAVE_W2_LEVEL",
    label: "Wave W2 Level",
    level: confirmationReference?.waveW2Level,
    priority: 7,
  });

  addReferenceCandidate(candidates, {
    type: "WAVE_C_LOW",
    label: "Wave C Low",
    level: confirmationReference?.waveCLow,
    priority: 8,
  });

  addReferenceCandidate(candidates, {
    type: "INVALIDATION_LEVEL",
    label: "Invalidation Level",
    level: confirmationReference?.invalidationLevel,
    priority: 9,
  });

  addReferenceCandidate(candidates, {
    type: "PRICE_PROGRESS_LEVEL",
    label: progressRef?.label
      ? `Price Progress ${progressRef.label}`
      : "Price Progress Level",
    level: progressRef?.price,
    priority: 15,
  });

  if (referenceLevels && typeof referenceLevels === "object") {
    for (const [key, value] of Object.entries(referenceLevels)) {
      addReferenceCandidate(candidates, {
        type: `REFERENCE_${safeUpper(key)}`,
        label: String(key).replaceAll("_", " "),
        level: value,
        priority: 20,
      });
    }
  }

  addReferenceCandidate(candidates, {
    type: "CONFIRMATION_ZONE",
    label: "Engine 22 Reference Zone",
    zone: referenceZones.confirmationZone,
    priority: 10,
  });

  addReferenceCandidate(candidates, {
    type: "ENGINE25_ZONE",
    label: "Engine 25 Nearest Zone",
    zone: referenceZones.engine25NearestZone,
    priority: 25,
  });

  addReferenceCandidate(candidates, {
    type: "NEGOTIATED_ZONE",
    label: "Negotiated Zone",
    zone: referenceZones.negotiatedZone,
    priority: 30,
  });

  addReferenceCandidate(candidates, {
    type: "INSTITUTIONAL_ZONE",
    label: "Institutional Zone",
    zone: referenceZones.institutionalZone,
    priority: 35,
  });

  addReferenceCandidate(candidates, {
    type: "SHELF_ZONE",
    label: "SMZ Shelf",
    zone: referenceZones.shelfZone,
    priority: 40,
  });

  addReferenceCandidate(candidates, {
    type: "PRIOR_CANDLE_HIGH",
    label: "Prior Candle High",
    level: priorCandleHigh,
    priority: 60,
  });

  addReferenceCandidate(candidates, {
    type: "PRIOR_CANDLE_LOW",
    label: "Prior Candle Low",
    level: priorCandleLow,
    priority: 61,
  });

  addReferenceCandidate(candidates, {
    type: "LOCAL_RANGE_HIGH",
    label: "Local Range High",
    level: localRangeHigh,
    priority: 65,
  });

  addReferenceCandidate(candidates, {
    type: "LOCAL_RANGE_LOW",
    label: "Local Range Low",
    level: localRangeLow,
    priority: 66,
  });

  addReferenceCandidate(candidates, {
    type: "EMA10",
    label: "EMA10",
    level: confirmationReference?.ema10 ?? confirmationReference?.emaContext?.ema10 ?? ema10,
    priority: 70,
  });

  addReferenceCandidate(candidates, {
    type: "EMA20",
    label: "EMA20",
    level: confirmationReference?.ema20 ?? confirmationReference?.emaContext?.ema20 ?? ema20,
    priority: 71,
  });

  return candidates;
}

function candidateDistance(candidate, price) {
  const p = toNum(price);
  if (p == null) return 999999;

  if (candidate.zone) {
    const d = distanceToZone(candidate.zone, p);
    return d == null ? 999999 : Math.abs(d);
  }

  if (candidate.level != null) {
    return Math.abs(p - candidate.level);
  }

  return 999999;
}

function pickBestReference(candidates = [], price) {
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => {
    const da = candidateDistance(a, price);
    const db = candidateDistance(b, price);

    if (da !== db) return da - db;
    return Number(a.priority ?? 99) - Number(b.priority ?? 99);
  })[0];
}

function buildReferencesObject({
  referenceZones,
  selectedReference,
  priorCandleHigh,
  priorCandleLow,
  localRangeHigh,
  localRangeLow,
  ema10,
  ema20,
}) {
  return {
    engine25NearestZone: referenceZones.engine25NearestZone,
    engine25ZoneState: referenceZones.engine25ZoneState,
    negotiatedZone: referenceZones.negotiatedZone,
    institutionalZone: referenceZones.institutionalZone,
    shelfZone: referenceZones.shelfZone,
    waveLevel:
      selectedReference?.type?.startsWith("WAVE") ||
      selectedReference?.type === "PRICE_PROGRESS_LEVEL"
        ? selectedReference?.level ?? null
        : null,
    priorCandleHigh,
    priorCandleLow,
    localRangeHigh,
    localRangeLow,
    ema10,
    ema20,
  };
}

function makeInactiveResult({
  symbol,
  tf,
  state,
  reasonCodes = [],
  currentPrice = null,
  lastCandle = null,
  priorCandle = null,
  references = {},
}) {
  return {
    active: false,
    engine: ENGINE,
    source: SOURCE,

    symbol: symbol || null,
    tf: tf || "10m",

    state,
    quality: "WEAK",
    direction: "NEUTRAL",
    confirmed: false,

    currentPrice,
    referenceLevel: null,
    referenceType: null,
    referenceLabel: null,
    distancePts: null,

    levelAction: { ...DEFAULT_LEVEL_ACTION },

    references,

    lastCandle,
    priorCandle,

    noPermissionCreated: true,
    noExecution: true,

    reasonCodes: uniqueReasonCodes([
      ...reasonCodes,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ]),
  };
}

function classifyQuality(state) {
  if (
    [
      "WICK_BELOW_AND_RECLAIM",
      "SELLERS_TRAPPED",
      "DIP_BOUGHT_FAST",
      "BREAKOUT_HOLDING",
      "RECLAIMED_LEVEL",
    ].includes(state)
  ) {
    return "STRONG";
  }

  if (
    [
      "HELD_LEVEL",
      "ACCEPTING_VALUE",
    ].includes(state)
  ) {
    return "GOOD";
  }

  if (
    [
      "CHOP_INSIDE_VALUE",
      "REJECTING_VALUE",
      "BREAKOUT_FAILING",
      "FAILED_RECLAIM",
    ].includes(state)
  ) {
    return "MIXED";
  }

  return "WEAK";
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

function evaluateZoneAction({ zone, last, prev, price }) {
  const z = normalizeZone(zone);

  if (!z || price == null) {
    return {
      state: "NO_REFERENCE_LEVEL",
      flags: { ...DEFAULT_LEVEL_ACTION },
      reasonCodes: ["ZONE_REFERENCE_MISSING"],
    };
  }

  const flags = { ...DEFAULT_LEVEL_ACTION };
  const reasonCodes = [];

  const lastInside = containsPrice(z, last.close);
  const prevInside = containsPrice(z, prev.close);

  const lastAbove = last.close != null && last.close > z.hi;
  const lastBelow = last.close != null && last.close < z.lo;
  const prevAbove = prev.close != null && prev.close > z.hi;
  const prevBelow = prev.close != null && prev.close < z.lo;

  const sweptBelowAndReclaimed =
    last.low != null &&
    last.close != null &&
    last.low < z.lo &&
    last.close >= z.lo;

  const rejectedAbove =
    last.high != null &&
    last.close != null &&
    last.high > z.hi &&
    last.close <= z.hi;

  const reclaimedZone =
    (prevBelow || prevInside) &&
    lastAbove;

  const lostZone =
    (prevInside || prevAbove) &&
    lastBelow;

  if (sweptBelowAndReclaimed) {
    flags.wickBelowAndReclaim = true;
    flags.dipBoughtFast = last.close > last.open;
    reasonCodes.push("WICK_BELOW_ZONE_AND_RECLAIMED");
    if (flags.dipBoughtFast) reasonCodes.push("DIP_BOUGHT_FAST");
    return {
      state: flags.dipBoughtFast ? "DIP_BOUGHT_FAST" : "WICK_BELOW_AND_RECLAIM",
      flags,
      reasonCodes,
    };
  }

  if (rejectedAbove) {
    flags.rejectingValue = true;
    flags.failedReclaim = true;
    reasonCodes.push("REJECTING_VALUE_ABOVE_ZONE");
    return {
      state: "REJECTING_VALUE",
      flags,
      reasonCodes,
    };
  }

  if (reclaimedZone) {
    flags.reclaimedLevel = true;
    flags.acceptingValue = true;
    flags.breakoutHolding = true;
    reasonCodes.push("ZONE_RECLAIMED_AND_ACCEPTING_ABOVE_VALUE");
    return {
      state: "ACCEPTING_VALUE",
      flags,
      reasonCodes,
    };
  }

  if (lostZone) {
    flags.lostLevel = true;
    flags.rejectingValue = true;
    reasonCodes.push("ZONE_LOST");
    return {
      state: "LOST_LEVEL",
      flags,
      reasonCodes,
    };
  }

  if (lastAbove && !rejectedAbove) {
    flags.acceptingValue = true;
    flags.breakoutHolding = true;
    reasonCodes.push("ACCEPTING_ABOVE_VALUE");
    return {
      state: "BREAKOUT_HOLDING",
      flags,
      reasonCodes,
    };
  }

  if (lastInside) {
    flags.chopInsideValue = true;
    reasonCodes.push("CHOP_INSIDE_VALUE");
    return {
      state: "CHOP_INSIDE_VALUE",
      flags,
      reasonCodes,
    };
  }

  if (lastBelow) {
    flags.rejectingValue = true;
    reasonCodes.push("BELOW_VALUE_WAITING_FOR_RECLAIM");
    return {
      state: "REJECTING_VALUE",
      flags,
      reasonCodes,
    };
  }

  return {
    state: "NO_SIGNAL",
    flags,
    reasonCodes: ["NO_CLEAR_ZONE_ACTION"],
  };
}

function evaluateLevelAction({ level, last, prev }) {
  const ref = toNum(level);

  if (ref == null) {
    return {
      state: "NO_REFERENCE_LEVEL",
      flags: { ...DEFAULT_LEVEL_ACTION },
      reasonCodes: ["LEVEL_REFERENCE_MISSING"],
    };
  }

  const flags = { ...DEFAULT_LEVEL_ACTION };
  const reasonCodes = [];

  const closeAbove = last.close != null && last.close > ref;
  const closeBelow = last.close != null && last.close < ref;
  const prevCloseAbove = prev.close != null && prev.close > ref;
  const prevCloseBelow = prev.close != null && prev.close < ref;

  const touched =
    last.low != null &&
    last.high != null &&
    last.low <= ref &&
    last.high >= ref;

  const wickBelowAndReclaim =
    last.low != null &&
    last.close != null &&
    last.low < ref &&
    last.close >= ref;

  const reclaimed =
    prevCloseBelow &&
    closeAbove;

  const lost =
    prevCloseAbove &&
    closeBelow;

  const failedReclaim =
    last.high != null &&
    last.close != null &&
    last.high >= ref &&
    last.close < ref;

  const heldLevel =
    touched &&
    last.close != null &&
    last.close >= ref;

  const breakoutHolding =
    closeAbove &&
    prev.high != null &&
    last.close > prev.high;

  const breakoutFailing =
    last.high != null &&
    prev.high != null &&
    last.high > prev.high &&
    last.close <= prev.high;

  const sweptPriorLow =
    prev.low != null &&
    last.low != null &&
    last.low < prev.low;

  const dipBoughtFast =
    sweptPriorLow &&
    last.open != null &&
    last.close != null &&
    last.close > last.open &&
    last.close > prev.close;

  const sellersTrapped =
    sweptPriorLow &&
    prev.high != null &&
    last.close != null &&
    last.close > prev.high;

  if (sellersTrapped) {
    flags.sellersTrapped = true;
    flags.dipBoughtFast = true;
    flags.wickBelowAndReclaim = wickBelowAndReclaim;
    reasonCodes.push("SELLERS_TRAPPED_BELOW_PRIOR_LOW");
    return {
      state: "SELLERS_TRAPPED",
      flags,
      reasonCodes,
    };
  }

  if (dipBoughtFast) {
    flags.dipBoughtFast = true;
    flags.wickBelowAndReclaim = wickBelowAndReclaim;
    reasonCodes.push("DIP_BOUGHT_FAST_AFTER_PRIOR_LOW_SWEEP");
    return {
      state: "DIP_BOUGHT_FAST",
      flags,
      reasonCodes,
    };
  }

  if (wickBelowAndReclaim) {
    flags.wickBelowAndReclaim = true;
    flags.reclaimedLevel = true;
    reasonCodes.push("WICK_BELOW_LEVEL_AND_RECLAIMED");
    return {
      state: "WICK_BELOW_AND_RECLAIM",
      flags,
      reasonCodes,
    };
  }

  if (breakoutHolding) {
    flags.breakoutHolding = true;
    flags.reclaimedLevel = reclaimed;
    reasonCodes.push("BREAKOUT_HOLDING_ABOVE_PRIOR_HIGH");
    return {
      state: "BREAKOUT_HOLDING",
      flags,
      reasonCodes,
    };
  }

  if (breakoutFailing) {
    flags.breakoutFailing = true;
    flags.failedReclaim = true;
    reasonCodes.push("BREAKOUT_FAILING_BACK_BELOW_PRIOR_HIGH");
    return {
      state: "BREAKOUT_FAILING",
      flags,
      reasonCodes,
    };
  }

  if (reclaimed) {
    flags.reclaimedLevel = true;
    reasonCodes.push("LEVEL_RECLAIMED");
    return {
      state: "RECLAIMED_LEVEL",
      flags,
      reasonCodes,
    };
  }

  if (lost) {
    flags.lostLevel = true;
    reasonCodes.push("LEVEL_LOST");
    return {
      state: "LOST_LEVEL",
      flags,
      reasonCodes,
    };
  }

  if (failedReclaim) {
    flags.failedReclaim = true;
    reasonCodes.push("FAILED_RECLAIM");
    return {
      state: "FAILED_RECLAIM",
      flags,
      reasonCodes,
    };
  }

  if (heldLevel) {
    flags.heldLevel = true;
    reasonCodes.push("LEVEL_HELD");
    return {
      state: "HELD_LEVEL",
      flags,
      reasonCodes,
    };
  }

  if (closeAbove) {
    reasonCodes.push("ABOVE_REFERENCE_LEVEL");
    return {
      state: "NO_SIGNAL",
      flags,
      reasonCodes,
    };
  }

  if (closeBelow) {
    reasonCodes.push("BELOW_REFERENCE_LEVEL");
    return {
      state: "NO_SIGNAL",
      flags,
      reasonCodes,
    };
  }

  return {
    state: "NO_SIGNAL",
    flags,
    reasonCodes: ["NO_CLEAR_LEVEL_ACTION"],
  };
}

export function buildCurrentLevelAction({
  symbol,
  tf = "10m",
  bars10m = [],
  bars30m = [],
  currentPrice = null,
  referenceLevels = null,
  zones = null,
  engine25Context = null,
  engine1Context = null,
  confirmationContext = null,
} = {}) {
  const normalized10m = normalizeBars(bars10m);
  const normalized30m = normalizeBars(bars30m);

  const last = normalized10m[normalized10m.length - 1] || null;
  const prev = normalized10m[normalized10m.length - 2] || null;

  const price =
    toNum(currentPrice) ??
    toNum(confirmationContext?.reference?.currentPrice) ??
    last?.close ??
    null;

  const closes = normalized10m
    .map((bar) => bar.close)
    .filter((x) => Number.isFinite(x));

  const ema10 =
    toNum(confirmationContext?.reference?.ema10) ??
    toNum(confirmationContext?.reference?.emaContext?.ema10) ??
    calcEma(closes, 10);

  const ema20 =
    toNum(confirmationContext?.reference?.ema20) ??
    toNum(confirmationContext?.reference?.emaContext?.ema20) ??
    calcEma(closes, 20);

  const localRange = buildLocalRange(normalized10m, 6);

  const priorCandleHigh = prev?.high ?? null;
  const priorCandleLow = prev?.low ?? null;

  const confirmationReference = confirmationContext?.reference || {};

  const referenceZones = getReferenceZones({
    zones,
    confirmationReference,
    engine25Context,
    engine1Context,
  });

  const references = buildReferencesObject({
    referenceZones,
    selectedReference: null,
    priorCandleHigh,
    priorCandleLow,
    localRangeHigh:
      toNum(confirmationReference.localRangeHigh) ??
      localRange.localRangeHigh,
    localRangeLow:
      toNum(confirmationReference.localRangeLow) ??
      localRange.localRangeLow,
    ema10,
    ema20,
  });

  if (!last || !prev) {
    return makeInactiveResult({
      symbol,
      tf,
      state: "INSUFFICIENT_CANDLES",
      currentPrice: price,
      lastCandle: last,
      priorCandle: prev,
      references,
      reasonCodes: ["INSUFFICIENT_CANDLES"],
    });
  }

  const candidates = collectReferenceCandidates({
    referenceLevels,
    confirmationReference,
    referenceZones,
    priorCandleHigh,
    priorCandleLow,
    localRangeHigh: references.localRangeHigh,
    localRangeLow: references.localRangeLow,
    ema10,
    ema20,
  });

  const selectedReference = pickBestReference(candidates, price);

  const finalReferences = buildReferencesObject({
    referenceZones,
    selectedReference,
    priorCandleHigh,
    priorCandleLow,
    localRangeHigh: references.localRangeHigh,
    localRangeLow: references.localRangeLow,
    ema10,
    ema20,
  });

  if (!selectedReference) {
    return makeInactiveResult({
      symbol,
      tf,
      state: "NO_REFERENCE_LEVEL",
      currentPrice: price,
      lastCandle: last,
      priorCandle: prev,
      references: finalReferences,
      reasonCodes: ["NO_REFERENCE_LEVEL"],
    });
  }

  const evaluation = selectedReference.zone
    ? evaluateZoneAction({
        zone: selectedReference.zone,
        last,
        prev,
        price,
      })
    : evaluateLevelAction({
        level: selectedReference.level,
        last,
        prev,
      });

  const state = evaluation.state || "NO_SIGNAL";
  const quality = classifyQuality(state);
  const direction = classifyDirection(state);
  const confirmed = classifyConfirmed(state);

  const referenceLevel =
    selectedReference.level ??
    selectedReference.zone?.mid ??
    null;

  const distancePts =
    price != null && referenceLevel != null
      ? round2(price - referenceLevel)
      : selectedReference.zone
      ? distanceToZone(selectedReference.zone, price)
      : null;

  return {
    active: true,
    engine: ENGINE,
    source: SOURCE,

    symbol: symbol || null,
    tf,

    state,
    quality,
    direction,
    confirmed,

    currentPrice: price,
    referenceLevel,
    referenceType: selectedReference.type || null,
    referenceLabel: selectedReference.label || null,
    distancePts,

    levelAction: {
      ...DEFAULT_LEVEL_ACTION,
      ...(evaluation.flags || {}),
    },

    references: finalReferences,

    lastCandle: last,
    priorCandle: prev,
    bars30m: normalized30m.slice(-3),

    noPermissionCreated: true,
    noExecution: true,

    reasonCodes: uniqueReasonCodes([
      "CURRENT_LEVEL_ACTION_BUILT",
      selectedReference.type ? `REFERENCE_${selectedReference.type}` : null,
      ...(evaluation.reasonCodes || []),
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ]),
  };
}

export function attachCurrentLevelActionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  engine25Context = null,
  engine1Context = null,
  bars10m = [],
  bars30m = [],
}) {
  const currentLifecycleState =
    engine22WaveStrategy?.currentLifecycleState || null;

  const confirmationContext =
    currentLifecycleState?.confirmationContext || null;

  const currentLevelAction = buildCurrentLevelAction({
    symbol: engine22WaveStrategy?.symbol || null,
    tf: engine22WaveStrategy?.tf || "10m",
    bars10m,
    bars30m,
    currentPrice:
      confirmationContext?.reference?.currentPrice ??
      currentLifecycleState?.currentPrice ??
      null,
    confirmationContext,
    engine25Context,
    engine1Context,
    zones:
      confirmationContext?.reference?.zones ??
      null,
  });

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    currentLevelAction,
  };

  return patchedConfluence;
}

export default buildCurrentLevelAction;
