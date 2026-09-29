// services/core/logic/engine29/trapDetection/buildMacroLiquidityMap.js
// Engine 29 — macro liquidity map for trap detection.
//
// Authority:
// 4H / 2H / 1H + institutional levels answer WHERE.
// This module does not confirm a trap and does not create trade permission.

import {
  ENGINE29_LIQUIDITY_LEVEL_TYPES,
  ENGINE29_TRAP_LOCATION_QUALITY,
  ENGINE29_TRAP_REASON_CODES,
} from "./trapConstants.js";

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sortBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .filter((bar) =>
      Number.isFinite(finite(bar?.time)) &&
      Number.isFinite(finite(bar?.high)) &&
      Number.isFinite(finite(bar?.low)) &&
      Number.isFinite(finite(bar?.close))
    )
    .slice()
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function confirmedSwings(bars = [], { left = 2, right = 2, limit = 12 } = {}) {
  const clean = sortBars(bars);
  const highs = [];
  const lows = [];

  for (let i = left; i < clean.length - right; i += 1) {
    const bar = clean[i];
    const high = Number(bar.high);
    const low = Number(bar.low);

    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= left; offset += 1) {
      if (Number(clean[i - offset]?.high) >= high) isHigh = false;
      if (Number(clean[i - offset]?.low) <= low) isLow = false;
    }

    for (let offset = 1; offset <= right; offset += 1) {
      if (Number(clean[i + offset]?.high) > high) isHigh = false;
      if (Number(clean[i + offset]?.low) < low) isLow = false;
    }

    if (isHigh) {
      highs.push({
        price: high,
        time: Number(bar.time),
        index: i,
      });
    }

    if (isLow) {
      lows.push({
        price: low,
        time: Number(bar.time),
        index: i,
      });
    }
  }

  return {
    highs: highs.slice(-limit),
    lows: lows.slice(-limit),
  };
}

function makeSwingLevels(swings, timeframe) {
  const highType =
    timeframe === "4H"
      ? ENGINE29_LIQUIDITY_LEVEL_TYPES.FOUR_HOUR_SWING_HIGH
      : timeframe === "2H"
        ? ENGINE29_LIQUIDITY_LEVEL_TYPES.TWO_HOUR_SWING_HIGH
        : ENGINE29_LIQUIDITY_LEVEL_TYPES.ONE_HOUR_SWING_HIGH;

  const lowType =
    timeframe === "4H"
      ? ENGINE29_LIQUIDITY_LEVEL_TYPES.FOUR_HOUR_SWING_LOW
      : timeframe === "2H"
        ? ENGINE29_LIQUIDITY_LEVEL_TYPES.TWO_HOUR_SWING_LOW
        : ENGINE29_LIQUIDITY_LEVEL_TYPES.ONE_HOUR_SWING_LOW;

  return [
    ...(swings?.highs || []).map((swing) => ({
      id: `${timeframe}|HIGH|${swing.time}|${swing.price}`,
      type: highType,
      timeframe,
      side: "HIGH",
      level: swing.price,
      lo: swing.price,
      hi: swing.price,
      time: swing.time,
      source: "CONFIRMED_SWING",
    })),
    ...(swings?.lows || []).map((swing) => ({
      id: `${timeframe}|LOW|${swing.time}|${swing.price}`,
      type: lowType,
      timeframe,
      side: "LOW",
      level: swing.price,
      lo: swing.price,
      hi: swing.price,
      time: swing.time,
      source: "CONFIRMED_SWING",
    })),
  ];
}

function makeInstitutionalLevels(inventory) {
  return (inventory?.zones || []).map((zone) => ({
    id: zone.id,
    type: ENGINE29_LIQUIDITY_LEVEL_TYPES.INSTITUTIONAL_ZONE,
    timeframe: null,
    side: "BOTH",
    level: zone.mid,
    lo: zone.lo,
    hi: zone.hi,
    time: null,
    source: zone.source,
    sourceLine: zone.sourceLine,
    rollAdjustmentPoints: zone.rollAdjustmentPoints ?? 0,
    priceBasis: zone.priceBasis ?? null,
  }));
}

function median(values = []) {
  const clean = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!clean.length) return null;

  const mid = Math.floor(clean.length / 2);
  return clean.length % 2
    ? clean[mid]
    : (clean[mid - 1] + clean[mid]) / 2;
}

function adaptiveConfluenceDistance(bars30m = []) {
  const bars = sortBars(bars30m).slice(-40);
  const ranges = bars
    .map((bar) => Number(bar.high) - Number(bar.low))
    .filter((value) => Number.isFinite(value) && value > 0);

  const medianRange = median(ranges);

  // Location clustering uses the market's own recent 30m range.
  // No fixed price threshold is introduced.
  return Number.isFinite(medianRange)
    ? Math.max(0.25, medianRange * 0.35)
    : 0.25;
}

function distanceToLevel(price, level) {
  if (!Number.isFinite(price) || !Number.isFinite(level)) return null;
  return Math.abs(price - level);
}

function distanceToZone(price, lo, hi) {
  if (![price, lo, hi].every(Number.isFinite)) return null;
  if (price >= lo && price <= hi) return 0;
  return price < lo ? lo - price : price - hi;
}

