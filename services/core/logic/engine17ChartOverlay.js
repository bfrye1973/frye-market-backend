// services/core/logic/engine17ChartOverlay.js
//
// Engine 17 — Chart Overlay / Visual Debug Engine
//
// Consumes:
//   Engine 16 (Morning Fib)
//   Engine 1 negotiated zones
//
// Produces:
//   Chart overlay payload for frontend drawing
//

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

    const negotiated = zones
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

    return negotiated;
  } catch {
    return [];
  }
}

function safeSignalLabel(kind) {
  return String(kind || "")
    .replaceAll("_", " ")
    .trim();
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

    usedNegotiatedZoneAnchor: fibResult.usedNegotiatedZoneAnchor,
    negotiatedZoneUsed: fibResult.negotiatedZoneUsed || null,

    state: fibResult.state,
    insidePrimaryZone: !!fibResult.insidePrimaryZone,
    insideSecondaryZone: !!fibResult.insideSecondaryZone,
    invalidated: !!fibResult.invalidated,

    wickRejectionLong: !!fibResult.wickRejectionLong,
    wickRejectionShort: !!fibResult.wickRejectionShort,

    hasPulledBack: !!fibResult.hasPulledBack,
    breakoutReady: !!fibResult.breakoutReady,
    breakdownReady: !!fibResult.breakdownReady,

    strategyType: fibResult.strategyType || "NONE",
    readinessLabel: fibResult.readinessLabel || "NO_SETUP",
    failedBreakout: !!fibResult.failedBreakout,
    failedBreakdown: !!fibResult.failedBreakdown,
    reversalDetected: !!fibResult.reversalDetected,
    trendContinuation: !!fibResult.trendContinuation,

    exhaustionDetected: !!fibResult.exhaustionDetected,
    exhaustionShort: !!fibResult.exhaustionShort,
    exhaustionLong: !!fibResult.exhaustionLong,
    exhaustionBarTime: fibResult.exhaustionBarTime || null,
    exhaustionBarPrice: Number.isFinite(fibResult.exhaustionBarPrice)
      ? fibResult.exhaustionBarPrice
      : null,
    exhaustionLookbackBars: Number.isFinite(fibResult.exhaustionLookbackBars)
      ? fibResult.exhaustionLookbackBars
      : null,
    exhaustionActive: !!fibResult.exhaustionActive,

    impulseVolumeConfirmed: !!fibResult.impulseVolumeConfirmed,
    volumeContext: fibResult.volumeContext || {
      volumeScore: 0,
      volumeConfirmed: false,
      volumeRegime: "UNKNOWN",
      pressureBias: "NEUTRAL_PRESSURE",
      flowSummary: [],
    },
  };

  const signals = [];

  if (fibResult.exhaustionDetected && fibResult.exhaustionActive) {
    signals.push({
      kind: fibResult.exhaustionShort
        ? "EXHAUSTION_SHORT"
        : fibResult.exhaustionLong
        ? "EXHAUSTION_LONG"
        : "EXHAUSTION",
      price: Number.isFinite(fibResult.exhaustionBarPrice)
        ? fibResult.exhaustionBarPrice
        : fibResult.anchors?.anchorB,
      label: fibResult.exhaustionShort
        ? "Exhaustion Short"
        : fibResult.exhaustionLong
        ? "Exhaustion Long"
        : "Exhaustion",
      severity: "high",
      time: fibResult.signalTimes?.exhaustionTime || fibResult.exhaustionBarTime || null,
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

  const badges = [
    { kind: "CONTEXT", value: fibResult.context },
    { kind: "STATE", value: fibResult.state },
    {
      kind: "VOLUME",
      value: fibResult.impulseVolumeConfirmed ? "CONFIRMED" : "NORMAL",
    },
  ];

  if (fibResult.strategyType && fibResult.strategyType !== "NONE") {
    badges.unshift({
      kind: "STRATEGY",
      value: fibResult.strategyType,
    });
  }

  if (fibResult.readinessLabel && fibResult.readinessLabel !== "NO_SETUP") {
    badges.unshift({
      kind: "READINESS",
      value: fibResult.readinessLabel,
    });
  }

  if (fibResult.exhaustionDetected && fibResult.exhaustionActive) {
    badges.unshift({
      kind: fibResult.exhaustionShort
        ? "EXHAUSTION_READY_SHORT"
        : "EXHAUSTION_READY_LONG",
      value: "EXHAUSTION READY",
    });
  }

  return {
    ok: true,
    zones,
    fib: fibOverlay,
    anchors,
    dayRange: {
      currentDayLow: fibResult.anchors?.premarketLow,
      currentDayHigh: fibResult.anchors?.sessionHigh,
      currentDayLowTime: fibResult.anchors?.premarketLowTime || null,
      currentDayHighTime: fibResult.anchors?.sessionHighTime || null,
    },
    signals,
    badges,
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
