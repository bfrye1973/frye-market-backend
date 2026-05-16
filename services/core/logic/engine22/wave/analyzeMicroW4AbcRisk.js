// services/core/logic/engine22/wave/analyzeMicroW4AbcRisk.js
// Engine 22G — Micro W4 ABC Risk Analyzer
//
// Purpose:
// Read-only Micro W4 risk intelligence.
// Determines whether Micro W4 is healthy, deep, damaged, likely topped, or invalidated.
// Does not create trades.
// Does not change allowLongEntry / status / readiness.

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

function getMarkPrice(block, key) {
  const p = toNum(block?.waveMarks?.[key]?.p);
  return p !== null && p > 0 ? p : null;
}

function boolFromComparison(a, b, op) {
  const x = toNum(a);
  const y = toNum(b);

  if (x === null || y === null) return null;

  if (op === "<") return x < y;
  if (op === "<=") return x <= y;
  if (op === ">") return x > y;
  if (op === ">=") return x >= y;

  return null;
}

function buildRetracementLevels({ wave2Low, wave3High }) {
  const w2 = toNum(wave2Low);
  const w3 = toNum(wave3High);

  if (w2 === null || w3 === null || w3 <= w2) {
    return {
      ok: false,
      range: null,
      levels: null,
      reason: "INVALID_MICRO_W2_W3_RANGE",
    };
  }

  const range = w3 - w2;

  return {
    ok: true,
    range: round2(range),
    levels: {
      r236: round2(w3 - range * 0.236),
      r382: round2(w3 - range * 0.382),
      r500: round2(w3 - range * 0.5),
      r618: round2(w3 - range * 0.618),
      r786: round2(w3 - range * 0.786),
    },
    reason: "MICRO_W2_W3_RANGE_VALID",
  };
}

function getConfirmationFilters({ regimeLayers, reactionContext, volumeContext }) {
  const tenMinute = regimeLayers?.tenMinute || null;
  const oneHour = regimeLayers?.oneHour || null;

  const tenMinuteBelowEma20 = boolFromComparison(
    tenMinute?.close,
    tenMinute?.ema20,
    "<"
  );

  const oneHourBelowEma10 = boolFromComparison(
    oneHour?.close,
    oneHour?.ema10,
    "<"
  );

  const reactionUpper = upper(
    reactionContext?.structureState ||
      reactionContext?.state ||
      reactionContext?.reactionState
  );

  const reactionDirection = upper(
    reactionContext?.direction ||
      reactionContext?.breakoutIgnition?.direction
  );

  const engine3SellerControl =
    reactionContext?.sellerControl === true ||
    reactionContext?.sellerAbsorption === false ||
    reactionContext?.buyerAbsorption === true ||
    reactionContext?.distributionWarning === true ||
    reactionContext?.failedContinuation === true ||
    reactionUpper === "FAILURE" ||
    reactionUpper === "SELLER_CONTROL" ||
    reactionDirection === "SHORT";

  const participation = volumeContext?.breakoutParticipation || null;

  const participationDirection = upper(
    participation?.direction ||
      volumeContext?.direction
  );

  const engine4BearishParticipation =
    participationDirection === "SHORT" &&
    (
      participation?.active === true ||
      participation?.confirmed === true ||
      volumeContext?.confirmed === true
    );

  return {
    tenMinuteBelowEma20,
    oneHourBelowEma10,
    engine3SellerControl,
    engine4BearishParticipation,
  };
}

