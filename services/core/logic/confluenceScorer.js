// src/services/core/logic/confluenceScorer.js
// FULL FILE REWRITE (per your request)
// Includes:
// ✅ Option B Compression v1 tuned (COILING <= 0.80, Quiet = TR-only)
// ✅ Golden Ignition preserved
// ✅ Locked gates preserved
// ✅ NEW: location.state (GOLDEN_RULE / INSTITUTIONAL / ACCUM/DIST SHELF / NOT_IN_ZONE)

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

// ✅ NEW: user-requested location state strings
function deriveLocation(engine1Context, activeZone, zoneType) {
  const act = engine1Context?.active || {};
  const neg = act.negotiated ?? null;
  const shelf = act.shelf ?? null;
  const inst = act.institutional ?? null;

  if (!neg && !shelf && !inst) {
    return {
      state: "NOT_IN_ZONE",
      zoneType: null,
      shelfType: null,
      zoneId: null,
    };
  }

  if (neg) {
    return {
      state: "PRICE_IN_GOLDEN_RULE",
      zoneType: "NEGOTIATED",
      shelfType: null,
      zoneId: neg.id ?? null,
    };
  }

  if (shelf) {
    const t = String(shelf.type || "").toLowerCase();
    const shelfType =
      t === "accumulation" ? "accumulation" :
      t === "distribution" ? "distribution" :
      null;

    return {
      state:
        shelfType === "distribution"
          ? "PRICE_IN_DISTRIBUTION_SHELF"
          : "PRICE_IN_ACCUMULATION_SHELF",
      zoneType: "SHELF",
      shelfType,
      zoneId: shelf.id ?? null,
    };
  }

  return {
    state: "PRICE_IN_INSTITUTIONAL_ZONE",
    zoneType: "INSTITUTIONAL",
    shelfType: null,
    zoneId: inst?.id ?? activeZone?.id ?? null,
  };
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
  const t = String(tf || "").toLowerCase();
  if (t === "10m") return 24;
  if (t === "15m") return 20;
  if (t === "30m") return 16;
  if (t === "1h") return 12;
  if (t === "4h") return 6;
  if (t === "1d") return 4;
  return 12;
}

function readBarsInZone(zone) {
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

// ---- Option B v1 tuned helpers ----
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
  // 0–20
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
  return Math.round((n20 / 20) * 7); // 0–7
}

/**
 * Tiered Compression / Pre-Ignition (Option B v1 tuned)
 *
 * NEGOTIATED (max 30):
 *  - squeeze 0..20
 *  - quiet  0..10 (TR-only)
 *
 * INSTITUTIONAL (max 10):
 *  - squeeze 0..7
 *  - quiet  0..3 (TR-only)
 *
 * State rules:
 *  - COILING if ratio <= 0.80 AND quiet=true
 *  - COMPRESSING if ratio <= 1.10
 *  - NONE otherwise
 */
