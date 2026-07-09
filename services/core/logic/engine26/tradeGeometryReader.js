"use strict";

/**
 * Engine 26 Trade Geometry Reader
 *
 * Purpose:
 * - TradingView-style long/short position geometry
 * - Entry / stop / targets
 * - Risk points / reward points / R/R
 * - 3-block paper-trial preview
 *
 * Scope:
 * - Geometry only
 * - Stateless / pure functions
 * - No execution
 * - No Schwab
 * - No Engine 8
 * - No Engine 6 permission changes
 * - No Engine 10 journal writes
 */

const DEFAULT_INSTRUMENT = "ES";
const DEFAULT_TICK_SIZE = 0.25;
const DEFAULT_POINT_VALUE = 50;

const PAPER_MODE = "PAPER_ONLY";

const BLOCK_DEFINITIONS = [
  { block: 1, label: "P1", sizeFraction: 0.33 },
  { block: 2, label: "P2", sizeFraction: 0.33 },
  { block: 3, label: "P3_RUNNER", sizeFraction: 0.34 },
];

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundToDecimals(value, decimals = 2) {
  const number = asNumber(value);
  if (number === null) return null;

  const factor = 10 ** decimals;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function roundToTick(price, tickSize = DEFAULT_TICK_SIZE) {
  const numericPrice = asNumber(price);
  const numericTick = asNumber(tickSize);

  if (numericPrice === null) return null;
  if (numericTick === null || numericTick <= 0) return numericPrice;

  return roundToDecimals(Math.round(numericPrice / numericTick) * numericTick, 8);
}

function normalizeDirection(direction) {
  if (!direction) return null;

  const value = String(direction).trim().toUpperCase();

  if (value === "SHORT") return "SHORT";
  if (value === "LONG") return "LONG";

  return null;
}

function formatPrice(value) {
  const number = asNumber(value);
  return number === null ? "n/a" : number.toFixed(2);
}

function formatPoints(value) {
  const number = asNumber(value);
  return number === null ? "n/a" : number.toFixed(2);
}

function formatRr(value) {
  const number = asNumber(value);
  return number === null ? "n/a" : number.toFixed(2);
}

function calculateRiskPoints(direction, entryPrice, stopPrice) {
  const side = normalizeDirection(direction);
  const entry = asNumber(entryPrice);
  const stop = asNumber(stopPrice);

  if (!side) return null;
  if (entry === null || stop === null) return null;

  if (side === "SHORT") {
    return roundToDecimals(stop - entry, 2);
  }

  if (side === "LONG") {
    return roundToDecimals(entry - stop, 2);
  }

  return null;
}

function calculateRewardPoints(direction, entryPrice, targetPrice) {
  const side = normalizeDirection(direction);
  const entry = asNumber(entryPrice);
  const target = asNumber(targetPrice);

  if (!side) return null;
  if (entry === null || target === null) return null;

  if (side === "SHORT") {
    return roundToDecimals(entry - target, 2);
  }

  if (side === "LONG") {
    return roundToDecimals(target - entry, 2);
  }

  return null;
}

function calculateRiskReward(rewardPoints, riskPoints) {
  const reward = asNumber(rewardPoints);
  const risk = asNumber(riskPoints);

  if (reward === null || risk === null) return null;
  if (risk <= 0) return null;

  return roundToDecimals(reward / risk, 2);
}

function buildInvalidGeometry(input, invalidReason) {
  const direction = normalizeDirection(input?.direction);

  return {
    symbol: input?.symbol || DEFAULT_INSTRUMENT,
    instrument: input?.instrument || input?.symbol || DEFAULT_INSTRUMENT,
    strategyId: input?.strategyId || null,

    mode: PAPER_MODE,
    researchOnly: true,
    noExecution: true,

    direction,
    entryPrice: input?.entryPrice ?? null,
    stopPrice: input?.stopPrice ?? null,
    riskPoints: null,

    targets: [],
    allTargets: Array.isArray(input?.targets) ? input.targets : [],
    unusedTargets: [],

    blocks: [],

    p2Rr: null,
    bestRewardPoints: null,
    bestRr: null,

    valid: false,
    invalidReason,

    display: {
      headline: "INVALID ENGINE 26 TRADE GEOMETRY",
      entryLine: "Entry n/a",
      stopLine: "Stop n/a",
      targetLine: "Targets n/a",
      rrLine: invalidReason,
    },
  };
}

function validateRawInput(input) {
  if (!input || typeof input !== "object") {
    return "MISSING_INPUT";
  }

  const direction = normalizeDirection(input.direction);

  if (!direction) {
    return "INVALID_DIRECTION";
  }

  if (asNumber(input.entryPrice) === null) {
    return "MISSING_ENTRY_PRICE";
  }

  if (asNumber(input.stopPrice) === null) {
    return "MISSING_STOP_PRICE";
  }

  if (!Array.isArray(input.targets)) {
    return "MISSING_TARGETS";
  }

  if (input.targets.length < 3) {
    return "THREE_TARGETS_REQUIRED";
  }

  const hasInvalidTarget = input.targets.some((target) => asNumber(target) === null);

  if (hasInvalidTarget) {
    return "INVALID_TARGET_PRICE";
  }

  return null;
}

function selectThreeBlockTargets(targets) {
  if (!Array.isArray(targets)) {
    return [];
  }

  if (targets.length < 3) {
    return targets;
  }

  return [targets[0], targets[1], targets[targets.length - 1]];
}

function validateTradeGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return {
      valid: false,
      invalidReason: "MISSING_GEOMETRY",
    };
  }

  const direction = normalizeDirection(geometry.direction);
  const entryPrice = asNumber(geometry.entryPrice);
  const stopPrice = asNumber(geometry.stopPrice);
  const targets = Array.isArray(geometry.targets) ? geometry.targets : [];

  if (!direction) {
    return {
      valid: false,
      invalidReason: "INVALID_DIRECTION",
    };
  }

  if (entryPrice === null) {
    return {
      valid: false,
      invalidReason: "MISSING_ENTRY_PRICE",
    };
  }

  if (stopPrice === null) {
    return {
      valid: false,
      invalidReason: "MISSING_STOP_PRICE",
    };
  }

  if (targets.length < 3) {
    return {
      valid: false,
      invalidReason: "THREE_TARGETS_REQUIRED",
    };
  }

  if (direction === "SHORT" && stopPrice <= entryPrice) {
    return {
      valid: false,
      invalidReason: "SHORT_STOP_MUST_BE_ABOVE_ENTRY",
    };
  }

  if (direction === "LONG" && stopPrice >= entryPrice) {
    return {
      valid: false,
      invalidReason: "LONG_STOP_MUST_BE_BELOW_ENTRY",
    };
  }

  const riskPoints = calculateRiskPoints(direction, entryPrice, stopPrice);

  if (riskPoints === null || riskPoints <= 0) {
    return {
      valid: false,
      invalidReason: "RISK_POINTS_MUST_BE_POSITIVE",
    };
  }

  for (const target of targets) {
    const targetPrice = asNumber(target?.targetPrice ?? target);

    if (targetPrice === null) {
      return {
        valid: false,
        invalidReason: "INVALID_TARGET_PRICE",
      };
    }

    if (direction === "SHORT" && targetPrice >= entryPrice) {
      return {
        valid: false,
        invalidReason: "SHORT_TARGET_MUST_BE_BELOW_ENTRY",
      };
    }

    if (direction === "LONG" && targetPrice <= entryPrice) {
      return {
        valid: false,
        invalidReason: "LONG_TARGET_MUST_BE_ABOVE_ENTRY",
      };
    }

    const rewardPoints = calculateRewardPoints(direction, entryPrice, targetPrice);

    if (rewardPoints === null || rewardPoints <= 0) {
      return {
        valid: false,
        invalidReason: "REWARD_POINTS_MUST_BE_POSITIVE",
      };
    }
  }

  return {
    valid: true,
    invalidReason: null,
  };
}