function classifyMicroW4({
  currentPrice,
  wave1High,
  wave2Low,
  wave3High,
  levels,
  confirmationFilters,
}) {
  const price = toNum(currentPrice);
  const w1 = toNum(wave1High);
  const w2 = toNum(wave2Low);
  const w3 = toNum(wave3High);

  if (price === null) {
    return {
      state: "MICRO_W4_UNKNOWN",
      currentZone: "MISSING_CURRENT_PRICE",
      microW5StillPossible: false,
      cleanMicroW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      needs: ["VALID_CURRENT_PRICE"],
      reasonCodes: ["MISSING_CURRENT_PRICE"],
    };
  }

  if (w1 === null || w2 === null || w3 === null || !levels) {
    return {
      state: "MICRO_W4_UNKNOWN",
      currentZone: "MISSING_MICRO_ANCHORS",
      microW5StillPossible: false,
      cleanMicroW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      needs: ["MICRO_W1_W2_W3_ANCHORS"],
      reasonCodes: ["MISSING_MICRO_W1_W2_W3_ANCHORS"],
    };
  }

  const {
    r236,
    r382,
    r500,
    r618,
    r786,
  } = levels;

  const confirmations = [
    confirmationFilters?.tenMinuteBelowEma20 === true,
    confirmationFilters?.oneHourBelowEma10 === true,
    confirmationFilters?.engine3SellerControl === true,
    confirmationFilters?.engine4BearishParticipation === true,
  ].filter(Boolean).length;

  if (price <= w2) {
    return {
      state: "MICRO_IMPULSE_INVALIDATED",
      currentZone: "BELOW_MICRO_W2_HARD_INVALIDATION",
      microW5StillPossible: false,
      cleanMicroW5PathDamaged: true,
      topLikelyConfirmedForNow: true,
      hardInvalidated: true,
      needs: ["RESET_MICRO_STRUCTURE"],
      reasonCodes: [
        "PRICE_BELOW_MICRO_W2",
        "MICRO_IMPULSE_INVALIDATED",
        "MICRO_W5_PATH_OFF",
      ],
    };
  }

  if (price < r786) {
    return {
      state: "MICRO_W4_DAMAGED",
      currentZone: "BELOW_786_DEEP_DAMAGE_ZONE",
      microW5StillPossible: true,
      cleanMicroW5PathDamaged: true,
      topLikelyConfirmedForNow: true,
      hardInvalidated: false,
      needs: [
        "RECLAIM_738_10_R786",
        "RECLAIM_740_54_618",
        "RECLAIM_740_67_W1_HIGH",
        "RECLAIM_10M_EMA10_20",
        "ENGINE3_REACTION_CONFIRMATION",
        "ENGINE4_PARTICIPATION_CONFIRMATION",
      ],
      reasonCodes: [
        "PRICE_BELOW_786_RETRACE",
        "MICRO_W4_DEEP_DAMAGE_ZONE",
        "CLEAN_MICRO_W5_PATH_DAMAGED",
        "TOP_LIKELY_CONFIRMED_FOR_NOW",
        confirmations > 0 ? "CONFIRMATION_FILTERS_SUPPORT_DAMAGE" : "PRICE_ONLY_DAMAGE_WARNING",
      ],
    };
  }

  if (price < w1) {
    return {
      state: confirmations >= 1
        ? "MICRO_TOP_LIKELY_CONFIRMATION_WARNING"
        : "MICRO_W4_DAMAGED",
      currentZone: "BELOW_W1_HIGH_NO_OVERLAP_DANGER",
      microW5StillPossible: true,
      cleanMicroW5PathDamaged: true,
      topLikelyConfirmedForNow: confirmations >= 1,
      hardInvalidated: false,
      needs: [
        "RECLAIM_W1_HIGH_740_67",
        "RECLAIM_10M_EMA10_20",
        "ONE_HOUR_EMA10_HOLD",
        "ENGINE3_REACTION_CONFIRMATION",
        "ENGINE4_PARTICIPATION_CONFIRMATION",
      ],
      reasonCodes: [
        "PRICE_BELOW_MICRO_W1_HIGH",
        "NO_OVERLAP_DANGER_LINE_LOST",
        "CLEAN_MICRO_W5_PATH_DAMAGED",
        confirmations >= 1
          ? "TOP_LIKELY_CONFIRMATION_WARNING"
          : "PRICE_ONLY_DAMAGE_WARNING",
      ],
    };
  }

  if (price < r618) {
    return {
      state: "MICRO_W4_DEEP_PULLBACK",
      currentZone: "DEEP_BUT_STILL_POSSIBLE_W4",
      microW5StillPossible: true,
      cleanMicroW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      needs: [
        "SUPPORT_HOLD",
        "RECLAIM_10M_EMA10_20",
        "ONE_HOUR_EMA10_HOLD",
      ],
      reasonCodes: [
        "PRICE_NEAR_618_RETRACE",
        "DEEP_BUT_STILL_POSSIBLE_W4",
      ],
    };
  }

  if (price < r500) {
    return {
      state: "MICRO_W4_NORMAL_PULLBACK",
      currentZone: "NORMAL_TO_DEEP_W4_ZONE",
      microW5StillPossible: true,
      cleanMicroW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      needs: [
        "SUPPORT_HOLD",
        "10M_EMA_RECLAIM",
        "ENGINE3_REACTION",
        "ENGINE4_PARTICIPATION",
      ],
      reasonCodes: [
        "PRICE_BETWEEN_500_AND_618_RETRACE",
        "NORMAL_TO_DEEP_W4_PULLBACK",
      ],
    };
  }

  if (price < r382) {
    return {
      state: "MICRO_W4_NORMAL_PULLBACK",
      currentZone: "NORMAL_W4_PULLBACK_ZONE",
      microW5StillPossible: true,
      cleanMicroW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      needs: [
        "SUPPORT_HOLD",
        "10M_EMA_RECLAIM",
      ],
      reasonCodes: [
        "PRICE_BETWEEN_382_AND_500_RETRACE",
        "NORMAL_W4_PULLBACK",
      ],
    };
  }

  if (price < r236) {
    return {
      state: "MICRO_W4_HEALTHY_PULLBACK",
      currentZone: "SHALLOW_HEALTHY_W4_PULLBACK",
      microW5StillPossible: true,
      cleanMicroW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      needs: [
        "SUPPORT_HOLD",
        "WATCH_MICRO_W5_TRIGGER",
      ],
      reasonCodes: [
        "PRICE_ABOVE_382_RETRACE",
        "HEALTHY_W4_PULLBACK",
      ],
    };
  }

  return {
    state: "MICRO_W4_SHALLOW_OR_RECLAIMING",
    currentZone: "ABOVE_236_SHALLOW_PULLBACK_OR_RECLAIM",
    microW5StillPossible: true,
    cleanMicroW5PathDamaged: false,
    topLikelyConfirmedForNow: false,
    hardInvalidated: false,
    needs: [
      "WATCH_RECLAIM",
      "WATCH_MICRO_W5_TRIGGER",
    ],
    reasonCodes: [
      "PRICE_ABOVE_236_RETRACE",
      "SHALLOW_W4_OR_RECLAIMING",
    ],
  };
}

