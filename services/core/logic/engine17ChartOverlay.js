// services/core/logic/engine17ChartOverlay.js
//
// Engine 17 — Chart Overlay / Visual Debug Engine
//
// Produces chart overlay payload for frontend drawing
//
// Updated for:
// - prepBias passthrough
// - executionBias passthrough
// - nextFocus passthrough
// - market alignment passthrough
// - scalp 10m / 30m overall passthrough

import path from "path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";

import { computeMorningFib } from "./engine16MorningFib.js";

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

async function readNegotiatedZones() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const filePath = path.join(__dirname, "../data/smz-levels.json");
    const txt = await readFile(filePath, "utf8");

    const parsed = JSON.parse(txt);

    const zones = Array.isArray(parsed?.structures_sticky)
      ? parsed.structures_sticky
      : [];

    return zones
      .filter((z) => String(z?.structureKey || z?.id || "").includes("|NEG|"))
      .map((z) => {
        const pr = Array.isArray(z?.priceRange)
          ? z.priceRange
          : Array.isArray(z?.manualRange)
          ? z.manualRange
          : null;

        if (!pr || pr.length < 2) return null;

        const lo = Math.min(Number(pr[0]), Number(pr[1]));
        const hi = Math.max(Number(pr[0]), Number(pr[1]));

        return {
          id: z.structureKey || z.id || null,
          kind: "NEGOTIATED",
          lo: round2(lo),
          hi: round2(hi),
          mid: round2((lo + hi) / 2),
          label: "Negotiated Zone",
          style: {
            variant: "negotiated_zone",
          },
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeSignalLabel(kind) {
  return String(kind || "")
    .replaceAll("_", " ")
    .trim();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function computeChartOverlay({ symbol = "SPY", tf = "30m" } = {}) {
  const missingSections = [];
  const sourceEnginesUsed = [];

  let fibResult = null;

  try {
    fibResult = await computeMorningFib({ symbol, tf });
    sourceEnginesUsed.push("ENGINE16");
  } catch {
    missingSections.push("fib");
  }

  if (!fibResult || fibResult.ok === false) {
    if (!missingSections.includes("fib")) missingSections.push("fib");
  }

  const zones = await readNegotiatedZones();

  if (zones.length) {
    sourceEnginesUsed.push("ENGINE1");
  } else {
    if (!missingSections.includes("zones")) missingSections.push("zones");
  }

  if (!fibResult || fibResult.ok === false) {
    return {
      ok: false,
      error: "OVERLAY_DATA_UNAVAILABLE",
      zones,
      meta: {
        symbol,
        timeframe: tf,
        generatedAtUtc: new Date().toISOString(),
        sourceEnginesUsed,
        missingSections,
      },
    };
  }

  const anchors = [
    {
      kind: "PREMARKET_LOW",
      price: fibResult.anchors?.premarketLow,
      label: "PM Low",
    },
    {
      kind: "PREMARKET_HIGH",
      price: fibResult.anchors?.premarketHigh,
      label: "PM High",
    },
    {
      kind: "SESSION_HIGH",
      price: fibResult.anchors?.sessionHigh,
      label: "Session High",
    },
    {
      kind: "SESSION_LOW",
      price: fibResult.anchors?.sessionLow,
      label: "Session Low",
    },
    {
      kind: "FIB_ANCHOR_A",
      price: fibResult.anchors?.anchorA,
      label: "Fib A",
    },
    {
      kind: "FIB_ANCHOR_B",
      price: fibResult.anchors?.anchorB,
      label: "Fib B",
    },
  ].filter((a) => Number.isFinite(a?.price));

  const fibOverlay = {
    context: fibResult.context,

    anchorA: fibResult.anchors?.anchorA,
    anchorB: fibResult.anchors?.anchorB,

    anchors: {
      premarketLow: fibResult.anchors?.premarketLow,
      premarketHigh: fibResult.anchors?.premarketHigh,
      sessionHigh: fibResult.anchors?.sessionHigh,
      sessionLow: fibResult.anchors?.sessionLow,
      anchorA: fibResult.anchors?.anchorA,
      anchorB: fibResult.anchors?.anchorB,

      premarketLowTime: fibResult.anchors?.premarketLowTime || null,
      premarketHighTime: fibResult.anchors?.premarketHighTime || null,
      sessionHighTime: fibResult.anchors?.sessionHighTime || null,
      sessionLowTime: fibResult.anchors?.sessionLowTime || null,
      anchorATime: fibResult.anchors?.anchorATime || null,
      anchorBTime: fibResult.anchors?.anchorBTime || null,
    },

    levels: fibResult.fib,
    primaryZone: fibResult.pullbackZone,
    secondaryZone: fibResult.secondaryZone,

    state: fibResult.state,
    strategyType: fibResult.strategyType || "NONE",
    readinessLabel: fibResult.readinessLabel || "NO_SETUP",

    prepBias: fibResult.prepBias || "NONE",
    executionBias: fibResult.executionBias || "NONE",
    nextFocus: fibResult.nextFocus || "WAIT",

    waveContext: fibResult.waveContext || {},
    waveState:
      fibResult.waveContext?.waveState ||
      fibResult.waveState ||
      "UNKNOWN",
    macroBias:
      fibResult.waveContext?.macroBias ||
      fibResult.macroBias ||
      "NONE",

    signalTimes: fibResult.signalTimes || {},

    exhaustionDetected: !!fibResult.exhaustionDetected,
    exhaustionShort: !!fibResult.exhaustionShort,
    exhaustionLong: !!fibResult.exhaustionLong,
    exhaustionBarTime: fibResult.exhaustionBarTime || null,
    exhaustionBarPrice: Number.isFinite(fibResult.exhaustionBarPrice)
      ? fibResult.exhaustionBarPrice
      : null,
    exhaustionActive: !!fibResult.exhaustionActive,

    exhaustionEarly: !!fibResult.exhaustionEarly,
    exhaustionEarlyShort: !!fibResult.exhaustionEarlyShort,
    exhaustionEarlyLong: !!fibResult.exhaustionEarlyLong,

    exhaustionTrigger: !!fibResult.exhaustionTrigger,
    exhaustionTriggerShort: !!fibResult.exhaustionTriggerShort,
    exhaustionTriggerLong: !!fibResult.exhaustionTriggerLong,

    impulseVolumeConfirmed: !!fibResult.impulseVolumeConfirmed,
    volumeContext: fibResult.volumeContext || {},

    marketAlignment10Score: toNum(fibResult.marketAlignment10Score),
    marketAlignment30Score: toNum(fibResult.marketAlignment30Score),
    marketAlignment10State: fibResult.marketAlignment10State || "—",
    marketAlignment30State: fibResult.marketAlignment30State || "—",

    scalpOverall10: toNum(fibResult.scalpOverall10),
    scalpOverall30: toNum(fibResult.scalpOverall30),
  };

  const signals = [];

  if (fibResult.exhaustionTrigger === true && fibResult.exhaustionActive) {
    signals.push({
      kind: fibResult.exhaustionTriggerShort
        ? "EXHAUSTION_TRIGGER_SHORT"
        : fibResult.exhaustionTriggerLong
        ? "EXHAUSTION_TRIGGER_LONG"
        : "EXHAUSTION_TRIGGER",
      price: Number.isFinite(fibResult.exhaustionBarPrice)
        ? fibResult.exhaustionBarPrice
        : fibResult.anchors?.anchorB,
      label: fibResult.exhaustionTriggerShort
        ? "Exhaustion Trigger Short"
        : fibResult.exhaustionTriggerLong
        ? "Exhaustion Trigger Long"
        : "Exhaustion Trigger",
      severity: "high",
      time:
        fibResult.signalTimes?.exhaustionTriggerTime ||
        fibResult.signalTimes?.exhaustionTime ||
        fibResult.exhaustionBarTime ||
        null,
    });
  } else if (fibResult.exhaustionEarly === true) {
    signals.push({
      kind: fibResult.exhaustionEarlyShort
        ? "EXHAUSTION_EARLY_SHORT"
        : fibResult.exhaustionEarlyLong
        ? "EXHAUSTION_EARLY_LONG"
        : "EXHAUSTION_EARLY",
      price: Number.isFinite(fibResult.exhaustionBarPrice)
        ? fibResult.exhaustionBarPrice
        : fibResult.anchors?.anchorB,
      label: fibResult.exhaustionEarlyShort
        ? "Exhaustion Early Short"
        : fibResult.exhaustionEarlyLong
        ? "Exhaustion Early Long"
        : "Exhaustion Early",
      severity: "medium",
      time: fibResult.signalTimes?.exhaustionEarlyTime || null,
    });
  } else {
    if (fibResult.state) {
      signals.push({
        kind: fibResult.state,
        price: fibResult.anchors?.anchorB,
        label: safeSignalLabel(fibResult.state),
      });
    }

    if (fibResult.impulseVolumeConfirmed) {
      signals.push({
        kind: "IMPULSE_VOLUME_CONFIRMED",
        price: fibResult.anchors?.anchorB,
        label: "Volume Confirmed",
        severity: "info",
      });
    }

    if (fibResult.breakoutReady) {
      signals.push({
        kind: "BREAKOUT_READY",
        price: fibResult.anchors?.sessionHigh,
        label: "Breakout Ready",
      });
    }

    if (fibResult.breakdownReady) {
      signals.push({
        kind: "BREAKDOWN_READY",
        price: fibResult.anchors?.sessionLow,
        label: "Breakdown Ready",
      });
    }
  }

  return {
    ok: true,
    zones,
    fib: fibOverlay,
    anchors,
    dayRange: fibResult.dayRange || {
      currentDayLow: fibResult.anchors?.premarketLow,
      currentDayHigh: fibResult.anchors?.sessionHigh,
      currentDayLowTime: fibResult.anchors?.premarketLowTime || null,
      currentDayHighTime: fibResult.anchors?.sessionHighTime || null,
    },
    sessionStructure: fibResult.sessionStructure || null,
    signals,
    badges: [],
    meta: {
      symbol,
      timeframe: tf,
      generatedAtUtc: new Date().toISOString(),
      sourceEnginesUsed,
      missingSections,
    },
  };
}

export default computeChartOverlay;
