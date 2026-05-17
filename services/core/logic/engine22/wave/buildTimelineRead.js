// services/core/logic/engine22/wave/buildTimelineRead.js
// Engine 22G — Timeline Read Builder
//
// Purpose:
// Convert Engine 22 / Engine 22G read-only context into one frontend-ready timeline object.
// This lets Engine 17 render engine22Scalp.timelineRead directly.
// No trade decisions. No readiness changes. No live execution.

function fmt(x, fallback = "—") {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(2) : fallback;
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).replaceAll("_", " ");
}

function lineList(xs = []) {
  return Array.isArray(xs) ? xs.filter(Boolean) : [];
}

function wavePhase(waveFibState, degree) {
  const raw = waveFibState?.degrees?.[degree]?.phase || "UNKNOWN";
  return String(raw).replace(/^IN_/, "").replaceAll("_", " ");
}

function buildWaveStack(waveFibState) {
  return {
    primary: wavePhase(waveFibState, "primary"),
    intermediate: wavePhase(waveFibState, "intermediate"),
    minor: wavePhase(waveFibState, "minor"),
    minute: wavePhase(waveFibState, "minute"),
    micro: wavePhase(waveFibState, "micro"),
  };
}

function buildWaveStackText(waveStack) {
  return `Primary ${waveStack.primary || "—"} | Intermediate ${
    waveStack.intermediate || "—"
  } | Minor ${waveStack.minor || "—"} | Minute ${
    waveStack.minute || "—"
  } | Micro ${waveStack.micro || "—"}`;
}

function buildLayerSection(title, layer, fallback = `${title}: unavailable`) {
  if (!layer || typeof layer !== "object") {
    return {
      title,
      severity: "neutral",
      lines: [fallback],
    };
  }

  const close = layer.close ?? layer.price ?? layer.currentPrice ?? null;
  const ema10 = layer.ema10 ?? layer.ema10Value ?? null;
  const ema20 = layer.ema20 ?? layer.ema20Value ?? null;
  const state = layer.state || layer.trendState || layer.structureState || "UNKNOWN";
  const score = layer.score ?? layer.layerScore ?? null;

  const lines = [
    close != null || ema10 != null || ema20 != null
      ? `Price ${fmt(close)} | EMA10 ${fmt(ema10)}${
          ema20 != null ? ` | EMA20 ${fmt(ema20)}` : ""
        }`
      : null,
    `State: ${text(state)}`,
    score != null ? `Score: ${Number(score).toFixed(1)}` : null,
    layer.dipBuyPermission === true ? "Permission: ON" : null,
    layer.dipBuyPermission === false ? "Permission: OFF" : null,
  ];

  return {
    title,
    severity:
      String(state).toUpperCase().includes("BELOW") ||
      String(state).toUpperCase().includes("LOST")
        ? "warning"
        : "neutral",
    lines: lineList(lines),
  };
}

function buildRegimeSections(regimeLayers) {
  const layers = regimeLayers || {};

  return [
    buildLayerSection(
      "10m Trigger Layer",
      layers.tenMinute || layers.trigger10m || null,
      "10m Trigger Layer: unavailable"
    ),
    buildLayerSection(
      "1H Pullback Layer",
      layers.oneHour || layers.pullback1h || null,
      "1H Pullback Layer: unavailable"
    ),
    buildLayerSection(
      "4H Trend Layer",
      layers.fourHour || layers.trend4h || null,
      "4H Trend Layer: unavailable"
    ),
    buildLayerSection(
      "EOD Regime Layer",
      layers.eod || layers.regimeEod || null,
      "EOD Regime Layer: unavailable"
    ),
  ];
}