export function analyzeMicroW4AbcRisk({
  symbol = "SPY",
  engine2State = null,
  currentPrice = null,
  regimeLayers = null,
  reactionContext = null,
  volumeContext = null,
} = {}) {
  const micro = engine2State?.micro || null;

  const phase = micro?.phase || "UNKNOWN";
  const confirmedPhase = micro?.confirmedPhase || "UNKNOWN";

  const wave1High = getMarkPrice(micro, "W1");
  const wave2Low = getMarkPrice(micro, "W2");
  const wave3High = getMarkPrice(micro, "W3");

  const active =
    phase === "IN_W4" &&
    confirmedPhase === "IN_W3";

  if (!active) {
    return {
      ok: true,
      active: false,
      symbol,
      state: "NO_ACTIVE_MICRO_W4",
      phase,
      confirmedPhase,
      reasonCodes: ["NOT_MICRO_W4_ACTIVE"],
    };
  }

  const retrace = buildRetracementLevels({
    wave2Low,
    wave3High,
  });

  const confirmationFilters = getConfirmationFilters({
    regimeLayers,
    reactionContext,
    volumeContext,
  });

  const classified = classifyMicroW4({
    currentPrice,
    wave1High,
    wave2Low,
    wave3High,
    levels: retrace.levels,
    confirmationFilters,
  });

  return {
    ok: retrace.ok,
    active: true,
    symbol,

    state: classified.state,
    currentZone: classified.currentZone,

    topCandidate: round2(wave3High),
    wave3High: round2(wave3High),
    wave2Low: round2(wave2Low),
    wave1High: round2(wave1High),

    retracementRange: retrace.range,
    retracementLevels: retrace.levels,

    currentPrice: round2(currentPrice),

    maxCleanPullback: round2(wave1High),
    hardInvalidation: round2(wave2Low),

    microW5StillPossible: classified.microW5StillPossible,
    cleanMicroW5PathDamaged: classified.cleanMicroW5PathDamaged,
    topLikelyConfirmedForNow: classified.topLikelyConfirmedForNow,
    hardInvalidated: classified.hardInvalidated,

    confirmationFilters,

    needs: classified.needs,
    reasonCodes: [
      "MICRO_W4_ACTIVE",
      wave3High !== null ? `MICRO_W3_HIGH_${String(round2(wave3High)).replace(".", "_")}` : null,
      wave1High !== null ? `WATCH_${String(round2(wave1High)).replace(".", "_")}_NO_OVERLAP_LINE` : null,
      ...(Array.isArray(classified.reasonCodes) ? classified.reasonCodes : []),
    ].filter(Boolean),
  };
}

export default analyzeMicroW4AbcRisk;
