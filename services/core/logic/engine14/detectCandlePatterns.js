// services/core/logic/engine14/detectCandlePatterns.js

import { THRESHOLDS } from "./constants.js";
import { candleStats, zoneMid, zonePos01, insideZone } from "./normalizeInputs.js";

function isBull(bar) {
  return Number(bar?.close ?? 0) > Number(bar?.open ?? 0);
}

function isBear(bar) {
  return Number(bar?.close ?? 0) < Number(bar?.open ?? 0);
}

function upperWickPct(bar) {
  const range = Math.max(0, Number(bar?.high ?? 0) - Number(bar?.low ?? 0));
  if (range <= 0) return 0;
  return (Number(bar?.high ?? 0) - Math.max(Number(bar?.open ?? 0), Number(bar?.close ?? 0))) / range;
}

function lowerWickPct(bar) {
  const range = Math.max(0, Number(bar?.high ?? 0) - Number(bar?.low ?? 0));
  if (range <= 0) return 0;
  return (Math.min(Number(bar?.open ?? 0), Number(bar?.close ?? 0)) - Number(bar?.low ?? 0)) / range;
}

export function detectPatternContext({ bars10m, zone }) {
  const a = bars10m[bars10m.length - 3];
  const b = bars10m[bars10m.length - 2];
  const c = bars10m[bars10m.length - 1];

  if (!a || !b || !c) {
    return { a: null, b: null, c: null };
  }

  const zoneMidValue = zoneMid(zone);
  const posA = zonePos01(a.close, zone);
  const posB = zonePos01(b.close, zone);
  const posC = zonePos01(c.close, zone);

  return {
    a,
    b,
    c,
    zoneMid: zoneMidValue,
    posA,
    posB,
    posC,
    insideA: insideZone(a.close, zone),
    insideB: insideZone(b.close, zone),
    insideC: insideZone(c.close, zone),
  };
}

export function detectDisplacementRetest({ bars10m, atr14, avgVol20, zone }) {
  const { a, b, c, zoneMid: mid } = detectPatternContext({ bars10m, zone });
  if (!a || !b || !c) return null;

  const sa = candleStats(a, atr14, avgVol20);
  const sb = candleStats(b, atr14, avgVol20);
  const sc = candleStats(c, atr14, avgVol20);

  const strongBearImpulse =
    isBear(a) &&
    sa.rangeExpansion >= THRESHOLDS.displacement.rangeStrong &&
    sa.bodyPercent >= THRESHOLDS.displacement.bodyStrong &&
    sa.closeNearLow;

  const strongBullImpulse =
    isBull(a) &&
    sa.rangeExpansion >= THRESHOLDS.displacement.rangeStrong &&
    sa.bodyPercent >= THRESHOLDS.displacement.bodyStrong &&
    sa.closeNearHigh;

  if (strongBearImpulse) {
    const snapback = isBull(b) && b.close > a.close && b.close < a.open;
    const failedReclaim = mid != null ? b.close < mid || c.close < mid : true;
    const release = isBear(c) && c.close < b.low;

    if (snapback) {
      return {
        setupType: "DISPLACEMENT_RETEST",
        direction: "SHORT",
        behavior: "MOMENTUM_CONTINUATION",
        stage: release ? "CONFIRMED" : "CONFIRMING",
        signalBarTime: a.time,
        confirmBarTime: c.time,
        confirmed: release,
        reasonCodes: [
          "BEARISH_DISPLACEMENT",
          "RANGE_EXPANSION_STRONG",
          "BODY_VELOCITY_STRONG",
          "FAST_RETEST_INTO_ZONE",
          failedReclaim ? "FAILED_RECLAIM_ZONE" : "RETEST_IN_PROGRESS",
          release ? "RELEASE_DOWN_CONFIRMED" : "WAITING_FOR_RELEASE",
        ],
        triggerNow: release,
        entryHint: b.low,
        invalidateLevel: Math.max(a.high, b.high),
        candleQuality: {
          signalBarTime: a.time,
          direction: "SHORT",
          range: Number(sa.range.toFixed(2)),
          atr14: Number(atr14.toFixed(2)),
          rangeExpansion: Number(sa.rangeExpansion.toFixed(2)),
          bodySize: Number(sa.bodySize.toFixed(2)),
          bodyPercent: Number(sa.bodyPercent.toFixed(2)),
          closeNearLow: sa.closeNearLow,
          closeNearHigh: sa.closeNearHigh,
          volumeExpansion: Number(sa.volumeExpansion.toFixed(2)),
          displacementDetected: true,
        },
      };
    }
  }

  if (strongBullImpulse) {
    const snapback = isBear(b) && b.close < a.close && b.close > a.open;
    const heldReclaim = mid != null ? b.close > mid || c.close > mid : true;
    const release = isBull(c) && c.close > b.high;

    if (snapback) {
      return {
        setupType: "DISPLACEMENT_RETEST",
        direction: "LONG",
        behavior: "MOMENTUM_CONTINUATION",
        stage: release ? "CONFIRMED" : "CONFIRMING",
        signalBarTime: a.time,
        confirmBarTime: c.time,
        confirmed: release,
        reasonCodes: [
          "BULLISH_DISPLACEMENT",
          "RANGE_EXPANSION_STRONG",
          "BODY_VELOCITY_STRONG",
          "FAST_RETEST_INTO_ZONE",
          heldReclaim ? "HELD_RECLAIM_ZONE" : "RETEST_IN_PROGRESS",
          release ? "RELEASE_UP_CONFIRMED" : "WAITING_FOR_RELEASE",
        ],
        triggerNow: release,
        entryHint: b.high,
        invalidateLevel: Math.min(a.low, b.low),
        candleQuality: {
          signalBarTime: a.time,
          direction: "LONG",
          range: Number(sa.range.toFixed(2)),
          atr14: Number(atr14.toFixed(2)),
          rangeExpansion: Number(sa.rangeExpansion.toFixed(2)),
          bodySize: Number(sa.bodySize.toFixed(2)),
          bodyPercent: Number(sa.bodyPercent.toFixed(2)),
          closeNearLow: sa.closeNearLow,
          closeNearHigh: sa.closeNearHigh,
          volumeExpansion: Number(sa.volumeExpansion.toFixed(2)),
          displacementDetected: true,
        },
      };
    }
  }

  return null;
}

