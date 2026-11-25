// services/core/logic/engine14/detectScalpSetup.js

import {
  SETUP_TYPES,
  DIRECTIONS,
  STAGES,
  BEHAVIORS,
  ZONE_BEHAVIOR,
} from "./constants.js";
import {
  atr,
  avgVolume,
  zoneMid,
  zonePos01,
  insideZone,
} from "./normalizeInputs.js";
import { detectCompressionRelease } from "./detectCompressionRelease.js";
import { detectMomentumConflicts } from "./detectMomentumConflicts.js";
import {
  detectAcceptance,
  detectFailure,
  detectUpperRejection,
  detectLowerRejection,
  detectDisplacementRetest,
} from "./detectCandlePatterns.js";
import { scoreScalpSetup } from "./scoreScalpSetup.js";

function pickBestSetup(candidates) {
  const order = [
    "DISPLACEMENT_RETEST",
    "FAILURE",
    "ACCEPTANCE",
    "UPPER_REJECTION",
    "LOWER_REJECTION",
  ];

  for (const type of order) {
    const found = candidates.find((x) => x?.setupType === type);
    if (found) return found;
  }
  return null;
}

function inferZoneBehavior(setupType, direction) {
  if (setupType === "ACCEPTANCE" && direction === "LONG") return ZONE_BEHAVIOR.ACCEPTING_HIGHER;
  if (setupType === "FAILURE" && direction === "SHORT") return ZONE_BEHAVIOR.ACCEPTING_LOWER;
  if (setupType === "UPPER_REJECTION") return ZONE_BEHAVIOR.REJECTING_HIGH;
  if (setupType === "LOWER_REJECTION") return ZONE_BEHAVIOR.REJECTING_LOW;
  if (setupType === "DISPLACEMENT_RETEST") return ZONE_BEHAVIOR.DISPLACEMENT;
  if (setupType === "LOWER_ACCEPTANCE_TREND") return ZONE_BEHAVIOR.ACCEPTING_LOWER;
  if (setupType === "HIGHER_ACCEPTANCE_TREND") return ZONE_BEHAVIOR.ACCEPTING_HIGHER;
  return ZONE_BEHAVIOR.NONE;
}

