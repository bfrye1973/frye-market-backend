// src/services/core/logic/confluenceScorer.js

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

function getActiveZone(ctx) {
  // LOCKED priority: negotiated -> shelf -> institutional
  const neg = ctx?.active?.negotiated ?? null;
  const shelf = ctx?.active?.shelf ?? null;
  const inst = ctx?.active?.institutional ?? null;

  const zone = neg || shelf || inst || null;

  if (!zone) return { zone: null, zoneType: null };
  if (neg) return { zone, zoneType: "NEGOTIATED" };
  if (shelf) return { zone, zoneType: "SHELF" };
  return { zone, zoneType: "INSTITUTIONAL" };
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

function calcBiasFromZone(zone, zoneType) {
  if (!zone) return null;

  const t = String(zone.type || zone.zoneType || "").toLowerCase();
  if (t === "accumulation") return "long";
  if (t === "distribution") return "short";

  if (zoneType === "INSTITUTIONAL") return null;
  return null;
}

function deriveVolumeState(volume) {
  const note = String(volume?.diagnostics?.note || "");
  if (note.includes("NO_TOUCH_FOUND")) return "NO_TOUCH";

  const f = volume?.flags || {};
  // Priority (LOCKED)
  if (isTrue(f.liquidityTrap)) return "TRAP_SUSPECTED";
  if (isTrue(f.initiativeMoveConfirmed)) return "INITIATIVE";
  if (isTrue(f.volumeDivergence)) return "DIVERGENCE";
  if (isTrue(f.absorptionDetected)) return "ABSORPTION";
  if (isTrue(f.distributionDetected)) return "DISTRIBUTION";
  if (isTrue(f.pullbackContraction)) return "PULLBACK_CONTRACTION";
  if (isTrue(f.reversalExpansion)) return "REVERSAL_EXPANSION";
  return "NO_SIGNAL";
}

function tfToCompressionBars(tf) {
  // Optional time-in-zone bonus thresholds
  // (we do NOT require this; it only adds points if present)
  const t = String(tf || "").toLowerCase();
  if (t === "10m") return 24; // ~4 hours
  if (t === "15m") return 20;
  if (t === "30m") return 16;
  if (t === "1h") return 12;  // ~half day
  if (t === "4h") return 6;   // ~1 day
  if (t === "1d") return 4;   // ~a week (loose)
  return 12;
}

function readBarsInZone(zone) {
  // Optional – read whatever Engine 1 exposes (defensive)
  // If none exist, we simply do not award time-in-zone points.
  const candidates = [
    zone?.barsInZone,
    zone?.bars_in_zone,
    zone?.details?.facts?.barsInZone,
    zone?.details?.facts?.bars_in_zone,
    zone?.details?.facts?.barsInside,
    zone?.details?.facts?.bars_inside,
    zone?.details?.facts?.insideBars,
    zone?.details?.facts?.inside_bars,
    zone?.details?.facts?.durationBars,
  ];
  for (const c of candidates) {
    const n = toNum(c);
    if (n != null) return n;
  }
  return null;
}

/**
 * ✅ NEW: Tiered Compression / Pre-Ignition
 *
 * Option B locked:
 * - Primary: ATR-tightness (zoneWidth / ATR)
 * - Secondary: time-in-zone optional bonus (if provided)
 *
 * Major: NEGOTIATED max 30
 * Minor: INSTITUTIONAL max 10 (only when no negotiated active; enforced by caller)
 *
 * Requires "quiet" to be considered "COILING":
 * - no initiativeMoveConfirmed
 * - no liquidityTrap
 */
function computeCompression({ zone, zoneType, tf, fib, volume }) {
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
      barsInZone: null,
      barsThreshold: null,
      reasons: [],
    };
  }

  const tier =
    zoneType === "NEGOTIATED" ? "NEGOTIATED" :
    zoneType === "INSTITUTIONAL" ? "INSTITUTIONAL" :
    "NONE";

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
      barsInZone: null,
      barsThreshold: null,
      reasons: [],
    };
  }

  const lo = toNum(zone.lo);
  const hi = toNum(zone.hi);
  const zoneWidth = (lo != null && hi != null) ? Math.abs(hi - lo) : null;

  const atr =
    toNum(volume?.diagnostics?.atr) ??
    toNum(fib?.diagnostics?.atr) ??
    null;

  const widthAtrRatio =
    zoneWidth != null && atr != null && atr > 0
      ? zoneWidth / atr
      : null;

  const f = volume?.flags || {};
  const hasInitiative = isTrue(f.initiativeMoveConfirmed);
  const hasTrap = isTrue(f.liquidityTrap);

  const quiet = !hasInitiative && !hasTrap;

  const reasons = [];

  // If not quiet, we still report state but do NOT give pre-ignition credit.
  if (!quiet) {
    const st = hasTrap ? "TRAP_SUSPECTED" : "IGNITING";
    return {
      active: false,
      tier,
      score: 0,
      state: st,
      zoneWidth,
      atr,
      widthAtrRatio: widthAtrRatio != null ? Number(widthAtrRatio.toFixed(3)) : null,
      quiet: false,
      barsInZone: readBarsInZone(zone),
      barsThreshold: tfToCompressionBars(tf),
      reasons: [hasTrap ? "TRAP_PRESENT" : "INITIATIVE_PRESENT"],
    };
  }

  // Quiet: now we can compute COILING score.
  let score = 0;

  // Base credit for being in a compression-eligible zone type
  score += (tier === "NEGOTIATED" ? 8 : 2);
  reasons.push("IN_COMPRESSION_ZONE");

  // ATR tightness credit (primary)
  if (widthAtrRatio != null) {
    // Smaller ratio => tighter
    if (tier === "NEGOTIATED") {
      if (widthAtrRatio <= 0.60) { score += 14; reasons.push("TIGHT_VS_ATR_STRONG"); }
      else if (widthAtrRatio <= 0.80) { score += 10; reasons.push("TIGHT_VS_ATR_GOOD"); }
      else if (widthAtrRatio <= 1.00) { score += 6; reasons.push("TIGHT_VS_ATR_OK"); }
      else { score += 2; reasons.push("TIGHT_VS_ATR_WEAK"); }
    } else {
      // institutional minor credit
      if (widthAtrRatio <= 0.80) { score += 4; reasons.push("TIGHT_VS_ATR_GOOD"); }
      else if (widthAtrRatio <= 1.00) { score += 3; reasons.push("TIGHT_VS_ATR_OK"); }
      else if (widthAtrRatio <= 1.20) { score += 2; reasons.push("TIGHT_VS_ATR_WEAK"); }
      else { score += 1; reasons.push("TIGHT_VS_ATR_LOOSE"); }
    }
  }

  // Quiet participation credit
  score += (tier === "NEGOTIATED" ? 6 : 2);
  reasons.push("VOLUME_QUIET");

  // Time-in-zone bonus (OPTIONAL, secondary)
  const barsInZone = readBarsInZone(zone);
  const barsThreshold = tfToCompressionBars(tf);
  if (barsInZone != null && barsInZone >= barsThreshold) {
    score += (tier === "NEGOTIATED" ? 6 : 2);
    reasons.push("TIME_IN_ZONE_CONFIRMED");
  }

  const cap = (tier === "NEGOTIATED" ? 30 : 10);
  score = clamp(Math.round(score), 0, cap);

  return {
    active: score >= (tier === "NEGOTIATED" ? 18 : 6),
    tier,
    score,
    state: score >= (tier === "NEGOTIATED" ? 22 : 8) ? "COILING" : "COMPRESSING",
    zoneWidth,
    atr,
    widthAtrRatio: widthAtrRatio != null ? Number(widthAtrRatio.toFixed(3)) : null,
    quiet: true,
    barsInZone,
    barsThreshold,
    reasons,
  };
}

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
  weights = { e1: 0.60, e2: 0.15, e3: 0.10, e4: 0.15 },
  engine1WeakCapThreshold = 50,
  engine1WeakCapValue = 55,
}) {
  const reasons = [];
  const flags = {};

  const { zone: activeZone, zoneType } = getActiveZone(engine1Context);

  // HARD GATE: must be inside an active zone
  if (!activeZone) {
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
      scores: { engine1: 0, engine2: 0, engine3: 0, engine4: 0, compression: 0, total: 0, label: "IGNORE" },
      flags: { zoneType: null, tradeReady: false },
      context: { activeZone: null },
      targets: { entryTarget: null, exitTarget: null, exitTargetHi: null, exitTargetLo: null },
      volumeState: "NO_SIGNAL",
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
    };
  }

  flags.zoneType = zoneType;
  flags.tradeReady = true;

  // HARD GATE: fib invalidation (74%)
  const fibSignals = fib?.signals || {};
  const fibInvalidated = isTrue(fibSignals.invalidated);
  flags.fibInvalidated = fibInvalidated;

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
      bias: calcBiasFromZone(activeZone, zoneType),
      price,
      scores: { engine1: 0, engine2: 0, engine3: 0, engine4: 0, compression: 0, total: 0, label: "IGNORE" },
      flags,
      context: { activeZone, fib },
      targets: {
        entryTarget: midpoint(activeZone.lo, activeZone.hi),
        exitTarget: null,
        exitTargetHi: activeZone.hi ?? null,
        exitTargetLo: activeZone.lo ?? null,
      },
      volumeState: deriveVolumeState(volume),
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
    };
  }

  // HARD GATE: institutional dead/archived (only if institutional is ACTIVE zone)
  if (zoneType === "INSTITUTIONAL" && institutionalIsDead(activeZone)) {
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
      scores: { engine1: 0, engine2: 0, engine3: 0, engine4: 0, compression: 0, total: 0, label: "IGNORE" },
      flags,
      context: { activeZone, fib },
      targets: {
        entryTarget: midpoint(activeZone.lo, activeZone.hi),
        exitTarget: null,
        exitTargetHi: activeZone.hi ?? null,
        exitTargetLo: activeZone.lo ?? null,
      },
      volumeState: deriveVolumeState(volume),
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
    };
  }

  // ----------------------------
  // Component scores
  // ----------------------------

  // Engine 1 score (0-100): use readiness/strength if present
  const e1Score = clamp(Number(activeZone.readiness ?? activeZone.strength ?? 0), 0, 100);

  // Engine 2 score (0-20)
  const e2Score = clamp(calcEngine2Score(fib), 0, 20);

  // Engine 3 score (0-10)
  const e3Score = clamp(Number(reaction?.reactionScore ?? 0), 0, 10);

  // Engine 4 score (0-15)
  const e4ScoreRaw = clamp(Number(volume?.volumeScore ?? 0), 0, 15);

  // Caps (NOT hard gates)
  let e3Capped = e3Score;
  if (e3Score <= 2) {
    reasons.push("REACTION_WEAK");
    e3Capped = Math.min(e3Capped, 2);
  }

  const liquidityTrap = isTrue(volume?.flags?.liquidityTrap);
  flags.liquidityTrap = liquidityTrap;

  let e4Capped = e4ScoreRaw;
  if (liquidityTrap) {
    reasons.push("VOLUME_TRAP_SUSPECTED");
    e4Capped = Math.min(e4Capped, 3);
  }

  const volumeConfirmed = isTrue(volume?.volumeConfirmed);
  flags.volumeConfirmed = volumeConfirmed;

  // ----------------------------
  // ✅ NEW: Tiered compression
  // Major: negotiated, Minor: institutional (only when no negotiated active)
  // If active zone is SHELF, we do not add compression credit here.
  // ----------------------------
  let compression = { active: false, tier: "NONE", score: 0, state: "NONE" };

  if (zoneType === "NEGOTIATED") {
    compression = computeCompression({ zone: activeZone, zoneType, tf, fib, volume });
  } else if (zoneType === "INSTITUTIONAL") {
    compression = computeCompression({ zone: activeZone, zoneType, tf, fib, volume });
  }

  // Weighted 0–100 (LOCKED scale)
  const e1Norm = e1Score;                 // 0..100
  const e2Norm = (e2Score / 20) * 100;    // 0..100
  const e3Norm = (e3Capped / 10) * 100;   // 0..100
  const e4Norm = (e4Capped / 15) * 100;   // 0..100

  let total =
    weights.e1 * e1Norm +
    weights.e2 * e2Norm +
    weights.e3 * e3Norm +
    weights.e4 * e4Norm;

  // Engine 1 weak-location cap (safety)
  if (e1Score < engine1WeakCapThreshold) {
    reasons.push("ENGINE1_WEAK_LOCATION");
    total = Math.min(total, engine1WeakCapValue);
  }

  // ✅ Add compression as a PRE-IGNITION boost (Option B: ATR-first, time optional)
  // This is the “ready to explode” early warning you want.
  if (compression?.score > 0) {
    total += compression.score;
    if (compression.active) reasons.push("COILING_PRE_IGNITION");
  }

  total = clamp(Math.round(total), 0, 100);
  const label = labelFromScore(total);

  const entryTarget = midpoint(activeZone.lo, activeZone.hi);
  const bias = calcBiasFromZone(activeZone, zoneType);

  const exitTargetHi = activeZone.hi ?? null;
  const exitTargetLo = activeZone.lo ?? null;
  let exitTarget = null;
  if (bias === "long") exitTarget = exitTargetHi;
  if (bias === "short") exitTarget = exitTargetLo;

  const volumeState = deriveVolumeState(volume);

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
    scores: {
      engine1: Math.round(e1Score),
      engine2: Math.round(e2Score),
      engine3: Number(e3Score.toFixed(2)),
      engine4: Number(e4ScoreRaw.toFixed(2)),
      compression: compression.score,
      total,
      label,
    },
    flags: { ...flags, zoneType },
    context: {
      activeZone: {
        id: activeZone.id ?? null,
        zoneType,
        type: activeZone.type ?? null,
        lo: activeZone.lo ?? null,
        hi: activeZone.hi ?? null,
        mid: activeZone.mid ?? entryTarget ?? null,
        strength: activeZone.strength ?? null,
        readiness: activeZone.readiness ?? null,
      },
      fib,
      reaction,
      volume,
    },
    targets: { entryTarget, exitTarget, exitTargetHi, exitTargetLo },
    volumeState,
    compression,
  };
}