function buildReactionSection(reactionContext) {
  if (!reactionContext) {
    return {
      title: "Engine 3 Reaction",
      severity: "neutral",
      lines: ["Reaction context unavailable"],
    };
  }

  const state = reactionContext.state || reactionContext.structureState || "UNKNOWN";
  const quality = reactionContext.quality || reactionContext.reactionQuality || "UNKNOWN";
  const score = reactionContext.score ?? reactionContext.reactionScore ?? null;
  const direction = reactionContext.direction || "NEUTRAL";

  return {
    title: "Engine 3 Reaction",
    severity:
      String(quality).toUpperCase().includes("WEAK") ||
      String(state).toUpperCase().includes("FAIL")
        ? "warning"
        : "neutral",
    lines: lineList([
      `${text(state)} — ${text(quality)}`,
      score != null ? `Score ${score}/100` : null,
      `Direction: ${text(direction)}`,
      reactionContext.message || null,
    ]),
  };
}

function buildVolumeSection(volumeContext) {
  if (!volumeContext) {
    return {
      title: "Engine 4 Volume",
      severity: "neutral",
      lines: ["Volume context unavailable"],
    };
  }

  const state = volumeContext.participationState || volumeContext.state || "UNKNOWN";
  const quality = volumeContext.quality || volumeContext.participationQuality || "UNKNOWN";
  const score = volumeContext.score ?? volumeContext.volumeScore ?? null;
  const maxScore = volumeContext.maxScore ?? 15;
  const relVol = volumeContext.relativeVolume;

  return {
    title: "Engine 4 Volume",
    severity: volumeContext.confirmed === true ? "bullish" : "warning",
    lines: lineList([
      `${text(state)} — ${text(quality)}`,
      score != null ? `Score ${score}/${maxScore}` : null,
      relVol != null ? `Relative Volume: ${Number(relVol).toFixed(2)}x` : null,
      volumeContext.confirmed === true
        ? "Participation confirmed"
        : "Participation not confirmed",
      volumeContext.message || null,
    ]),
  };
}

function buildBreakoutSection(breakoutContext) {
  if (!breakoutContext) {
    return {
      title: "Breakout Context",
      severity: "neutral",
      lines: ["Breakout context unavailable"],
    };
  }

  return {
    title: "Breakout Context",
    severity: breakoutContext.chaseAllowed === true ? "bullish" : "warning",
    lines: lineList([
      breakoutContext.label || text(breakoutContext.state, "UNKNOWN"),
      `Action: ${text(breakoutContext.action, "WAIT")}`,
      `Chase allowed: ${breakoutContext.chaseAllowed === true ? "YES" : "NO"}`,
      breakoutContext.summary || null,
    ]),
  };
}

function buildDurationSection(waveDuration) {
  if (!waveDuration || waveDuration.ok === false) {
    return {
      title: "Duration / Time Risk",
      severity: "neutral",
      lines: ["Duration unavailable"],
    };
  }

  const micro = waveDuration?.degrees?.micro || {};
  const barDuration = micro?.barDuration || {};

  const barLine =
    barDuration.reason === "BARS_UNAVAILABLE"
      ? "Bar duration: waiting for bar feed"
      : `Bar state: ${text(micro.maturityStateByBars)} / ${text(micro.timeRiskByBars)}`;

  return {
    title: "Duration / Time Risk",
    severity:
      String(waveDuration.activeTimeRisk || "").toUpperCase().includes("HIGH") ||
      String(waveDuration.activeMaturityState || "").toUpperCase().includes("OVERDUE")
        ? "warning"
        : "neutral",
    lines: lineList([
      `Active duration: ${text(waveDuration.activeDegree)} ${text(waveDuration.activeWave)}`,
      `Clock state: ${text(waveDuration.activeMaturityState)} / ${text(
        waveDuration.activeTimeRisk
      )}`,
      micro.elapsedHours != null
        ? `Micro W4 has been active for ${Number(micro.elapsedHours).toFixed(2)} clock hours.`
        : null,
      barLine,
    ]),
  };
}