function buildThreeBlockPlanFromGeometry(geometry) {
  const validation = validateTradeGeometry(geometry);

  if (!validation.valid) {
    return [];
  }

  const direction = normalizeDirection(geometry.direction);
  const entryPrice = asNumber(geometry.entryPrice);
  const stopPrice = asNumber(geometry.stopPrice);
  const riskPoints = asNumber(geometry.riskPoints);
  const targets = Array.isArray(geometry.targets) ? geometry.targets : [];

  return BLOCK_DEFINITIONS.map((definition, index) => {
    const target = targets[index];
    const targetPrice = asNumber(target?.targetPrice ?? target);
    const rewardPoints = calculateRewardPoints(direction, entryPrice, targetPrice);
    const rr = calculateRiskReward(rewardPoints, riskPoints);

    return {
      block: definition.block,
      label: definition.label,
      sizeFraction: definition.sizeFraction,

      entryPrice,
      stopPrice,
      targetPrice,

      riskPoints,
      rewardPoints,
      rr,

      status: "PENDING",
    };
  });
}

function buildDisplay(geometry) {
  const direction = normalizeDirection(geometry.direction);
  const directionLabel = direction === "SHORT" ? "Short" : "Long";
  const headlineDirection = direction || "UNKNOWN";

  const p1 = geometry.targets?.[0];
  const p2 = geometry.targets?.[1];
  const p3 = geometry.targets?.[2];

  const p2Rr = p2?.rr ?? null;
  const bestRr = geometry.bestRr ?? null;

  return {
    headline: `${headlineDirection} PAPER TRIAL — P2 R/R ${formatRr(p2Rr)}`,
    entryLine: `${directionLabel} entry ${formatPrice(geometry.entryPrice)}`,
    stopLine: `Stop ${formatPrice(geometry.stopPrice)} — risk ${formatPoints(
      geometry.riskPoints
    )} pts`,
    targetLine: `P1 ${formatPrice(p1?.targetPrice)} / P2 ${formatPrice(
      p2?.targetPrice
    )} / Runner ${formatPrice(p3?.targetPrice)}`,
    rrLine: `Best R/R ${formatRr(bestRr)}`,
  };
}

