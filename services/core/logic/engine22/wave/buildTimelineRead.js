// services/core/logic/engine22/wave/buildTimelineRead.js
// Engine 22G — Timeline Read Builder
//
// Purpose:
// Convert Engine 22 / Engine 22G read-only context into one frontend-ready timeline object.
// This lets Engine 17 render engine22WaveStrategy.timelineRead directly.
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
      String(state).toUpperCase().includes("LOST") ||
      String(state).toUpperCase().includes("FAILING")
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

function scoreLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "unavailable";
  if (n >= 75) return "strong";
  if (n >= 65) return "supportive";
  if (n >= 55) return "improving / neutral";
  if (n >= 45) return "weak-neutral";
  return "weak";
}

function getMarketMeterScore(marketMeterContext, key) {
  const direct = Number(marketMeterContext?.[key]);
  if (Number.isFinite(direct)) return direct;
  return null;
}

function buildMarketMeterTacticalSection({
  marketMeterContext = null,
  marketRegime = null,
  engine25Context = null,
  waveFibState = null,
  tradeContextSummary = null,
} = {}) {
  if (!marketMeterContext || typeof marketMeterContext !== "object") {
    return {
      title: "Market Meter / Tactical Context",
      severity: "neutral",
      lines: ["Market Meter tactical context unavailable."],
    };
  }

  const score10m = getMarketMeterScore(marketMeterContext, "score10m");
  const score30m = getMarketMeterScore(marketMeterContext, "score30m");
  const score1h = getMarketMeterScore(marketMeterContext, "score1h");
  const score4h = getMarketMeterScore(marketMeterContext, "score4h");
  const scoreEOD = getMarketMeterScore(marketMeterContext, "scoreEOD");

  const state10m = marketMeterContext?.state10m || null;
  const state30m = marketMeterContext?.state30m || null;
  const state1h = marketMeterContext?.state1h || null;
  const state4h = marketMeterContext?.state4h || null;
  const stateEOD = marketMeterContext?.stateEOD || null;

  const sectorDirection =
    marketMeterContext?.sectorDirection4h ??
    marketMeterContext?.sectorDirection ??
    null;

  const riskOn4h = marketMeterContext?.riskOn4h ?? null;
  const eodTradeGate = marketMeterContext?.eodTradeGate || null;
  const eodInternalsWeak = marketMeterContext?.eodInternalsWeak === true;

  const engine25Score = Number(engine25Context?.score);
  const engine25Supportive =
    Number.isFinite(engine25Score) && engine25Score >= 70;

  const htfSupportive =
    engine25Supportive ||
    (Number.isFinite(scoreEOD) && scoreEOD >= 65) ||
    (Number.isFinite(score4h) && score4h >= 65);

  const shortTermWeak =
    (Number.isFinite(score10m) && score10m < 60) ||
    (Number.isFinite(score30m) && score30m < 60) ||
    (Number.isFinite(score1h) && score1h < 60);

  const chaseRisk = String(
    waveFibState?.chaseRisk ||
      tradeContextSummary?.chaseRisk ||
      ""
  ).toUpperCase();

  const activeSetup = String(waveFibState?.activeSetup || "").toUpperCase();

  const lateOrExtended =
    chaseRisk === "EXTREME" ||
    chaseRisk === "HIGH" ||
    activeSetup.includes("EXTENSION");

  let read =
    "Market Meter context is mixed. Wait for clearer confirmation.";

  if (htfSupportive && shortTermWeak && lateOrExtended) {
    read =
      "Higher timeframe still supports longs, but short-term trigger is weak and wave timing is late. No chase after extension. Wait for 10m/30m reclaim before re-arming.";
  } else if (htfSupportive && shortTermWeak) {
    read =
      "Higher timeframe still supports longs, but short-term trigger is not clean yet. Wait for 10m/30m reclaim before arming.";
  } else if (htfSupportive && !shortTermWeak) {
    read =
      "Higher timeframe and short-term Market Meter are supportive. Watch for Engine 15 confirmation.";
  } else if (!htfSupportive && shortTermWeak) {
    read =
      "Short-term Market Meter is weak and higher-timeframe support is not enough. Stand down until structure improves.";
  }

  return {
    title: "Market Meter / Tactical Context",
    severity: shortTermWeak || lateOrExtended ? "warning" : "neutral",
    lines: lineList([
      engine25Context?.score != null
        ? `Engine25: ${Number(engine25Context.score).toFixed(0)} — ${text(
            engine25Context.regime
          )}`
        : null,

      scoreEOD != null
        ? `EOD: ${Number(scoreEOD).toFixed(1)} — ${scoreLabel(
            scoreEOD
          )}${stateEOD ? ` / ${text(stateEOD)}` : ""}`
        : null,

      score4h != null
        ? `4H: ${Number(score4h).toFixed(1)} — ${scoreLabel(score4h)}${
            state4h ? ` / ${text(state4h)}` : ""
          }`
        : null,

      score1h != null
        ? `1H: ${Number(score1h).toFixed(1)} — ${scoreLabel(score1h)}${
            state1h ? ` / ${text(state1h)}` : ""
          }`
        : null,

      score30m != null
        ? `30m: ${Number(score30m).toFixed(1)} — ${scoreLabel(score30m)}${
            state30m ? ` / ${text(state30m)}` : ""
          }`
        : null,

      score10m != null
        ? `10m: ${Number(score10m).toFixed(1)} — ${scoreLabel(score10m)}${
            state10m ? ` / ${text(state10m)}` : ""
          }`
        : null,

      sectorDirection != null
        ? `Sector Direction: ${Number(sectorDirection).toFixed(1)} — ${scoreLabel(
            sectorDirection
          )}`
        : null,

      riskOn4h != null
        ? `4H Risk-On: ${Number(riskOn4h).toFixed(1)} — ${scoreLabel(riskOn4h)}`
        : null,

      eodTradeGate ? `EOD Gate: ${text(eodTradeGate)}` : null,
      eodInternalsWeak ? "EOD Internals: weak" : null,

      marketRegime?.directionBias || marketRegime?.strictness
        ? `Regime: ${text(marketRegime?.directionBias)} / ${text(
            marketRegime?.strictness
          )}`
        : null,

      `Read: ${read}`,
    ]),
  };
}