function buildDamagedAbcTimeline({
  waveFibState,
  tradeContextSummary,
  regimeLayers,
  reactionContext,
  volumeContext,
  breakoutContext,
}) {
  const abc = waveFibState?.abcCorrection || {};
  const risk = waveFibState?.microW4AbcRisk || {};
  const duration = waveFibState?.waveDuration || {};
  const reads = tradeContextSummary?.reads || {};
  const waveStack = buildWaveStack(waveFibState);
  const waveStackText = buildWaveStackText(waveStack);

  const headline =
    tradeContextSummary?.headline || "MICRO W4 ABC DAMAGED — WAIT FOR RECLAIM";

  const subheadline =
    tradeContextSummary?.subheadline ||
    "No chase long. Micro W5 needs reclaim confirmation.";

  const mainSections = [
    {
      title: "Market Read",
      severity: "danger",
      lines: lineList([
        reads.clusterRead || "SPY hit the first major W5 fib cluster near 745–750.",
        "That cluster caused the current reaction.",
        reads.workingTopRead ||
          `${fmt(risk.topCandidate)}–750 is the working short-term top unless price reclaims.`,
      ]),
    },
    {
      title: "Long-Term Structure",
      severity: "info",
      lines: lineList([
        reads.structureRead ||
          "Long-term structure is still bullish because Primary / Intermediate / Minor / Minute are in W5.",
        "But short-term Micro structure is damaged.",
        reads.nextClusterRead || null,
      ]),
    },
    {
      title: "Micro W4 ABC Correction",
      severity: "danger",
      lines: lineList([
        reads.abcRead ||
          `Micro W4 formed an ABC correction: A = ${fmt(
            abc?.abc?.aLow
          )}, B = ${fmt(abc?.abc?.bHigh)}, C = ${fmt(abc?.abc?.cLow)}.`,
        reads.damageRead ||
          `C is below the 78.6% retrace but still above ${fmt(
            abc?.hardInvalidation
          )} hard invalidation.`,
        abc?.abcStatus ? `Status: ${text(abc.abcStatus)}` : null,
      ]),
    },
    {
      title: "Reclaim Ladder",
      severity: "warning",
      lines: lineList([
        reads.reclaimRead ||
          `Micro W5 is only valid after reclaim: ${abc?.reclaimDisplay || "—"}.`,
      ]),
    },
    {
      title: "Duration / Timing",
      severity: "warning",
      lines: buildDurationSection(duration).lines,
    },
    {
      title: "Invalidation / Short Context",
      severity: "danger",
      lines: lineList([
        reads.invalidationRead ||
          `If ${fmt(abc?.hardInvalidation)} breaks, the Micro impulse is invalidated.`,
        "If that happens, short continuation becomes the focus.",
      ]),
    },
    ...buildRegimeSections(regimeLayers),
    {
      title: "Action / Needs",
      severity: "warning",
      lines: lineList([
        reads.actionRead || "No chase long. Wait for reclaim before Micro W5 trigger.",
        "Only after reclaim should Engine 22 / Engine 15 decide whether setup is READY or GO.",
      ]),
    },
  ];

  const sideSections = [
    buildReactionSection(reactionContext),
    buildVolumeSection(volumeContext),
    buildBreakoutSection(breakoutContext),
    buildDurationSection(duration),
  ];

  return {
    ok: true,
    source: "engine22.timelineRead.v1",
    severity: tradeContextSummary?.severity || "danger",
    headline,
    subheadline,
    waveStack,
    waveStackText,
    mainSections,
    sideSections,
    action: tradeContextSummary?.action || "WAIT_FOR_RECLAIM",
    needs: "WAIT_FOR_RECLAIM_CONFIRMATION",
    risk: {
      chaseAllowed: tradeContextSummary?.chaseAllowed === true,
      topCandidate: tradeContextSummary?.topCandidate ?? risk?.topCandidate ?? null,
      hardInvalidation:
        tradeContextSummary?.hardInvalidation ??
        abc?.hardInvalidation ??
        risk?.hardInvalidation ??
        null,
      reclaimLadder:
        tradeContextSummary?.reclaimLadder ?? abc?.reclaimDisplay ?? null,
      cleanW5PathDamaged:
        abc?.cleanW5PathDamaged === true || risk?.cleanMicroW5PathDamaged === true,
      topLikelyConfirmedForNow:
        abc?.topLikelyConfirmedForNow === true || risk?.topLikelyConfirmedForNow === true,
    },
    reasonCodes: [
      "TIMELINE_READ_BUILT",
      "MICRO_W4_ABC_DAMAGED",
      "WAIT_FOR_RECLAIM",
    ],
  };
}