function buildTrendContinuationSetup({
  price,
  zone,
  smi10m,
  smi1h,
  engine4,
  bars10m,
  atr14,
  avgVol20,
}) {
  const lastBar = Array.isArray(bars10m) && bars10m.length ? bars10m[bars10m.length - 1] : null;
  const prevBar = Array.isArray(bars10m) && bars10m.length > 1 ? bars10m[bars10m.length - 2] : null;

  const zoneLo = Number(zone?.lo);
  const zoneHi = Number(zone?.hi);
  const zoneMidValue = zoneMid(zone);

  const lastClose = Number(lastBar?.close ?? price);
  const lastOpen = Number(lastBar?.open ?? price);
  const lastHigh = Number(lastBar?.high ?? price);
  const lastLow = Number(lastBar?.low ?? price);
  const lastVolume = Number(lastBar?.volume ?? 0);

  const range = Math.max(0, lastHigh - lastLow);
  const bodySize = Math.abs(lastClose - lastOpen);
  const bodyPercent = range > 0 ? bodySize / range : 0;
  const rangeExpansion = atr14 > 0 ? range / atr14 : 0;
  const volumeExpansion = avgVol20 > 0 ? lastVolume / avgVol20 : 0;

  const closeNearLow = range > 0 ? (lastClose - lastLow) / range <= 0.25 : false;
  const closeNearHigh = range > 0 ? (lastHigh - lastClose) / range <= 0.25 : false;

  const prevClose = Number(prevBar?.close ?? NaN);

  const flags = engine4?.flags || {};
  const pressureBias = String(engine4?.pressureBias || "");

  const shortTrend =
    Number.isFinite(zoneLo) &&
    lastClose < zoneLo &&
    smi10m?.direction === "DOWN" &&
    smi1h?.direction === "DOWN" &&
    (
      pressureBias.includes("BEARISH") ||
      flags.initiativeMoveConfirmed ||
      flags.reversalExpansion ||
      flags.distributionDetected
    );

  if (shortTrend) {
    return {
      setupType: "LOWER_ACCEPTANCE_TREND",
      direction: "SHORT",
      behavior: "TREND_CONTINUATION",
      stage: "CONFIRMED",
      signalBarTime: lastBar?.time || null,
      confirmBarTime: lastBar?.time || null,
      confirmed: true,
      reasonCodes: [
        "PRICE_BELOW_ZONE",
        "ACCEPTING_LOWER",
        "TREND_CONTINUATION_SHORT",
        "SMI_10M_SUPPORTIVE",
        "SMI_1H_SUPPORTIVE",
        flags.initiativeMoveConfirmed ? "E4_INITIATIVE_CONTINUATION" : null,
        flags.reversalExpansion ? "E4_REVERSAL_EXPANSION" : null,
        flags.distributionDetected ? "E4_DISTRIBUTION" : null,
      ].filter(Boolean),
      triggerNow: false,
      entryHint: lastClose,
      invalidateLevel: Number.isFinite(zoneMidValue) ? zoneMidValue : zoneHi,
      candleQuality: {
        signalBarTime: lastBar?.time || null,
        direction: "SHORT",
        range: Number(range.toFixed(2)),
        atr14: Number(atr14.toFixed(2)),
        rangeExpansion: Number(rangeExpansion.toFixed(2)),
        bodySize: Number(bodySize.toFixed(2)),
        bodyPercent: Number(bodyPercent.toFixed(2)),
        closeNearLow,
        closeNearHigh,
        volumeExpansion: Number(volumeExpansion.toFixed(2)),
        displacementDetected: false,
      },
      trendState: {
        active: true,
        type: "LOWER_ACCEPTANCE_TREND",
        triggerable: false,
      },
    };
  }

  const longTrend =
    Number.isFinite(zoneHi) &&
    lastClose > zoneHi &&
    smi10m?.direction === "UP" &&
    smi1h?.direction === "UP" &&
    (
      pressureBias.includes("BULLISH") ||
      pressureBias.includes("CONSTRUCTIVE") ||
      flags.initiativeMoveConfirmed ||
      flags.reversalExpansion ||
      flags.absorptionDetected
    );

  if (longTrend) {
    return {
      setupType: "HIGHER_ACCEPTANCE_TREND",
      direction: "LONG",
      behavior: "TREND_CONTINUATION",
      stage: "CONFIRMED",
      signalBarTime: lastBar?.time || null,
      confirmBarTime: lastBar?.time || null,
      confirmed: true,
      reasonCodes: [
        "PRICE_ABOVE_ZONE",
        "ACCEPTING_HIGHER",
        "TREND_CONTINUATION_LONG",
        "SMI_10M_SUPPORTIVE",
        "SMI_1H_SUPPORTIVE",
        flags.initiativeMoveConfirmed ? "E4_INITIATIVE_CONTINUATION" : null,
        flags.reversalExpansion ? "E4_REVERSAL_EXPANSION" : null,
        flags.absorptionDetected ? "E4_ABSORPTION" : null,
      ].filter(Boolean),
      triggerNow: false,
      entryHint: lastClose,
      invalidateLevel: Number.isFinite(zoneMidValue) ? zoneMidValue : zoneLo,
      candleQuality: {
        signalBarTime: lastBar?.time || null,
        direction: "LONG",
        range: Number(range.toFixed(2)),
        atr14: Number(atr14.toFixed(2)),
        rangeExpansion: Number(rangeExpansion.toFixed(2)),
        bodySize: Number(bodySize.toFixed(2)),
        bodyPercent: Number(bodyPercent.toFixed(2)),
        closeNearLow,
        closeNearHigh,
        volumeExpansion: Number(volumeExpansion.toFixed(2)),
        displacementDetected: false,
      },
      trendState: {
        active: true,
        type: "HIGHER_ACCEPTANCE_TREND",
        triggerable: false,
      },
    };
  }

  return null;
}

function buildNoSetupResponse({
  symbol,
  zone,
  zoneMidValue,
  zonePos,
  priceState,
  momentum,
  compression,
}) {
  return {
    ok: true,
    symbol,
    labState: {
      active: true,
      version: "engine14_v1",
      advisoryOnly: true,
    },
    zone: {
      ...zone,
      mid: zoneMidValue,
      zonePos01: zonePos,
    },
    price: priceState,
    setup: {
      detected: false,
      setupType: SETUP_TYPES.NONE,
      direction: DIRECTIONS.NONE,
      behavior: BEHAVIORS.NONE,
      stage: STAGES.NONE,
      confidence: 0,
      quality: "D",
      triggerNow: false,
      needsConfirmation: false,
      reasonCodes: [],
    },
    candlePattern: {
      firstSignalBarTime: null,
      confirmBarTime: null,
      confirmed: false,
      barsAgo: null,
    },
    momentum: {
      ...momentum,
      compression,
      conflict: {
        present: false,
        penalty: 0,
        reasonCodes: [],
        level: "NONE",
      },
    },
  };
}