function levelDistance(price, item) {
  if (item?.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.INSTITUTIONAL_ZONE) {
    return distanceToZone(price, Number(item.lo), Number(item.hi));
  }

  return distanceToLevel(price, Number(item.level));
}

function confluenceAt(levels, anchor, threshold) {
  return levels
    .map((level) => ({
      ...level,
      distancePoints: levelDistance(anchor, level),
    }))
    .filter((level) =>
      Number.isFinite(level.distancePoints) &&
      level.distancePoints <= threshold
    );
}

function locationQuality(confluence = []) {
  if (!confluence.length) return ENGINE29_TRAP_LOCATION_QUALITY.LOW;

  const hasInstitutional = confluence.some(
    (item) => item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.INSTITUTIONAL_ZONE
  );

  const hasFourHour = confluence.some(
    (item) =>
      item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.FOUR_HOUR_SWING_HIGH ||
      item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.FOUR_HOUR_SWING_LOW
  );

  const hasTwoHour = confluence.some(
    (item) =>
      item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.TWO_HOUR_SWING_HIGH ||
      item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.TWO_HOUR_SWING_LOW
  );

  if (
    confluence.length >= 3 ||
    (hasInstitutional && hasFourHour) ||
    (hasInstitutional && hasTwoHour && confluence.length >= 2)
  ) {
    return ENGINE29_TRAP_LOCATION_QUALITY.VERY_HIGH;
  }

  if (hasInstitutional || hasFourHour || confluence.length >= 2) {
    return ENGINE29_TRAP_LOCATION_QUALITY.HIGH;
  }

  if (hasTwoHour) {
    return ENGINE29_TRAP_LOCATION_QUALITY.MEDIUM;
  }

  return ENGINE29_TRAP_LOCATION_QUALITY.LOW;
}

export function buildEngine29MacroLiquidityMap({
  currentPrice = null,
  fourHourBars = [],
  twoHourBars = [],
  oneHourBars = [],
  thirtyMinuteBars = [],
  institutionalInventory = null,
} = {}) {
  const price = finite(currentPrice);

  const levels = [
    ...makeSwingLevels(confirmedSwings(fourHourBars), "4H"),
    ...makeSwingLevels(confirmedSwings(twoHourBars), "2H"),
    ...makeSwingLevels(confirmedSwings(oneHourBars), "1H"),
    ...makeInstitutionalLevels(institutionalInventory),
  ];

  const thresholdPoints = adaptiveConfluenceDistance(thirtyMinuteBars);

  const nearest = Number.isFinite(price)
    ? levels
        .map((level) => ({
          ...level,
          distancePoints: levelDistance(price, level),
        }))
        .filter((level) => Number.isFinite(level.distancePoints))
        .sort((a, b) => a.distancePoints - b.distancePoints)
        .slice(0, 12)
    : [];

  const primary = nearest[0] || null;

  const confluence = primary
    ? confluenceAt(levels, Number(primary.level), thresholdPoints)
    : [];

  const quality = primary
    ? locationQuality(confluence)
    : ENGINE29_TRAP_LOCATION_QUALITY.UNAVAILABLE;

  const reasonCodes = [];

  if (!primary) {
    reasonCodes.push(ENGINE29_TRAP_REASON_CODES.MACRO_LOCATION_UNAVAILABLE);
  } else {
    if (
      confluence.some(
        (item) => item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.INSTITUTIONAL_ZONE
      )
    ) {
      reasonCodes.push(ENGINE29_TRAP_REASON_CODES.INSTITUTIONAL_ZONE_NEARBY);
    }

    if (
      confluence.some(
        (item) =>
          item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.FOUR_HOUR_SWING_HIGH ||
          item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.FOUR_HOUR_SWING_LOW
      )
    ) {
      reasonCodes.push(ENGINE29_TRAP_REASON_CODES.FOUR_HOUR_LIQUIDITY_NEARBY);
    }

    if (
      confluence.some(
        (item) =>
          item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.TWO_HOUR_SWING_HIGH ||
          item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.TWO_HOUR_SWING_LOW
      )
    ) {
      reasonCodes.push(ENGINE29_TRAP_REASON_CODES.TWO_HOUR_LIQUIDITY_NEARBY);
    }

    if (
      confluence.some(
        (item) =>
          item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.ONE_HOUR_SWING_HIGH ||
          item.type === ENGINE29_LIQUIDITY_LEVEL_TYPES.ONE_HOUR_SWING_LOW
      )
    ) {
      reasonCodes.push(ENGINE29_TRAP_REASON_CODES.ONE_HOUR_LIQUIDITY_NEARBY);
    }

    if (confluence.length >= 2) {
      reasonCodes.push(ENGINE29_TRAP_REASON_CODES.MULTI_LEVEL_CONFLUENCE);
    }
  }

  return {
    version: "engine29.macroLiquidityMap.v1",
    authority: "LOCATION_CONTEXT_ONLY",
    currentPrice: price,
    confluenceThresholdPoints: thresholdPoints,
    locationQuality: quality,
    primaryLevel: primary,
    confluence,
    nearestLevels: nearest,
    levelCount: levels.length,
    levels,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

export default buildEngine29MacroLiquidityMap;