function buildTradeGeometry(input = {}) {
  const rawValidationError = validateRawInput(input);

  if (rawValidationError) {
    return buildInvalidGeometry(input, rawValidationError);
  }

  const tickSize = asNumber(input.tickSize) || DEFAULT_TICK_SIZE;
  const pointValue = asNumber(input.pointValue) || DEFAULT_POINT_VALUE;
  const symbol = input.symbol || DEFAULT_INSTRUMENT;
  const instrument = input.instrument || symbol || DEFAULT_INSTRUMENT;
  const direction = normalizeDirection(input.direction);

  const entryPrice = roundToTick(input.entryPrice, tickSize);
  const stopPrice = roundToTick(input.stopPrice, tickSize);
  const allTargets = input.targets.map((target) => roundToTick(target, tickSize));
  const selectedTargets = selectThreeBlockTargets(allTargets);

  const baseGeometry = {
    symbol,
    instrument,
    strategyId: input.strategyId || null,

    mode: PAPER_MODE,
    researchOnly: true,
    noExecution: true,

    direction,
    tickSize,
    pointValue,

    entryPrice,
    stopPrice,
    riskPoints: calculateRiskPoints(direction, entryPrice, stopPrice),

    targets: selectedTargets,
    allTargets,
    unusedTargets:
      allTargets.length > 3 ? allTargets.slice(2, allTargets.length - 1) : [],

    blocks: [],

    p2Rr: null,
    bestRewardPoints: null,
    bestRr: null,

    valid: false,
    invalidReason: null,

    display: null,
  };

  const validation = validateTradeGeometry(baseGeometry);

  if (!validation.valid) {
    return {
      ...baseGeometry,
      valid: false,
      invalidReason: validation.invalidReason,
      targets: [],
      blocks: [],
      display: {
        headline: "INVALID ENGINE 26 TRADE GEOMETRY",
        entryLine: `${direction || "Unknown"} entry ${formatPrice(entryPrice)}`,
        stopLine: `Stop ${formatPrice(stopPrice)}`,
        targetLine: "Targets invalid",
        rrLine: validation.invalidReason,
      },
    };
  }

  const enrichedTargets = selectedTargets.map((targetPrice, index) => {
    const label = BLOCK_DEFINITIONS[index]?.label || `P${index + 1}`;
    const rewardPoints = calculateRewardPoints(direction, entryPrice, targetPrice);
    const rr = calculateRiskReward(rewardPoints, baseGeometry.riskPoints);

    return {
      label,
      targetPrice,
      rewardPoints,
      rr,
    };
  });

  const rewardValues = enrichedTargets
    .map((target) => target.rewardPoints)
    .filter((value) => Number.isFinite(value));

  const rrValues = enrichedTargets
    .map((target) => target.rr)
    .filter((value) => Number.isFinite(value));

  const bestRewardPoints = rewardValues.length
    ? roundToDecimals(Math.max(...rewardValues), 2)
    : null;

  const bestRr = rrValues.length ? roundToDecimals(Math.max(...rrValues), 2) : null;

  const p2Rr = enrichedTargets[1]?.rr ?? null;

  const geometry = {
    ...baseGeometry,
    targets: enrichedTargets,
    p2Rr,
    bestRewardPoints,
    bestRr,
    valid: true,
    invalidReason: null,
  };

  const blocks = buildThreeBlockPlanFromGeometry(geometry);

  const completedGeometry = {
    ...geometry,
    blocks,
  };

  return {
    ...completedGeometry,
    display: buildDisplay(completedGeometry),
  };
}

module.exports = {
  DEFAULT_INSTRUMENT,
  DEFAULT_TICK_SIZE,
  DEFAULT_POINT_VALUE,

  roundToTick,
  calculateRiskPoints,
  calculateRewardPoints,
  calculateRiskReward,
  validateTradeGeometry,
  buildThreeBlockPlanFromGeometry,
  buildTradeGeometry,
};
