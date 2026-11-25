// services/core/logic/engine22/wave/analyzeFibPressure.js
// Engine 22G — Generic Wave/Fib State Engine
// File 2: analyzeFibPressure.js
//
// Purpose:
// Given current price and projected fib extension levels,
// determine where price is relative to extension pressure.
//
// This is read-only intelligence. It does not create trades.

const FIB_ORDER = [
  { key: "e100", label: "1.000", value: 1.0 },
  { key: "e1168", label: "1.168", value: 1.168 },
  { key: "e1272", label: "1.272", value: 1.272 },
  { key: "e1618", label: "1.618", value: 1.618 },
  { key: "e200", label: "2.000", value: 2.0 },
  { key: "e2618", label: "2.618", value: 2.618 },
];

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function normalizeDirection(direction) {
  const d = String(direction || "").trim().toUpperCase();

  if (d === "BEARISH") return "BEARISH";
  return "BULLISH";
}

function signedDistance({ currentPrice, fibPrice, direction }) {
  const price = toNum(currentPrice);
  const fib = toNum(fibPrice);

  if (price === null || fib === null) return null;

  // Bullish:
  // negative means price is below target
  // positive means price is above target
  if (direction === "BULLISH") {
    return price - fib;
  }

  // Bearish:
  // negative means price has not reached downside target yet
  // positive means price has passed below downside target
  return fib - price;
}

function getNearestFib({ currentPrice, levels, direction }) {
  const price = toNum(currentPrice);

  if (price === null || !levels || typeof levels !== "object") return null;

  let best = null;

  for (const fib of FIB_ORDER) {
    const fibPrice = toNum(levels[fib.key]);
    if (fibPrice === null) continue;

    const dist = signedDistance({
      currentPrice: price,
      fibPrice,
      direction,
    });

    if (dist === null) continue;

    const absDistance = Math.abs(dist);

    if (!best || absDistance < best.absDistancePts) {
      best = {
        key: fib.key,
        label: fib.label,
        value: fib.value,
        price: fibPrice,
        distancePts: dist,
        absDistancePts: absDistance,
      };
    }
  }

  return best;
}

function pricePositionValue({ currentPrice, levels, direction }) {
  const price = toNum(currentPrice);
  if (price === null || !levels || typeof levels !== "object") return null;

  const e100 = toNum(levels.e100);
  const e1272 = toNum(levels.e1272);
  const e1618 = toNum(levels.e1618);
  const e200 = toNum(levels.e200);
  const e2618 = toNum(levels.e2618);

  const reached = (level) => {
    if (level === null) return false;
    return direction === "BULLISH" ? price >= level : price <= level;
  };

  if (reached(e2618)) return 2.618;
  if (reached(e200)) return 2.0;
  if (reached(e1618)) return 1.618;
  if (reached(e1272)) return 1.272;
  if (reached(e100)) return 1.0;

  return 0;
}

