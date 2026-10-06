// src/services/core/logic/confluenceScorer.js
//
// Engine 5 — Confluence / Ingredient Scorecard
//
// vNext cleanup:
// - Engine 5 is analytics only. It explains setup ingredients; it does not decide trades.
// - Engine 2 / fib / Elliott wave scoring is DISABLED inside Engine 5.
//   Fib/wave authority has moved to Engine 22 + Engine 15.
// - Engine 5 score now focuses on:
//   Zone quality: 20%
//   Engine 3 reaction: 35%
//   Engine 4 volume participation: 35%
//   Compression: bonus
// - ES reaction is score-first, not stage-first.
// - ES volume state recognizes high-volume fading / expansion / absorption / climactic risk.
// - Keeps old compatibility fields: context.fib, context.reaction, context.volume, targets, flags.

const ENGINE2_SCORING_DISABLED_NOTE =
  "Fib/wave scoring moved to Engine 22 / Engine 15";

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function labelFromScore(total) {
  if (total >= 90) return "A+";
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  return "LOW";
}

function midpoint(lo, hi) {
  const a = Number(lo);
  const b = Number(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Number(((a + b) / 2).toFixed(2));
}

function isTrue(x) {
  return x === true;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function emptyScores(label = "LOW") {
  return {
    engine1: 0,
    engine3: 0,
    engine4: 0,
    compression: 0,
    total: 0,
    label,
    engine2ScoringDisabled: true,
    engine2ScoringNote: ENGINE2_SCORING_DISABLED_NOTE,
  };
}

/**
 * Engine 1 active zone priority:
 * negotiated -> shelf -> institutional
 */
function getActiveZoneFromEngine1(ctx) {
  const neg = ctx?.active?.negotiated ?? null;
  const shelf = ctx?.active?.shelf ?? null;
  const inst = ctx?.active?.institutional ?? null;

  const zone = neg || shelf || inst || null;

  if (!zone) return { zone: null, zoneType: null };
  if (neg) return { zone, zoneType: "NEGOTIATED" };
  if (shelf) return { zone, zoneType: "SHELF" };
  return { zone, zoneType: "INSTITUTIONAL" };
}

/**
 * Route-level execution-zone override.
 * The snapshot builder / confluence route may pass a nearest shelf or active ES shelf.
 */
function getExecutionZone({ engine1Context, zoneRefOverride }) {
  if (zoneRefOverride && zoneRefOverride.lo != null && zoneRefOverride.hi != null) {
    const zt = zoneRefOverride.zoneType || zoneRefOverride.type || null;

    const zoneType =
      zt === "NEGOTIATED" || zt === "SHELF" || zt === "INSTITUTIONAL"
        ? zt
        : null;

    return { zone: zoneRefOverride, zoneType: zoneType || null, override: true };
  }

  const { zone, zoneType } = getActiveZoneFromEngine1(engine1Context);
  return { zone, zoneType, override: false };
}

function institutionalIsDead(inst) {
  const facts = inst?.details?.facts || {};
  const sticky = facts?.sticky || {};
  const exitsArr = Array.isArray(sticky.exits) ? sticky.exits : [];

  const statusArchived = sticky.status === "archived";
  const hasArchivedUtc = !!sticky.archivedUtc;
  const distinctExitCount = Number(sticky.distinctExitCount ?? 0);
  const exitsLen = exitsArr.length;
  const hasExitSide = facts.exitSide1h != null;
  const exitBars1h = Number(facts.exitBars1h ?? 0);

  return (
    statusArchived ||
    hasArchivedUtc ||
    distinctExitCount >= 2 ||
    exitsLen >= 2 ||
    (hasExitSide && exitBars1h > 0)
  );
}

function calcBiasFromZone(zone) {
  if (!zone) return null;
  const t = String(zone.type || zone.zoneType || "").toLowerCase();
  if (t === "accumulation") return "long";
  if (t === "distribution") return "short";
  return null;
}

function isEsReaction(reaction, reasonCodes = []) {
  return (
    reasonCodes.includes("ES_REACTION_SCORE") ||
    reaction?.esReaction != null
  );
}

/* -------------------- Engine 4 volume state -------------------- */

function deriveVolumeState(volume) {
  const note = String(volume?.diagnostics?.note || "");
  if (note.includes("NO_TOUCH_FOUND")) return "NO_TOUCH";

  const f = volume?.flags || {};

  const participationState = String(
    f.participationState || volume?.participationState || ""
  ).toUpperCase();

  const participationQuality = String(
    f.participationQuality || volume?.participationQuality || ""
  ).toUpperCase();

  const volumeTrend = String(
    f.volumeTrend || volume?.volumeTrend || ""
  ).toUpperCase();

  const relativeVolume = Number(
    f.relativeVolume ?? volume?.relativeVolume ?? 0
  );

  if (f.absorptionRisk === true) return "ABSORPTION_RISK";
  if (f.climacticVolume === true) return "CLIMACTIC_CAUTION";

  if (f.volumeExpansion === true || relativeVolume >= 1.2) {
    if (volumeTrend === "FADING") return "HIGH_VOLUME_FADING";
    if (participationQuality) return participationQuality;
    if (participationState) return participationState;
    return "HIGH_VOLUME_EXPANDING";
  }

  if (isTrue(f.liquidityTrap)) return "TRAP_SUSPECTED";
  if (isTrue(f.initiativeMoveConfirmed) && isTrue(volume?.volumeConfirmed)) return "INITIATIVE";
  if (isTrue(f.volumeDivergence)) return "DIVERGENCE";
  if (isTrue(f.absorptionDetected)) return "ABSORPTION";
  if (isTrue(f.distributionDetected)) return "DISTRIBUTION";
  if (isTrue(f.pullbackContraction)) return "PULLBACK_CONTRACTION";
  if (isTrue(f.reversalExpansion)) return "REVERSAL_EXPANSION";

  return "NO_SIGNAL";
}

/* -------------------- Compression -------------------- */

function readAvgTR8(diagnostics) {
  const d = diagnostics || {};
  const candidates = [
    d.avgTR8,
    d.avgTr8,
    d.avg_true_range_8,
    d.avgTrueRange8,
    d.meanTR8,
    d.meanTr8,
    d.tr8Avg,
  ];

  for (const c of candidates) {
    const n = toNum(c);
    if (n != null) return n;
  }

  return null;
}

function squeezeScoreNegotiated(ratio) {
  if (ratio == null) return 0;
  if (ratio <= 0.60) return 20;

  if (ratio <= 0.90) {
    const t = (ratio - 0.60) / (0.90 - 0.60);
    return Math.round(20 + (10 - 20) * t);
  }

  if (ratio <= 1.20) {
    const t = (ratio - 0.90) / (1.20 - 0.90);
    return Math.round(10 + (0 - 10) * t);
  }

  return 0;
}

function squeezeScoreInstitutional(ratio) {
  const n20 = squeezeScoreNegotiated(ratio);
  return Math.round((n20 / 20) * 7);
}

function computeCompression({ zone, zoneType, fib, volume }) {
  if (!zone || !zoneType) {
    return {
      active: false,
      tier: "NONE",
      score: 0,
      state: "NONE",
      zoneWidth: null,
      atr: null,
      widthAtrRatio: null,
      quiet: false,
      reasons: [],
    };
  }

  const tier =
    zoneType === "NEGOTIATED"
      ? "NEGOTIATED"
      : zoneType === "INSTITUTIONAL"
        ? "INSTITUTIONAL"
        : "NONE";

  if (tier === "NONE") {
    return {
      active: false,
      tier,
      score: 0,
      state: "NONE",
      zoneWidth: null,
      atr: null,
      widthAtrRatio: null,
      quiet: false,
      reasons: [],
    };
  }

  const lo = toNum(zone.lo);
  const hi = toNum(zone.hi);
  const zoneWidth = lo != null && hi != null ? Math.abs(hi - lo) : null;

  const atr =
    toNum(volume?.diagnostics?.atr) ??
    toNum(fib?.diagnostics?.atr) ??
    null;

  const widthAtrRatio =
    zoneWidth != null && atr != null && atr > 0 ? zoneWidth / atr : null;

  const reasons = ["IN_COMPRESSION_ZONE"];

  const avgTR8 = readAvgTR8(volume?.diagnostics);
  let quiet = false;

  if (avgTR8 != null && atr != null && atr > 0) {
    quiet = avgTR8 <= 0.80 * atr;
    reasons.push(quiet ? "QUIET_TR_OK" : "QUIET_TR_HIGH");
  } else {
    const f = volume?.flags || {};
    quiet = !isTrue(f.initiativeMoveConfirmed) && !isTrue(f.liquidityTrap);
    reasons.push("QUIET_FALLBACK_NO_TR_METRIC");
  }

  const squeeze =
    tier === "NEGOTIATED"
      ? squeezeScoreNegotiated(widthAtrRatio)
      : squeezeScoreInstitutional(widthAtrRatio);

  if (widthAtrRatio == null) reasons.push("NO_ATR_TIGHTNESS_METRIC");
  else if (widthAtrRatio <= 0.60) reasons.push("SQUEEZE_STRONG");
  else if (widthAtrRatio <= 0.90) reasons.push("SQUEEZE_GOOD");
  else if (widthAtrRatio <= 1.20) reasons.push("SQUEEZE_WEAK");
  else reasons.push("SQUEEZE_NONE");

  const quietScoreRaw =
    tier === "NEGOTIATED" ? (quiet ? 10 : 0) : (quiet ? 3 : 0);

  const quietScore = squeeze > 0 ? quietScoreRaw : 0;

  const cap = tier === "NEGOTIATED" ? 30 : 10;
  const score = clamp(Math.round(squeeze + quietScore), 0, cap);

  let state = "NONE";

  if (widthAtrRatio != null) {
    if (widthAtrRatio <= 0.80 && quiet && squeeze > 0) state = "COILING";
    else if (widthAtrRatio <= 1.10 && squeeze > 0) state = "COMPRESSING";
    else state = "NONE";
  }

  const activeThreshold = tier === "NEGOTIATED" ? 18 : 6;
  const active = state === "COILING" && score >= activeThreshold;

  return {
    active,
    tier,
    score,
    state,
    zoneWidth,
    atr,
    widthAtrRatio: widthAtrRatio != null ? Number(widthAtrRatio.toFixed(3)) : null,
    quiet,
    reasons: [...reasons, `SQUEEZE=${squeeze}`, `QUIET=${quietScore}`],
  };
}

/* -------------------- Location label -------------------- */

function deriveLocationState(engine1Context, zone, zoneType, strategyMode, reaction) {
  const act = engine1Context?.active || {};

  if (act.negotiated) {
    return {
      state: "PRICE_IN_GOLDEN_RULE",
      zoneType: "NEGOTIATED",
      shelfType: null,
      zoneId: act.negotiated.id ?? null,
    };
  }

  if (act.shelf) {
    const t = String(act.shelf.type || "").toLowerCase();
    const shelfType =
      t === "distribution" ? "distribution" :
      t === "accumulation" ? "accumulation" :
      null;

    return {
      state:
        shelfType === "distribution"
          ? "PRICE_IN_DISTRIBUTION_SHELF"
          : "PRICE_IN_ACCUMULATION_SHELF",
      zoneType: "SHELF",
      shelfType,
      zoneId: act.shelf.id ?? null,
    };
  }

  if (act.institutional) {
    return {
      state: "PRICE_IN_INSTITUTIONAL_ZONE",
      zoneType: "INSTITUTIONAL",
      shelfType: null,
      zoneId: act.institutional.id ?? null,
    };
  }

  const stage = String(reaction?.stage || "").toUpperCase();

  if (strategyMode === "scalp" && (stage === "TRIGGERED" || stage === "CONFIRMED")) {
    return {
      state: "TRIGGERED_OUTSIDE_ZONE",
      zoneType: zoneType || null,
      shelfType: null,
      zoneId: zone?.id ?? null,
    };
  }

  return {
    state: "NOT_IN_ZONE",
    zoneType: null,
    shelfType: null,
    zoneId: null,
  };
}

/* -------------------- Compatibility-only flags -------------------- */

function computeGoldenCoil({ mode, flags, reaction, volumeState }) {
  const goldenIgnition = flags?.goldenIgnition === true;
  if (!goldenIgnition) return false;

  const stage = String(reaction?.stage || "IDLE").toUpperCase();
  const armed = reaction?.armed === true;

  if (mode === "scalp") {
    const stageOk =
      armed ||
      stage === "ARMED" ||
      stage === "TRIGGERED" ||
      stage === "CONFIRMED";

    const volumeOk =
      volumeState !== "NO_SIGNAL" &&
      volumeState !== "NO_TOUCH" &&
      volumeState !== "NO_ACTIVE_ZONE";

    return stageOk && volumeOk;
  }

  return true;
}

/* -------------------- Engine 3 reaction scoring -------------------- */

function reactionPartForMode({ mode, reaction }) {
  const score = clamp(Number(reaction?.reactionScore ?? 0), 0, 10);
  const stage = String(reaction?.stage || "IDLE").toUpperCase();
  const structureState = String(reaction?.structureState || "HOLD").toUpperCase();
  const reasonCodes = Array.isArray(reaction?.reasonCodes) ? reaction.reasonCodes : [];

  if (isEsReaction(reaction, reasonCodes)) {
    const rawScore = clamp(
      Number(
        reaction?.esReaction?.reaction?.qualityScore ??
        reaction?.reactionScore ??
        reaction?.score ??
        0
      ),
      0,
      100
    );

    if (structureState === "FAILURE") return 0;

    // ES is score-first.
    // Do not let legacy stage: IDLE crush valid ES reaction quality.
    if (rawScore >= 75) return 15;
    if (rawScore >= 60) return 10;
    if (rawScore >= 40) return 5;
    return 0;
  }

  if (reasonCodes.includes("NOT_IN_ZONE")) return 0;
  if (structureState === "FAILURE") return 0;

  if (mode === "scalp") {
    let base = 0;

    if (stage === "ARMED") base = 6;
    else if (stage === "TRIGGERED") base = 12;
    else if (stage === "CONFIRMED") base = 15;

    const trim = clamp(score - 5, 0, 3);
    return clamp(base + trim, 0, 15);
  }

  return clamp(score * 1.5, 0, 15);
}

/* -------------------- Normalized components -------------------- */

function buildReactionComponent({ reaction, componentScore }) {
  const reasonCodes = Array.isArray(reaction?.reasonCodes) ? reaction.reasonCodes : [];
  const rawScore = clamp(
    Number(
      reaction?.esReaction?.reaction?.qualityScore ??
      reaction?.reactionScore ??
      reaction?.score ??
      0
    ),
    0,
    100
  );

  const state =
    reaction?.state ??
    reaction?.structureState ??
    reaction?.esReaction?.reaction?.state ??
    null;

  const quality =
    reaction?.quality ??
    reaction?.esReaction?.reaction?.quality ??
    null;

  const direction =
    reaction?.direction ??
    reaction?.esReaction?.reaction?.bias ??
    null;

  return {
    rawScore,
    componentScore,
    confirmed: reaction?.confirmed === true || rawScore >= 75,
    cleanReaction: rawScore >= 60,
    stage: reaction?.stage ?? null,
    state,
    structureState: reaction?.structureState ?? state,
    direction,
    quality,
    reasonCodes,
  };
}

function buildVolumeComponent({ volume, componentScore, volumeState }) {
  const f = volume?.flags || {};
  const relativeVolume = toNum(f.relativeVolume ?? volume?.relativeVolume);
  const volumeExpansion = f.volumeExpansion === true || relativeVolume >= 1.2;
  const absorptionRisk = f.absorptionRisk === true || f.absorptionDetected === true;
  const climacticVolume = f.climacticVolume === true;
  const volumeTrend = f.volumeTrend ?? volume?.volumeTrend ?? null;
  const participationState = f.participationState ?? volume?.participationState ?? null;
  const participationQuality = f.participationQuality ?? volume?.participationQuality ?? null;
  const rawScore = clamp(Number(volume?.volumeScore ?? volume?.score ?? 0), 0, 15);

  let quality = "NO_SIGNAL";

  if (absorptionRisk) quality = "ABSORPTION_RISK";
  else if (climacticVolume) quality = "CLIMACTIC_CAUTION";
  else if (volumeState === "HIGH_VOLUME_FADING") quality = "HIGH_VOLUME_FADING";
  else if (volumeExpansion && rawScore >= 10) quality = "EXPANDING";
  else if (rawScore >= 7) quality = "MODERATE";
  else if (rawScore > 0) quality = "WEAK";

  const cleanParticipation =
    rawScore >= 10 &&
    volumeExpansion &&
    !absorptionRisk &&
    !climacticVolume &&
    String(volumeTrend || "").toUpperCase() !== "FADING";

  return {
    rawScore,
    componentScore,
    confirmed: volume?.volumeConfirmed === true,
    cleanParticipation,
    relativeVolume,
    volumeExpansion,
    absorptionRisk,
    climacticVolume,
    highVolumeCandles: toNum(f.highVolumeCandles),
    volumeTrend,
    participationState,
    participationQuality,
    state: volumeState,
    quality,
    reasonCodes: Array.isArray(volume?.reasonCodes) ? volume.reasonCodes : [],
  };
}

/* -------------------- MAIN -------------------- */

export function computeConfluenceScore({
  symbol,
  tf,
  degree,
  wave,
  price,
  engine1Context,
  fib,
  reaction,
  volume,
  strategyId,
  mode,
  zoneRefOverride,
  zoneRefSource,

  // Engine 2/fib weight intentionally disabled.
  weights = { e1: 0.20, e2: 0.00, e3: 0.35, e4: 0.35 },

  engine1WeakCapThreshold = 50,
  engine1WeakCapValue = 55,
}) {
  const reasons = [];
  const flags = {};

  const strategyMode =
    mode ||
    (String(strategyId || "").toLowerCase().includes("intraday_scalp")
      ? "scalp"
      : "swing");

  const { zone: execZone, zoneType: execZoneType } = getExecutionZone({
    engine1Context,
    zoneRefOverride,
  });

  const fibSignals = fib?.signals || {};
  const fibInvalidated = isTrue(fibSignals.invalidated);

  // Fib is no longer an Engine 5 scoring authority.
  // Keep this flag only for diagnostic context.
  flags.fibInvalidated = fibInvalidated;
  flags.engine2ScoringDisabled = true;

  if (fibInvalidated) {
    reasons.push("FIB_INVALIDATED_CONTEXT_ONLY_ENGINE5_NOT_BLOCKING");
  }

  const institutionalContainer = engine1Context?.active?.institutional ?? null;

  const stage = String(reaction?.stage || "").toUpperCase();
  const scalpTriggered =
    strategyMode === "scalp" &&
    (stage === "TRIGGERED" || stage === "CONFIRMED");

  if (!execZone && !scalpTriggered) {
    return {
      ok: true,
      symbol,
      tf,
      degree,
      wave,
      invalid: false,
      reasonCodes: ["OUTSIDE_PREFERRED_ZONE_ENGINE5_ANALYTICS_ONLY"],
      tradeReady: false,
      bias: null,
      price,
      location: deriveLocationState(engine1Context, null, null, strategyMode, reaction),
      scores: emptyScores("LOW"),
      flags: {
        zoneType: null,
        tradeReady: false,
        fibInvalidated,
        engine2ScoringDisabled: true,
        goldenIgnition: false,
        goldenCoil: false,
      },
      components: {
        engine3Reaction: buildReactionComponent({ reaction, componentScore: 0 }),
        engine4Volume: buildVolumeComponent({
          volume,
          componentScore: 0,
          volumeState: "NO_ACTIVE_ZONE",
        }),
      },
      context: { activeZone: null, fib, reaction, volume },
      targets: { entryTarget: null, exitTarget: null, exitTargetHi: null, exitTargetLo: null },
      volumeState: "NO_ACTIVE_ZONE",
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
      strategyId: strategyId || null,
      mode: strategyMode,
      zoneRefSource: zoneRefSource || "NONE",
    };
  }

  if (execZoneType === "INSTITUTIONAL" && institutionalIsDead(execZone)) {
    return {
      ok: true,
      symbol,
      tf,
      degree,
      wave,
      invalid: false,
      reasonCodes: ["ZONE_ARCHIVED_OR_EXITED_CONTEXT_ONLY_ENGINE5_NOT_BLOCKING"],
      tradeReady: false,
      bias: null,
      price,
      location: deriveLocationState(engine1Context, execZone, execZoneType, strategyMode, reaction),
      scores: emptyScores("LOW"),
      flags: {
        ...flags,
        zoneType: execZoneType,
        tradeReady: false,
        goldenIgnition: false,
        goldenCoil: false,
      },
      components: {
        engine3Reaction: buildReactionComponent({ reaction, componentScore: 0 }),
        engine4Volume: buildVolumeComponent({
          volume,
          componentScore: 0,
          volumeState: deriveVolumeState(volume),
        }),
      },
      context: { activeZone: execZone, fib, reaction, volume },
      targets: {
        entryTarget: midpoint(execZone?.lo, execZone?.hi),
        exitTarget: null,
        exitTargetHi: execZone?.hi ?? null,
        exitTargetLo: execZone?.lo ?? null,
      },
      volumeState: deriveVolumeState(volume),
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
      strategyId: strategyId || null,
      mode: strategyMode,
      zoneRefSource: zoneRefSource || "ACTIVE",
    };
  }

  const inGoldenIgnition = execZoneType === "NEGOTIATED" && !!institutionalContainer;
  flags.goldenIgnition = inGoldenIgnition;
  flags.tradeReady = true;

  let e1Score = clamp(Number(execZone?.readiness ?? execZone?.strength ?? 0), 0, 100);

  if (inGoldenIgnition) {
    const instStrength = toNum(institutionalContainer?.strength ?? institutionalContainer?.readiness);

    if (instStrength != null) {
      e1Score = Math.max(e1Score, clamp(instStrength, 0, 100));
    } else {
      e1Score = Math.max(e1Score, 70);
      reasons.push("GOLDEN_IGNITION_LOCATION_COMPAT_ONLY");
    }
  }

  const e3Part = reactionPartForMode({ mode: strategyMode, reaction });

  const e4ScoreRaw = clamp(Number(volume?.volumeScore ?? 0), 0, 15);
  let e4Capped = e4ScoreRaw;

  const liquidityTrap = isTrue(volume?.flags?.liquidityTrap);
  flags.liquidityTrap = liquidityTrap;

  if (liquidityTrap) {
    reasons.push("VOLUME_TRAP_SUSPECTED");
    e4Capped = Math.min(e4Capped, 3);
  }

  let compression = { active: false, tier: "NONE", score: 0, state: "NONE" };

  if (execZoneType === "NEGOTIATED" || execZoneType === "INSTITUTIONAL") {
    compression = computeCompression({ zone: execZone, zoneType: execZoneType, fib, volume });
  }

  const e1Norm = e1Score;
  const e3Norm = (e3Part / 15) * 100;
  const e4Norm = (e4Capped / 15) * 100;

  let total =
    weights.e1 * e1Norm +
    weights.e3 * e3Norm +
    weights.e4 * e4Norm;

  if (!inGoldenIgnition && e1Score < engine1WeakCapThreshold) {
    reasons.push("ENGINE1_WEAK_LOCATION");
    total = Math.min(total, engine1WeakCapValue);
  }

  if (compression?.score > 0) {
    total += compression.score;
    if (compression.active) reasons.push("COILING_PRE_IGNITION");
  }

  total = clamp(Math.round(total), 0, 100);
  const label = labelFromScore(total);

  const entryTarget = execZone ? midpoint(execZone.lo, execZone.hi) : null;
  const bias = calcBiasFromZone(execZone);

  const exitTargetHi = execZone?.hi ?? null;
  const exitTargetLo = execZone?.lo ?? null;
  let exitTarget = null;

  if (bias === "long") exitTarget = exitTargetHi;
  if (bias === "short") exitTarget = exitTargetLo;

  const volumeState = deriveVolumeState(volume);

  flags.goldenCoil = computeGoldenCoil({
    mode: strategyMode,
    flags,
    reaction,
    volumeState,
  });

  const reactionComponent = buildReactionComponent({
    reaction,
    componentScore: Math.round(e3Part),
  });

  const volumeComponent = buildVolumeComponent({
    volume,
    componentScore: Number(e4ScoreRaw.toFixed(2)),
    volumeState,
  });

  return {
    ok: true,
    symbol,
    tf,
    degree,
    wave,

    // Engine 5 no longer blocks.
    invalid: false,
    tradeReady: true,

    reasonCodes: reasons,
    bias,
    price,
    location: deriveLocationState(engine1Context, execZone, execZoneType, strategyMode, reaction),

    scores: {
      engine1: Math.round(e1Score),
      engine3: Math.round(e3Part),
      engine4: Number(e4ScoreRaw.toFixed(2)),
      compression: compression.score,
      total,
      label,
      engine2ScoringDisabled: true,
      engine2ScoringNote: ENGINE2_SCORING_DISABLED_NOTE,
    },

    components: {
      engine3Reaction: reactionComponent,
      engine4Volume: volumeComponent,
      engine2WaveFib: {
        scoringDisabled: true,
        note: ENGINE2_SCORING_DISABLED_NOTE,
        fibInvalidated,
      },
    },

    flags: { ...flags, zoneType: execZoneType },

    context: {
      activeZone: execZone
        ? {
            id: execZone.id ?? null,
            zoneType: execZoneType,
            type: execZone.type ?? null,
            lo: execZone.lo ?? null,
            hi: execZone.hi ?? null,
            mid: execZone.mid ?? entryTarget ?? null,
            strength: execZone.strength ?? null,
            readiness: execZone.readiness ?? null,
            source: zoneRefSource || (zoneRefOverride ? "OVERRIDE" : "ACTIVE"),
          }
        : null,
      institutionalContainer: institutionalContainer ?? null,
      fib,
      reaction,
      volume,
    },

    // Kept for compatibility. Engine 22 / Engine 15 should own real targets.
    targets: { entryTarget, exitTarget, exitTargetHi, exitTargetLo },

    volumeState,
    compression,
    strategyId: strategyId || null,
    mode: strategyMode,
    zoneRefSource: zoneRefSource || "ACTIVE",
  };
}