function buildDefaultTimeline({
  waveFibState,
  tradeContextSummary,
  regimeLayers,
  reactionContext,
  volumeContext,
  breakoutContext,
}) {
  const waveStack = buildWaveStack(waveFibState);
  const waveStackText = buildWaveStackText(waveStack);

  return {
    ok: true,
    source: "engine22.timelineRead.v1",
    severity: tradeContextSummary?.severity || "neutral",
    headline: tradeContextSummary?.headline || "WAVE/FIB STATE",
    subheadline: tradeContextSummary?.subheadline || waveFibState?.summary || "",
    waveStack,
    waveStackText,
    mainSections: [
      {
        title: "Wave/Fib State",
        severity: tradeContextSummary?.severity || "neutral",
        lines: lineList([
          tradeContextSummary?.summary ||
            waveFibState?.summary ||
            "Wave/fib context developing.",
          `Active setup: ${text(waveFibState?.activeSetup)}`,
          `Active degree: ${text(waveFibState?.activeTradingDegree)}`,
          `Chase risk: ${text(waveFibState?.chaseRisk)}`,
        ]),
      },
      ...buildRegimeSections(regimeLayers),
    ],
    sideSections: [
      buildReactionSection(reactionContext),
      buildVolumeSection(volumeContext),
      buildBreakoutSection(breakoutContext),
      buildDurationSection(waveFibState?.waveDuration),
    ],
    action: tradeContextSummary?.action || "WAIT",
    needs: "WAIT_FOR_CONFIRMATION",
    risk: {
      chaseAllowed: tradeContextSummary?.chaseAllowed === true,
      topCandidate: tradeContextSummary?.topCandidate ?? null,
      hardInvalidation: tradeContextSummary?.hardInvalidation ?? null,
      reclaimLadder: tradeContextSummary?.reclaimLadder ?? null,
    },
    reasonCodes: ["TIMELINE_READ_BUILT_DEFAULT"],
  };
}

export function buildTimelineRead({
  waveFibState = null,
  regimeLayers = null,
  reactionContext = null,
  volumeContext = null,
  breakoutContext = null,
} = {}) {
  if (!waveFibState || typeof waveFibState !== "object") {
    return {
      ok: false,
      source: "engine22.timelineRead.v1",
      severity: "neutral",
      headline: "Wave/Fib State unavailable",
      subheadline: "Engine 22 wave/fib state is missing.",
      waveStack: {},
      waveStackText: "Primary — | Intermediate — | Minor — | Minute — | Micro —",
      mainSections: [
        {
          title: "Action",
          severity: "neutral",
          lines: ["Wait for dashboard snapshot to populate."],
        },
      ],
      sideSections: [],
      action: "WAIT",
      needs: "WAVE_FIB_STATE_UNAVAILABLE",
      risk: {},
      reasonCodes: ["MISSING_WAVE_FIB_STATE"],
    };
  }

  const tradeContextSummary = waveFibState?.tradeContextSummary || null;
  const abc = waveFibState?.abcCorrection || null;
  const risk = waveFibState?.microW4AbcRisk || null;

  const isDamagedAbc =
    abc?.active === true &&
    abc?.state === "ABC_C_LEG_DEEP_DAMAGED";

  const isDamagedRisk =
    risk?.active === true &&
    String(risk?.state || "").toUpperCase().includes("DAMAGED");

  if (isDamagedAbc || isDamagedRisk) {
    return buildDamagedAbcTimeline({
      waveFibState,
      tradeContextSummary,
      regimeLayers,
      reactionContext,
      volumeContext,
      breakoutContext,
    });
  }

  return buildDefaultTimeline({
    waveFibState,
    tradeContextSummary,
    regimeLayers,
    reactionContext,
    volumeContext,
    breakoutContext,
  });
}

export default buildTimelineRead;