function buildReactionSection(reactionContext) {
  if (!reactionContext) {
    return {
      title: "Engine 3 Reaction",
      severity: "neutral",
      lines: ["Reaction context unavailable"],
    };
  }

  const waveReaction = reactionContext.waveReaction || null;

  const state =
    waveReaction?.reactionState ||
    reactionContext.state ||
    reactionContext.structureState ||
    "UNKNOWN";

  const score =
    waveReaction?.reactionQualityScore ??
    reactionContext.score ??
    reactionContext.reactionScore ??
    null;

  const quality =
    waveReaction?.reactionQuality ||
    reactionContext.quality ||
    reactionContext.reactionQuality ||
    (Number(score) >= 60 ? "HEALTHY" : "UNKNOWN");

  const direction =
    reactionContext.direction ||
    waveReaction?.waveContextUsed?.executionBias ||
    "NEUTRAL";

  const message =
    waveReaction?.traderMessage ||
    reactionContext.message ||
    null;

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
      message,
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
  const relVol =
    volumeContext.relativeVolume ??
    volumeContext.flags?.relativeVolume ??
    null;

  const confirmed =
    volumeContext.confirmed === true ||
    volumeContext.volumeConfirmed === true;

  return {
    title: "Engine 4 Volume",
    severity: confirmed === true ? "bullish" : "warning",
    lines: lineList([
      `${text(state)} — ${text(quality)}`,
      score != null ? `Score ${score}/${maxScore}` : null,
      relVol != null ? `Relative Volume: ${Number(relVol).toFixed(2)}x` : null,
      confirmed === true ? "Participation confirmed" : "Participation not confirmed",
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

  const activeDegree = waveDuration.activeDegree || "UNKNOWN";
  const activeWave = waveDuration.activeWave || "UNKNOWN";
  const activeBlock = waveDuration?.degrees?.[activeDegree] || {};
  const barDuration = activeBlock?.barDuration || {};

  const barLine =
    barDuration.reason === "BARS_UNAVAILABLE"
      ? "Bar duration: waiting for bar feed"
      : `Bar state: ${text(activeBlock.maturityStateByBars)} / ${text(
          activeBlock.timeRiskByBars
        )}`;

  return {
    title: "Duration / Time Risk",
    severity:
      String(waveDuration.activeTimeRisk || "").toUpperCase().includes("HIGH") ||
      String(waveDuration.activeMaturityState || "").toUpperCase().includes("OVERDUE")
        ? "warning"
        : "neutral",
    lines: lineList([
      `Active duration: ${text(activeDegree)} ${text(activeWave)}`,
      `Clock state: ${text(waveDuration.activeMaturityState)} / ${text(
        waveDuration.activeTimeRisk
      )}`,
      activeBlock.elapsedHours != null
        ? `${text(activeDegree)} ${text(activeWave)} has been active for ${Number(
            activeBlock.elapsedHours
          ).toFixed(2)} clock hours.`
        : null,
      barLine,
    ]),
  };
}

function buildEngine15Section(engine15) {
  if (!engine15 || typeof engine15 !== "object") {
    return {
      title: "Engine 15 Readiness",
      severity: "neutral",
      lines: ["Engine 15 readiness unavailable"],
    };
  }

  const readiness =
    engine15.readinessLabel ||
    engine15.readiness ||
    "UNKNOWN";

  const readinessUpper = String(readiness).toUpperCase();

  const isReady =
    readinessUpper === "READY" ||
    readinessUpper === "PAPER_READY" ||
    readinessUpper === "EXHAUSTION_READY";

  const needs = Array.isArray(engine15.needs)
    ? engine15.needs.slice(0, 5).join(" • ")
    : engine15.needs || null;

  const blockers = Array.isArray(engine15.blockers)
    ? engine15.blockers.slice(0, 5).join(" • ")
    : engine15.blockers || null;

  const reasons = Array.isArray(engine15.reasonCodes)
    ? engine15.reasonCodes.slice(0, 6).join(" • ")
    : null;

  return {
    title: "Engine 15 Readiness",
    severity: isReady ? "bullish" : "warning",
    lines: lineList([
      `Readiness: ${text(readiness)}`,
      engine15.executionBias ? `Execution Bias: ${text(engine15.executionBias)}` : null,
      engine15.action ? `Action: ${text(engine15.action)}` : null,
      engine15.permission ? `Permission: ${text(engine15.permission)}` : null,
      engine15.nextSetupType ? `Next Setup: ${text(engine15.nextSetupType)}` : null,
      engine15.direction ? `Direction: ${text(engine15.direction)}` : null,
      needs ? `Needs: ${text(needs)}` : null,
      blockers ? `Blockers: ${text(blockers)}` : null,
      reasons ? `Reasons: ${text(reasons)}` : null,
    ]),
  };
}

function buildEngine16StructureSection(regimeLayers) {
  const layers = regimeLayers || {};

  const tenMinute = layers.tenMinute || layers.trigger10m || null;
  const oneHour = layers.oneHour || layers.pullback1h || null;
  const fourHour = layers.fourHour || layers.trend4h || null;
  const eod = layers.eod || layers.regimeEod || null;

  return {
    title: "Engine 16 Structure",
    severity: "neutral",
    lines: lineList([
      tenMinute
        ? `10m: ${text(tenMinute.state || tenMinute.trendState || "UNKNOWN")} | Score ${tenMinute.score ?? "—"}`
        : "10m: unavailable",

      oneHour
        ? `1H: ${text(oneHour.state || oneHour.trendState || "UNKNOWN")} | Score ${oneHour.score ?? "—"}`
        : "1H: unavailable",

      fourHour
        ? `4H: ${text(fourHour.state || fourHour.trendState || "UNKNOWN")} | Score ${fourHour.score ?? "—"}`
        : "4H: unavailable",

      eod
        ? `EOD: ${text(eod.state || eod.trendState || "UNKNOWN")} | Permission ${
            eod.dipBuyPermission === true ? "ON" : "OFF"
          }`
        : "EOD: unavailable",
    ]),
  };
}

function buildTargetClusterSection(targetClusterConfidence) {
  if (
    !targetClusterConfidence ||
    typeof targetClusterConfidence !== "object" ||
    targetClusterConfidence.active !== true
  ) {
    return null;
  }

  const score = Number(targetClusterConfidence.score);
  const severity =
    Number.isFinite(score) && score >= 80
      ? "info"
      : "neutral";

  return {
    title: "Target Cluster Confidence",
    severity,
    lines: lineList([
      targetClusterConfidence.dashboardRead || null,
      targetClusterConfidence.detailRead || null,
      targetClusterConfidence.message || null,
      targetClusterConfidence.activationState
        ? `Activation: ${text(targetClusterConfidence.activationState)}`
        : null,
    ]),
  };
}

function buildCommonSideSections({
  engine15 = null,
  regimeLayers = null,
  reactionContext = null,
  volumeContext = null,
  waveDuration = null,
}) {
  return [
    buildEngine15Section(engine15),
    buildEngine16StructureSection(regimeLayers),
    buildReactionSection(reactionContext),
    buildVolumeSection(volumeContext),
    buildDurationSection(waveDuration),
  ];
}

function maybeTargetClusterSection(targetClusterConfidence) {
  const section = buildTargetClusterSection(targetClusterConfidence);
  return section ? [section] : [];
}

function buildDamagedAbcTimeline({
  waveFibState,
  tradeContextSummary,
  targetClusterConfidence = null,
  regimeLayers,
  reactionContext,
  volumeContext,
  breakoutContext,
  engine15 = null,
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
    ...maybeTargetClusterSection(targetClusterConfidence),
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

  const sideSections = buildCommonSideSections({
    engine15,
    regimeLayers,
    reactionContext,
    volumeContext,
    waveDuration: duration,
  });

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
  targetClusterConfidence = null,
  regimeLayers,
  reactionContext,
  volumeContext,
  breakoutContext,
  engine15 = null,
  engine25Context = null,
  marketRegime = null,
  marketMeterContext = null,
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
      ...maybeTargetClusterSection(targetClusterConfidence),
      buildMarketMeterTacticalSection({
        marketMeterContext,
        marketRegime,
        engine25Context,
        waveFibState,
        tradeContextSummary,
      }),
      ...buildRegimeSections(regimeLayers),
    ],
    sideSections: buildCommonSideSections({
      engine15,
      regimeLayers,
      reactionContext,
      volumeContext,
      waveDuration: waveFibState?.waveDuration,
    }),
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
  tradeContextSummary = null,
  targetClusterConfidence = null,
  regimeLayers = null,
  reactionContext = null,
  volumeContext = null,
  breakoutContext = null,
  engine15 = null,
  engine25Context = null,
  marketRegime = null,
  marketMeterContext = null,
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
      sideSections: [buildEngine15Section(engine15)],
      action: "WAIT",
      needs: "WAVE_FIB_STATE_UNAVAILABLE",
      risk: {},
      reasonCodes: ["MISSING_WAVE_FIB_STATE"],
    };
  }

  const summary = tradeContextSummary || waveFibState?.tradeContextSummary || null;
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
      tradeContextSummary: summary,
      targetClusterConfidence,
      regimeLayers,
      reactionContext,
      volumeContext,
      breakoutContext,
      engine15,
    });
  }

  return buildDefaultTimeline({
    waveFibState,
    tradeContextSummary: summary,
    targetClusterConfidence,
    regimeLayers,
    reactionContext,
    volumeContext,
    breakoutContext,
    engine15,
    engine25Context,
    marketRegime,
    marketMeterContext,
  });
}

export default buildTimelineRead;