export function detectScalpSetup({
  symbol,
  bars10m,
  bars1h,
  zone,
  price,
  engine3,
  engine4,
  momentum,
}) {
  const atr14 = atr(bars10m, 14);
  const avgVol20 = avgVolume(bars10m, 20);

  const smi10m = momentum?.smi10m || {};
  const smi1h = momentum?.smi1h || {};
  const compression =
    momentum?.compression || detectCompressionRelease(momentum?.smiSeries10m || []);

  const candidates = [
    detectDisplacementRetest({ bars10m, atr14, avgVol20, zone }),
    detectFailure({ bars10m, atr14, avgVol20, zone }),
    detectAcceptance({ bars10m, atr14, avgVol20, zone }),
    detectUpperRejection({ bars10m, atr14, avgVol20, zone }),
    detectLowerRejection({ bars10m, atr14, avgVol20, zone }),
  ].filter(Boolean);

  let rawSetup = pickBestSetup(candidates);

  const zoneMidValue = zoneMid(zone);
  const zonePos = zonePos01(price, zone);
  const priceState = {
    last: price,
    insideZone: insideZone(price, zone),
    aboveMid: zoneMidValue != null ? price > zoneMidValue : false,
    belowMid: zoneMidValue != null ? price < zoneMidValue : false,
  };

  if (!rawSetup) {
    rawSetup = buildTrendContinuationSetup({
      price,
      zone,
      smi10m,
      smi1h,
      engine4,
      bars10m,
      atr14,
      avgVol20,
    });
  }

  if (!rawSetup) {
    return buildNoSetupResponse({
      symbol,
      zone,
      zoneMidValue,
      zonePos,
      priceState,
      momentum,
      compression,
    });
  }

  const conflicts = detectMomentumConflicts({
    direction: rawSetup.direction,
    smi10m,
    smi1h,
    compression,
  });

  const scored = scoreScalpSetup({
    setup: rawSetup,
    zone: { ...zone, zonePos01: zonePos },
    price,
    engine3,
    engine4,
    smi10m,
    smi1h,
    compression,
    conflicts,
  });

  return {
    ok: true,
    symbol,
    labState: {
      active: true,
      version: "engine14_v1",
      advisoryOnly: true,
    },
    zone: {
      ...zone,
      mid: zoneMidValue,
      zonePos01: zonePos,
    },
    price: priceState,
    engine3: {
      stage: engine3?.stage || "UNKNOWN",
      armed: Boolean(engine3?.armed),
      reactionScore: Number(engine3?.reactionScore || 0),
      structureState: engine3?.structureState || "UNKNOWN",
      controlCandle: engine3?.controlCandle || "UNKNOWN",
    },
    engine4: {
      volumeScore: Number(engine4?.volumeScore || 0),
      pressureBias: engine4?.pressureBias || "UNKNOWN",
      flags: engine4?.flags || {},
    },
    momentum: {
      ...momentum,
      compression,
      conflict: conflicts,
    },
    setup: {
      detected: true,
      setupType: rawSetup.setupType,
      direction: rawSetup.direction,
      behavior: rawSetup.behavior,
      zoneBehavior: inferZoneBehavior(rawSetup.setupType, rawSetup.direction),
      stage: rawSetup.stage,
      confidence: scored.confidence,
      quality: scored.quality,
      entryHint: rawSetup.entryHint,
      invalidateLevel: rawSetup.invalidateLevel,
      triggerNow: Boolean(rawSetup.triggerNow),
      needsConfirmation: rawSetup.stage !== "CONFIRMED",
      triggerWindowBars: rawSetup.setupType === "DISPLACEMENT_RETEST" ? 3 : 2,
      reasonCodes: scored.reasonCodes,
      trendState: rawSetup.trendState || {
        active: false,
        type: null,
        triggerable: true,
      },
    },
    candleQuality: rawSetup.candleQuality || null,
    candlePattern: {
      firstSignalBarTime: rawSetup.signalBarTime || null,
      confirmBarTime: rawSetup.confirmBarTime || null,
      confirmed: Boolean(rawSetup.confirmed),
      barsAgo: 0,
    },
  };
}