function classifyExtensionState({ currentPrice, levels, nearestFib, direction }) {
  const price = toNum(currentPrice);

  if (price === null || !levels || typeof levels !== "object") {
    return {
      extensionState: "UNKNOWN",
      chaseRisk: "UNKNOWN",
      expectedBehavior: "WAIT_FOR_VALID_PRICE_AND_LEVELS",
      reasonCodes: ["MISSING_PRICE_OR_LEVELS"],
    };
  }

  const e100 = toNum(levels.e100);
  const e1272 = toNum(levels.e1272);
  const e1618 = toNum(levels.e1618);
  const e200 = toNum(levels.e200);
  const e2618 = toNum(levels.e2618);

  const pos = pricePositionValue({ currentPrice: price, levels, direction });
  const nearKey = nearestFib?.key || null;

  const nearDistancePct =
    nearestFib?.price && nearestFib.price !== 0
      ? Math.abs((nearestFib.distancePts / nearestFib.price) * 100)
      : null;

  const isNearNearest =
    nearDistancePct !== null && nearDistancePct <= 0.35;

  const reached = (level) => {
    if (level === null) return false;
    return direction === "BULLISH" ? price >= level : price <= level;
  };

  const before = (level) => {
    if (level === null) return false;
    return direction === "BULLISH" ? price < level : price > level;
  };

  if (e100 !== null && before(e100)) {
    return {
      extensionState: isNearNearest && nearKey === "e100"
        ? "APPROACHING_1_000_TARGET"
        : "BELOW_1_000_TARGET",
      chaseRisk: isNearNearest && nearKey === "e100"
        ? "MODERATE"
        : "LOW_TO_MODERATE",
      expectedBehavior: "NORMAL_EXTENSION_BUILDING",
      reasonCodes: [
        isNearNearest && nearKey === "e100"
          ? "PRICE_APPROACHING_1_000_EXTENSION"
          : "PRICE_BELOW_1_000_EXTENSION",
      ],
    };
  }

  if (isNearNearest && nearKey === "e1618") {
    return {
      extensionState: "NEAR_1_618_REACTION_ZONE",
      chaseRisk: "HIGH",
      expectedBehavior: "REACTION_OR_PULLBACK",
      reasonCodes: [
        "PRICE_NEAR_1_618_EXTENSION",
        "HIGH_CHASE_RISK",
      ],
    };
  }

  if (pos >= 2.618 || (isNearNearest && nearKey === "e2618")) {
    return {
      extensionState: "EXHAUSTION_RISK",
      chaseRisk: "EXTREME",
      expectedBehavior: "EXHAUSTION_OR_MAJOR_REACTION_RISK",
      reasonCodes: [
        "PRICE_NEAR_OR_ABOVE_2_618_EXTENSION",
        "EXTREME_CHASE_RISK",
      ],
    };
  }

  if (pos >= 2.0 || (isNearNearest && nearKey === "e200")) {
    return {
      extensionState: "VERY_LATE_EXTENSION",
      chaseRisk: "VERY_HIGH",
      expectedBehavior: "LATE_STAGE_EXTENSION_PULLBACK_RISK",
      reasonCodes: [
        "PRICE_NEAR_OR_ABOVE_2_000_EXTENSION",
        "VERY_HIGH_CHASE_RISK",
      ],
    };
  }

  if (reached(e1618)) {
    return {
      extensionState: "LATE_EXTENSION",
      chaseRisk: "VERY_HIGH",
      expectedBehavior: "POST_1_618_EXTENSION_REACTION_RISK",
      reasonCodes: [
        "PRICE_ABOVE_1_618_EXTENSION",
        "VERY_HIGH_CHASE_RISK",
      ],
    };
  }

  if (pos >= 1.272 || (isNearNearest && nearKey === "e1272")) {
    return {
      extensionState: "STRONG_EXTENSION",
      chaseRisk: "ELEVATED",
      expectedBehavior: "TREND_CAN_CONTINUE_BUT_PULLBACK_RISK_RISING",
      reasonCodes: [
        "PRICE_NEAR_OR_ABOVE_1_272_EXTENSION",
        "ELEVATED_CHASE_RISK",
      ],
    };
  }

  if (pos >= 1.0) {
    return {
      extensionState: "NORMAL_EXTENSION_ACTIVE",
      chaseRisk: "MODERATE",
      expectedBehavior: "EXTENSION_ACTIVE",
      reasonCodes: [
        "PRICE_ABOVE_1_000_EXTENSION",
        "NORMAL_EXTENSION_ACTIVE",
      ],
    };
  }

  return {
    extensionState: "UNKNOWN",
    chaseRisk: "UNKNOWN",
    expectedBehavior: "NO_CLEAR_EXTENSION_STATE",
    reasonCodes: ["NO_CLEAR_EXTENSION_STATE"],
  };
}

export function analyzeFibPressure({
  currentPrice = null,
  levels = null,
  direction = "BULLISH",
} = {}) {
  const price = toNum(currentPrice);

  if (price === null) {
    return {
      ok: false,
      currentPrice: null,
      nearestFib: null,
      nearestFibKey: null,
      nearestFibPrice: null,
      distancePts: null,
      distancePct: null,
      extensionState: "UNKNOWN",
      chaseRisk: "UNKNOWN",
      expectedBehavior: "WAIT_FOR_VALID_PRICE",
      reasonCodes: ["MISSING_CURRENT_PRICE"],
    };
  }

  if (!levels || typeof levels !== "object") {
    return {
      ok: false,
      currentPrice: round2(price),
      nearestFib: null,
      nearestFibKey: null,
      nearestFibPrice: null,
      distancePts: null,
      distancePct: null,
      extensionState: "UNKNOWN",
      chaseRisk: "UNKNOWN",
      expectedBehavior: "WAIT_FOR_VALID_LEVELS",
      reasonCodes: ["MISSING_EXTENSION_LEVELS"],
    };
  }

  const dir = normalizeDirection(direction);

  const nearestFib = getNearestFib({
    currentPrice: price,
    levels,
    direction: dir,
  });

  if (!nearestFib) {
    return {
      ok: false,
      currentPrice: round2(price),
      nearestFib: null,
      nearestFibKey: null,
      nearestFibPrice: null,
      distancePts: null,
      distancePct: null,
      extensionState: "UNKNOWN",
      chaseRisk: "UNKNOWN",
      expectedBehavior: "WAIT_FOR_VALID_LEVELS",
      reasonCodes: ["NO_VALID_FIB_LEVELS"],
    };
  }

  const classified = classifyExtensionState({
    currentPrice: price,
    levels,
    nearestFib,
    direction: dir,
  });

  const distancePct =
    nearestFib.price !== 0
      ? (nearestFib.distancePts / nearestFib.price) * 100
      : null;

  return {
    ok: true,
    currentPrice: round2(price),
    direction: dir,

    nearestFib: nearestFib.label,
    nearestFibKey: nearestFib.key,
    nearestFibPrice: round2(nearestFib.price),

    distancePts: round2(nearestFib.distancePts),
    distancePct: round2(distancePct),

    extensionState: classified.extensionState,
    chaseRisk: classified.chaseRisk,
    expectedBehavior: classified.expectedBehavior,

    reasonCodes: classified.reasonCodes,
  };
}

export default analyzeFibPressure;
