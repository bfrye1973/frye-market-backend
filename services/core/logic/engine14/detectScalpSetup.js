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
  return ZONE_BEHAVIOR.NONE;
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
  const compression = momentum?.compression || detectCompressionRelease(momentum?.smiSeries10m || []);

  const candidates = [
    detectDisplacementRetest({ bars10m, atr14, avgVol20, zone }),
    detectFailure({ bars10m, atr14, avgVol20, zone }),
    detectAcceptance({ bars10m, atr14, avgVol20, zone }),
    detectUpperRejection({ bars10m, atr14, avgVol20, zone }),
    detectLowerRejection({ bars10m, atr14, avgVol20, zone }),
  ].filter(Boolean);

  const rawSetup = pickBestSetup(candidates);

  const zoneMidValue = zoneMid(zone);
  const zonePos = zonePos01(price, zone);
  const priceState = {
    last: price,
    insideZone: insideZone(price, zone),
    aboveMid: zoneMidValue != null ? price > zoneMidValue : false,
    belowMid: zoneMidValue != null ? price < zoneMidValue : false,
  };

  if (!rawSetup) {
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
