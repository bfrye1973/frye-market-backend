// src/services/core/logic/confluenceScorer.js
// FINAL: Stage-first scalp weighting + mode-aware golden coil + compression fix
// - Keeps contracts stable
// - Uses zoneRefOverride if provided by confluenceScore route (prevents "system off" for scalps)
// - Fix: no "quiet-only" compression points when squeeze is NONE

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function labelFromScore(total) {
  if (total >= 90) return "A+";
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  return "IGNORE";
}

function midpoint(lo, hi) {
  const a = Number(lo), b = Number(hi);
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

/**
 * Engine 1 active zone priority (LOCKED): negotiated -> shelf -> institutional
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
 * 🔥 NEW: allow route-level zone reference override (for scalp after break)
 * - confluenceScore route can pass exec zone ref as zoneRefOverride
 * - this prevents "NO_ZONE_NO_TRADE" hard zero during TRIGGERED window
 */
function getExecutionZone({ engine1Context, zoneRefOverride }) {
  if (zoneRefOverride && zoneRefOverride.lo != null && zoneRefOverride.hi != null) {
    // zoneRefOverride should include zoneType if possible
    const zt =
      zoneRefOverride.zoneType ||
      zoneRefOverride.type ||
      null;

    const zoneType =
      zt === "NEGOTIATED" || zt === "SHELF" || zt === "INSTITUTIONAL"
        ? zt
        : null;

    return { zone: zoneRefOverride, zoneType: zoneType || null, override: true };
  }
  const { zone, zoneType } = getActiveZoneFromEngine1(engine1Context);
  return { zone, zoneType, override: false };
}

// Engine 1 dead-zone gate (institutional only)
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

function calcEngine2Score(fib) {
  const s = fib?.signals || {};
  let score = 0;
  if (isTrue(s.inRetraceZone)) score += 10;
  if (isTrue(s.near50)) score += 10;
  return score; // 0..20
}

function calcBiasFromZone(zone) {
  if (!zone) return null;
  const t = String(zone.type || zone.zoneType || "").toLowerCase();
  if (t === "accumulation") return "long";
  if (t === "distribution") return "short";
  return null;
}

function deriveVolumeState(volume) {
  const note = String(volume?.diagnostics?.note || "");
  if (note.includes("NO_TOUCH_FOUND")) return "NO_TOUCH";

  const f = volume?.flags || {};
  if (isTrue(f.liquidityTrap)) return "TRAP_SUSPECTED";
  if (isTrue(f.initiativeMoveConfirmed) && isTrue(volume?.volumeConfirmed)) return "INITIATIVE";
  if (isTrue(f.volumeDivergence)) return "DIVERGENCE";
  if (isTrue(f.absorptionDetected)) return "ABSORPTION";
  if (isTrue(f.distributionDetected)) return "DISTRIBUTION";
  if (isTrue(f.pullbackContraction)) return "PULLBACK_CONTRACTION";
  if (isTrue(f.reversalExpansion)) return "REVERSAL_EXPANSION";
  return "NO_SIGNAL";
}

/* -------------------- Compression (Option B tuned + FIX) -------------------- */
function readAvgTR8(diagnostics) {
  const d = diagnostics || {};
  const candidates = [
    d.avgTR8, d.avgTr8, d.avg_true_range_8, d.avgTrueRange8,
    d.meanTR8, d.meanTr8, d.tr8Avg,
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
    return { active: false, tier: "NONE", score: 0, state: "NONE", zoneWidth: null, atr: null, widthAtrRatio: null, quiet: false, reasons: [] };
  }

  const tier =
    zoneType === "NEGOTIATED" ? "NEGOTIATED" :
    zoneType === "INSTITUTIONAL" ? "INSTITUTIONAL" :
    "NONE";

  if (tier === "NONE") {
    return { active: false, tier, score: 0, state: "NONE", zoneWidth: null, atr: null, widthAtrRatio: null, quiet: false, reasons: [] };
  }

  const lo = toNum(zone.lo);
  const hi = toNum(zone.hi);
  const zoneWidth = (lo != null && hi != null) ? Math.abs(hi - lo) : null;

  const atr = toNum(volume?.diagnostics?.atr) ?? toNum(fib?.diagnostics?.atr) ?? null;

  const widthAtrRatio =
    zoneWidth != null && atr != null && atr > 0 ? zoneWidth / atr : null;

  const reasons = ["IN_COMPRESSION_ZONE"];

  // Quiet (TR-only preferred, fallback to not-igniting proxy)
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

  // Squeeze
  const squeeze =
    tier === "NEGOTIATED"
      ? squeezeScoreNegotiated(widthAtrRatio)
      : squeezeScoreInstitutional(widthAtrRatio);

  if (widthAtrRatio == null) reasons.push("NO_ATR_TIGHTNESS_METRIC");
  else if (widthAtrRatio <= 0.60) reasons.push("SQUEEZE_STRONG");
  else if (widthAtrRatio <= 0.90) reasons.push("SQUEEZE_GOOD");
  else if (widthAtrRatio <= 1.20) reasons.push("SQUEEZE_WEAK");
  else reasons.push("SQUEEZE_NONE");

  // ✅ FIX: if squeeze==0, do NOT award quiet-only points.
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
  if (act.negotiated) return { state: "PRICE_IN_GOLDEN_RULE", zoneType: "NEGOTIATED", shelfType: null, zoneId: act.negotiated.id ?? null };
  if (act.shelf) {
    const t = String(act.shelf.type || "").toLowerCase();
    const shelfType = t === "distribution" ? "distribution" : t === "accumulation" ? "accumulation" : null;
    return {
      state: shelfType === "distribution" ? "PRICE_IN_DISTRIBUTION_SHELF" : "PRICE_IN_ACCUMULATION_SHELF",
      zoneType: "SHELF",
      shelfType,
      zoneId: act.shelf.id ?? null,
    };
  }
  if (act.institutional) return { state: "PRICE_IN_INSTITUTIONAL_ZONE", zoneType: "INSTITUTIONAL", shelfType: null, zoneId: act.institutional.id ?? null };

  // If no active zone, but scalp TRIGGERED exists, we still show system state
  if (strategyMode === "scalp" && reaction?.stage === "TRIGGERED") {
    return { state: "TRIGGERED_OUTSIDE_ZONE", zoneType: zoneType || null, shelfType: null, zoneId: zone?.id ?? null };
  }
  return { state: "NOT_IN_ZONE", zoneType: null, shelfType: null, zoneId: null };
}

/* -------------------- NEW: Golden Coil mode-aware flag -------------------- */
function computeGoldenCoil({ mode, flags, compression, reaction }) {
  const goldenIgnition = flags?.goldenIgnition === true;

  if (!goldenIgnition) return false;

  if (mode === "scalp") {
    // Scalp: show golden coil when we are ARMED in golden rule and compression has meaningful score
    return reaction?.armed === true && (Number(compression?.score) || 0) >= 8;
  }

  // Swing/Long: classic rule
  return compression?.active === true && compression?.state === "COILING";
}

/* -------------------- Engine 3 weighting -------------------- */
function reactionPartForMode({ mode, reaction }) {
  const score = clamp(Number(reaction?.reactionScore ?? 0), 0, 10);
  const stage = String(reaction?.stage || "IDLE").toUpperCase();
  const structureState = String(reaction?.structureState || "HOLD").toUpperCase();
  const reasonCodes = Array.isArray(reaction?.reasonCodes) ? reaction.reasonCodes : [];

  if (reasonCodes.includes("NOT_IN_ZONE")) return 0;
  if (structureState === "FAILURE") return 0;

  // Scalp: stage-first 0..15
  if (mode === "scalp") {
    let base = 0;
    if (stage === "ARMED") base = 6;
    else if (stage === "TRIGGERED") base = 12;
    else if (stage === "CONFIRMED") base = 15;
    else base = 0;

    // optional trim (0..3)
    const trim = clamp(score - 5, 0, 3);
    return clamp(base + trim, 0, 15);
  }

  // Swing/Long: score-first 0..15
  return clamp(score * 1.5, 0, 15);
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
  zoneRefOverride, // optional: provided by route to prevent "system off" for scalp
  weights = { e1: 0.60, e2: 0.15, e3: 0.10, e4: 0.15 },
  engine1WeakCapThreshold = 50,
  engine1WeakCapValue = 55,
}) {
  const reasons = [];
  const flags = {};

  const strategyMode = mode || (String(strategyId || "").includes("intraday_scalp") ? "scalp" : "swing");

  const { zone: execZone, zoneType: execZoneType } = getExecutionZone({
    engine1Context,
    zoneRefOverride,
  });

  // HARD GATE: fib invalidation (74%)
  const fibSignals = fib?.signals || {};
  const fibInvalidated = isTrue(fibSignals.invalidated);
  flags.fibInvalidated = fibInvalidated;

  // Determine institutional container for golden ignition (Engine 1 truth)
  const institutionalContainer = engine1Context?.active?.institutional ?? null;

  // Determine zoneType for flags: use execution zone type if available, else from engine1
  flags.zoneType = execZoneType;

  // If we have no execZone and we’re not in scalp TRIGGERED, we gate
  const scalpTriggered = strategyMode === "scalp" && String(reaction?.stage || "").toUpperCase() === "TRIGGERED";

  if (!execZone && !scalpTriggered) {
    return {
      ok: true,
      symbol,
      tf,
      degree,
      wave,
      invalid: true,
      reasonCodes: ["NO_ZONE_NO_TRADE"],
      tradeReady: false,
      bias: null,
      price,
      location: deriveLocationState(engine1Context, null, null, strategyMode, reaction),
      scores: { engine1: 0, engine2: 0, engine3: 0, engine4: 0, compression: 0, total: 0, label: "IGNORE" },
      flags: { zoneType: null, tradeReady: false, fibInvalidated },
      context: { activeZone: null },
      targets: { entryTarget: null, exitTarget: null, exitTargetHi: null, exitTargetLo: null },
      volumeState: "NO_SIGNAL",
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
    };
  }

  if (fibInvalidated) {
    return {
      ok: true,
      symbol,
      tf,
      degree,
      wave,
      invalid: true,
      reasonCodes: ["FIB_INVALIDATION_74"],
      tradeReady: false,
      bias: calcBiasFromZone(execZone),
      price,
      location: deriveLocationState(engine1Context, execZone, execZoneType, strategyMode, reaction),
      scores: { engine1: 0, engine2: 0, engine3: 0, engine4: 0, compression: 0, total: 0, label: "IGNORE" },
      flags,
      context: { activeZone: execZone, fib },
      targets: {
        entryTarget: execZone ? midpoint(execZone.lo, execZone.hi) : null,
        exitTarget: null,
        exitTargetHi: execZone?.hi ?? null,
        exitTargetLo: execZone?.lo ?? null,
      },
      volumeState: deriveVolumeState(volume),
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
    };
  }

  // Institutional dead gate ONLY if execution zone is institutional
  if (execZoneType === "INSTITUTIONAL" && institutionalIsDead(execZone)) {
    return {
      ok: true,
      symbol,
      tf,
      degree,
      wave,
      invalid: true,
      reasonCodes: ["ZONE_ARCHIVED_OR_EXITED"],
      tradeReady: false,
      bias: null,
      price,
      location: deriveLocationState(engine1Context, execZone, execZoneType, strategyMode, reaction),
      scores: { engine1: 0, engine2: 0, engine3: 0, engine4: 0, compression: 0, total: 0, label: "IGNORE" },
      flags,
      context: { activeZone: execZone, fib },
      targets: {
        entryTarget: midpoint(execZone.lo, execZone.hi),
        exitTarget: null,
        exitTargetHi: execZone?.hi ?? null,
        exitTargetLo: execZone?.lo ?? null,
      },
      volumeState: deriveVolumeState(volume),
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
    };
  }

  // Golden ignition detection: negotiated ignition inside institutional container
  const inGoldenIgnition = (execZoneType === "NEGOTIATED" && !!institutionalContainer);
  flags.goldenIgnition = inGoldenIgnition;
  flags.tradeReady = true;

  // Engine 1 score base (prefer institutional strength if golden ignition)
  let e1Score = clamp(Number(execZone?.readiness ?? execZone?.strength ?? 0), 0, 100);

  if (inGoldenIgnition) {
    const instStrength = toNum(institutionalContainer?.strength ?? institutionalContainer?.readiness);
    if (instStrength != null) {
      e1Score = Math.max(e1Score, clamp(instStrength, 0, 100));
    } else {
      e1Score = Math.max(e1Score, 70);
      reasons.push("GOLDEN_IGNITION_LOCATION");
    }
  }

  // Engine 2 score (0..20)
  const e2Score = clamp(calcEngine2Score(fib), 0, 20);

  // Engine 3 contribution (0..15) based on mode + stage
  const e3Part = reactionPartForMode({ mode: strategyMode, reaction });

  // Engine 4 score (0..15)
  const e4ScoreRaw = clamp(Number(volume?.volumeScore ?? 0), 0, 15);

  // Soft caps/penalties
  const liquidityTrap = isTrue(volume?.flags?.liquidityTrap);
  flags.liquidityTrap = liquidityTrap;

  let e4Capped = e4ScoreRaw;
  if (liquidityTrap) {
    reasons.push("VOLUME_TRAP_SUSPECTED");
    e4Capped = Math.min(e4Capped, 3);
  }

  // Reaction weak signal (keep for UI reasons)
  if ((reaction?.reactionScore ?? 0) <= 2) {
    reasons.push("REACTION_WEAK");
  }

  // Compression
  let compression = { active: false, tier: "NONE", score: 0, state: "NONE" };
  if (execZoneType === "NEGOTIATED" || execZoneType === "INSTITUTIONAL") {
    compression = computeCompression({ zone: execZone, zoneType: execZoneType, fib, volume });
  }

  // Normalize components to 0..100
  const e1Norm = e1Score;
  const e2Norm = (e2Score / 20) * 100;
  const e3Norm = (e3Part / 15) * 100;     // stage-based for scalp
  const e4Norm = (e4Capped / 15) * 100;

  let total =
    weights.e1 * e1Norm +
    weights.e2 * e2Norm +
    weights.e3 * e3Norm +
    weights.e4 * e4Norm;

  // Weak location cap (disabled in golden ignition)
  if (!inGoldenIgnition && e1Score < engine1WeakCapThreshold) {
    reasons.push("ENGINE1_WEAK_LOCATION");
    total = Math.min(total, engine1WeakCapValue);
  }

  // Pre-ignition boost
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

  // ✅ mode-aware golden coil flag for UI (fixes Scalp mismatch)
  flags.goldenCoil = computeGoldenCoil({ mode: strategyMode, flags, compression, reaction });

  return {
    ok: true,
    symbol,
    tf,
    degree,
    wave,
    invalid: false,
    reasonCodes: reasons,
    tradeReady: true,
    bias,
    price,
    location: deriveLocationState(engine1Context, execZone, execZoneType, strategyMode, reaction),
    scores: {
      engine1: Math.round(e1Score),
      engine2: Math.round(e2Score),
      engine3: Math.round((e3Part / 15) * 15), // keep on 0..15 scale feel
      engine4: Number(e4ScoreRaw.toFixed(2)),
      compression: compression.score,
      total,
      label,
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
          }
        : null,
      institutionalContainer: institutionalContainer ?? null,
      fib,
      reaction,
      volume,
    },
    targets: { entryTarget, exitTarget, exitTargetHi, exitTargetLo },
    volumeState,
    compression,
  };
}