export function detectUpperRejection({ bars10m, atr14, avgVol20, zone }) {
  const { b, c, posB } = detectPatternContext({ bars10m, zone });
  if (!b || !c || posB == null) return null;

  const sb = candleStats(b, atr14, avgVol20);
  const sc = candleStats(c, atr14, avgVol20);

  const rejectionBar =
    posB >= 0.66 &&
    upperWickPct(b) >= 0.25 &&
    isBear(b);

  const confirmation =
    isBear(c) &&
    c.close < b.low &&
    sc.rangeExpansion >= THRESHOLDS.confirmation.range &&
    sc.bodyPercent >= THRESHOLDS.confirmation.body;

  if (!rejectionBar) return null;

  return {
    setupType: "UPPER_REJECTION",
    direction: "SHORT",
    behavior: "REVERSAL",
    stage: confirmation ? "CONFIRMED" : "CONFIRMING",
    signalBarTime: b.time,
    confirmBarTime: c.time,
    confirmed: confirmation,
    reasonCodes: [
      "UPPER_ZONE_TEST",
      "SELLER_REJECTION",
      "BEARISH_CONTROL_CANDLE",
      confirmation ? "SECOND_CANDLE_CONFIRM" : "WAITING_SECOND_CANDLE_CONFIRM",
      sc.rangeExpansion >= THRESHOLDS.confirmation.range ? "RANGE_EXPANSION_STRONG" : "RANGE_EXPANSION_WEAK",
      sc.bodyPercent >= THRESHOLDS.confirmation.body ? "BODY_VELOCITY_STRONG" : "BODY_VELOCITY_WEAK",
    ],
    triggerNow: confirmation,
    entryHint: b.low,
    invalidateLevel: Math.max(b.high, c.high),
    candleQuality: {
      signalBarTime: c.time,
      direction: "SHORT",
      range: Number(sc.range.toFixed(2)),
      atr14: Number(atr14.toFixed(2)),
      rangeExpansion: Number(sc.rangeExpansion.toFixed(2)),
      bodySize: Number(sc.bodySize.toFixed(2)),
      bodyPercent: Number(sc.bodyPercent.toFixed(2)),
      closeNearLow: sc.closeNearLow,
      closeNearHigh: sc.closeNearHigh,
      volumeExpansion: Number(sc.volumeExpansion.toFixed(2)),
      displacementDetected: false,
    },
  };
}

export function detectLowerRejection({ bars10m, atr14, avgVol20, zone }) {
  const { b, c, posB } = detectPatternContext({ bars10m, zone });
  if (!b || !c || posB == null) return null;

  const sb = candleStats(b, atr14, avgVol20);
  const sc = candleStats(c, atr14, avgVol20);

  const rejectionBar =
    posB <= 0.34 &&
    lowerWickPct(b) >= 0.25 &&
    isBull(b);

  const confirmation =
    isBull(c) &&
    c.close > b.high &&
    sc.rangeExpansion >= THRESHOLDS.confirmation.range &&
    sc.bodyPercent >= THRESHOLDS.confirmation.body;

  if (!rejectionBar) return null;

  return {
    setupType: "LOWER_REJECTION",
    direction: "LONG",
    behavior: "REVERSAL",
    stage: confirmation ? "CONFIRMED" : "CONFIRMING",
    signalBarTime: b.time,
    confirmBarTime: c.time,
    confirmed: confirmation,
    reasonCodes: [
      "LOWER_ZONE_TEST",
      "BUYER_REJECTION",
      "BULLISH_CONTROL_CANDLE",
      confirmation ? "SECOND_CANDLE_CONFIRM" : "WAITING_SECOND_CANDLE_CONFIRM",
      sc.rangeExpansion >= THRESHOLDS.confirmation.range ? "RANGE_EXPANSION_STRONG" : "RANGE_EXPANSION_WEAK",
      sc.bodyPercent >= THRESHOLDS.confirmation.body ? "BODY_VELOCITY_STRONG" : "BODY_VELOCITY_WEAK",
    ],
    triggerNow: confirmation,
    entryHint: b.high,
    invalidateLevel: Math.min(b.low, c.low),
    candleQuality: {
      signalBarTime: c.time,
      direction: "LONG",
      range: Number(sc.range.toFixed(2)),
      atr14: Number(atr14.toFixed(2)),
      rangeExpansion: Number(sc.rangeExpansion.toFixed(2)),
      bodySize: Number(sc.bodySize.toFixed(2)),
      bodyPercent: Number(sc.bodyPercent.toFixed(2)),
      closeNearLow: sc.closeNearLow,
      closeNearHigh: sc.closeNearHigh,
      volumeExpansion: Number(sc.volumeExpansion.toFixed(2)),
      displacementDetected: false,
    },
  };
}