function computeCompression({ zone, zoneType, tf, fib, volume }) {
  if (!zone || !zoneType) {
    return {
      active: false, tier: "NONE", score: 0, state: "NONE",
      zoneWidth: null, atr: null, widthAtrRatio: null,
      quiet: false, barsInZone: null, barsThreshold: null,
      reasons: [],
    };
  }

  const tier =
    zoneType === "NEGOTIATED" ? "NEGOTIATED" :
    zoneType === "INSTITUTIONAL" ? "INSTITUTIONAL" :
    "NONE";

  if (tier === "NONE") {
    return {
      active: false, tier, score: 0, state: "NONE",
      zoneWidth: null, atr: null, widthAtrRatio: null,
      quiet: false, barsInZone: null, barsThreshold: null,
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

  const reasons = ["IN_COMPRESSION_ZONE"];

  // Quiet (TR-only v1)
  const avgTR8 = readAvgTR8(volume?.diagnostics);
  let quiet = false;

  if (avgTR8 != null && atr != null && atr > 0) {
    quiet = avgTR8 <= 0.80 * atr;
    reasons.push(quiet ? "QUIET_TR_OK" : "QUIET_TR_HIGH");
  } else {
    // fallback if TR metric missing: non-igniting proxy
    const f = volume?.flags || {};
    const hasInitiative = isTrue(f.initiativeMoveConfirmed);
    const hasTrap = isTrue(f.liquidityTrap);
    quiet = !hasInitiative && !hasTrap;
    reasons.push("QUIET_FALLBACK_NO_TR_METRIC");
    if (hasTrap) reasons.push("TRAP_PRESENT");
    if (hasInitiative) reasons.push("INITIATIVE_PRESENT");
  }

  // Squeeze score
  const squeeze =
    tier === "NEGOTIATED"
      ? squeezeScoreNegotiated(widthAtrRatio)
      : squeezeScoreInstitutional(widthAtrRatio);

  if (widthAtrRatio == null) reasons.push("NO_ATR_TIGHTNESS_METRIC");
  else if (widthAtrRatio <= 0.60) reasons.push("SQUEEZE_STRONG");
  else if (widthAtrRatio <= 0.90) reasons.push("SQUEEZE_GOOD");
  else if (widthAtrRatio <= 1.20) reasons.push("SQUEEZE_WEAK");
  else reasons.push("SQUEEZE_NONE");

  // Quiet score
  const quietScore =
    tier === "NEGOTIATED"
      ? (quiet ? 10 : 0)
      : (quiet ? 3 : 0);

  const cap = tier === "NEGOTIATED" ? 30 : 10;
  let score = clamp(Math.round(squeeze + quietScore), 0, cap);

  // State rules
  let state = "NONE";
  if (widthAtrRatio != null) {
    if (widthAtrRatio <= 0.80 && quiet) state = "COILING";
    else if (widthAtrRatio <= 1.10) state = "COMPRESSING";
    else state = "NONE";
  }

  const activeThreshold = tier === "NEGOTIATED" ? 18 : 6;
  const active = state === "COILING" && score >= activeThreshold;

  const barsInZone = readBarsInZone(zone);
  const barsThreshold = tfToCompressionBars(tf);

  return {
    active,
    tier,
    score,
    state,
    zoneWidth,
    atr,
    widthAtrRatio: widthAtrRatio != null ? Number(widthAtrRatio.toFixed(3)) : null,
    quiet,
    barsInZone,
    barsThreshold,
    reasons: [...reasons, `SQUEEZE=${squeeze}`, `QUIET=${quietScore}`],
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
    const location = deriveLocation(engine1Context, null, null);

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
      location,
      scores: {
        engine1: 0, engine2: 0, engine3: 0, engine4: 0,
        compression: 0, total: 0, label: "IGNORE"
      },
      flags: { zoneType: null, tradeReady: false },
      context: { activeZone: null },
      targets: { entryTarget: null, exitTarget: null, exitTargetHi: null, exitTargetLo: null },
      volumeState: "NO_SIGNAL",
      compression: { active: false, tier: "NONE", score: 0, state: "NONE" },
    };
  }

  flags.zoneType = zoneType;
  flags.tradeReady = true;

  const location = deriveLocation(engine1Context, activeZone, zoneType);

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
      location,
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
      location,
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

  // ✅ Golden ignition detection:
  // Negotiated ignition zone inside institutional container = best possible location
  const institutionalContainer = engine1Context?.active?.institutional ?? null;
  const inGoldenIgnition = (zoneType === "NEGOTIATED" && !!institutionalContainer);

  // Engine 1 score base
  let e1Score = clamp(Number(activeZone.readiness ?? activeZone.strength ?? 0), 0, 100);

  // Golden ignition floor
  if (inGoldenIgnition) {
    const instStrength = toNum(institutionalContainer?.strength ?? institutionalContainer?.readiness);
    if (instStrength != null) {
      e1Score = Math.max(e1Score, clamp(instStrength, 0, 100));
    } else {
      e1Score = Math.max(e1Score, 70);
      reasons.push("GOLDEN_IGNITION_LOCATION");
    }
  }

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
  // Compression (tiered) — Option B tuned
  // ----------------------------
  let compression = { active: false, tier: "NONE", score: 0, state: "NONE" };
  if (zoneType === "NEGOTIATED" || zoneType === "INSTITUTIONAL") {
    compression = computeCompression({ zone: activeZone, zoneType, tf, fib, volume });
  }

  // Weighted 0–100 (LOCKED scale)
  const e1Nor