export function detectFailure({ bars10m, atr14, avgVol20, zone }) {
  const { b, c, zoneMid: mid } = detectPatternContext({ bars10m, zone });
  if (!b || !c || mid == null) return null;

  const sc = candleStats(c, atr14, avgVol20);

  const reclaimAttemptFailed =
    b.close >= mid &&
    c.close < mid &&
    isBear(c);

  if (!reclaimAttemptFailed) return null;

  return {
    setupType: "FAILURE",
    direction: "SHORT",
    behavior: "CONTINUATION",
    stage: "CONFIRMED",
    signalBarTime: b.time,
    confirmBarTime: c.time,
    confirmed: true,
    reasonCodes: [
      "FAILED_RECLAIM",
      "SELLER_CONTROL",
      "CONTINUATION_RELEASE",
      sc.rangeExpansion >= THRESHOLDS.confirmation.range ? "RANGE_EXPANSION_STRONG" : "RANGE_EXPANSION_WEAK",
      sc.bodyPercent >= THRESHOLDS.confirmation.body ? "BODY_VELOCITY_STRONG" : "BODY_VELOCITY_WEAK",
    ],
    triggerNow: true,
    entryHint: c.low,
    invalidateLevel: Math.max(b.high, c.high),
    candleQuality: {
      signalBarTime: c.time,
      direction: "SHORT",
      range: Number(sc.range.toFixed(2)),
      atr14: Number(atr14.toFixed(2)),
      rangeExpansion: Number(sc.rangeExpansion.toFixed(2)),
      bodySize: Number(sc.bodySize.toFixed(2)),
      bodyPercent: Number(sc.bodyPercent.toFixed(2)),
      closeNearLow: sc.closeNearLow,
      closeNearHigh: sc.closeNearHigh,
      volumeExpansion: Number(sc.volumeExpansion.toFixed(2)),
      displacementDetected: false,
    },
  };
}

export function detectAcceptance({ bars10m, atr14, avgVol20, zone }) {
  const { b, c, zoneMid: mid } = detectPatternContext({ bars10m, zone });
  if (!b || !c || mid == null) return null;

  const sc = candleStats(c, atr14, avgVol20);

  const holdAndContinue =
    b.close <= mid &&
    c.close > mid &&
    isBull(c);

  if (!holdAndContinue) return null;

  return {
    setupType: "ACCEPTANCE",
    direction: "LONG",
    behavior: "CONTINUATION",
    stage: "CONFIRMED",
    signalBarTime: b.time,
    confirmBarTime: c.time,
    confirmed: true,
    reasonCodes: [
      "HOLDING_ABOVE_MID",
      "BUYER_CONTROL",
      "CONTINUATION_BREAK",
      sc.rangeExpansion >= THRESHOLDS.confirmation.range ? "RANGE_EXPANSION_STRONG" : "RANGE_EXPANSION_WEAK",
      sc.bodyPercent >= THRESHOLDS.confirmation.body ? "BODY_VELOCITY_STRONG" : "BODY_VELOCITY_WEAK",
    ],
    triggerNow: true,
    entryHint: c.high,
    invalidateLevel: Math.min(b.low, c.low),
    candleQuality: {
      signalBarTime: c.time,
      direction: "LONG",
      range: Number(sc.range.toFixed(2)),
      atr14: Number(atr14.toFixed(2)),
      rangeExpansion: Number(sc.rangeExpansion.toFixed(2)),
      bodySize: Number(sc.bodySize.toFixed(2)),
      bodyPercent: Number(sc.bodyPercent.toFixed(2)),
      closeNearLow: sc.closeNearLow,
      closeNearHigh: sc.closeNearHigh,
      volumeExpansion: Number(sc.volumeExpansion.toFixed(2)),
      displacementDetected: false,
    },
  };
}
