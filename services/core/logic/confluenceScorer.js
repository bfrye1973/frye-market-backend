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
  const a = Number(lo);
  const b = Number(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Number(((a + b) / 2).toFixed(2));
}

function isTruthy(x) {
  return x === true;
}

// LOCKED priority: negotiated -> shelf -> institutional
function getActiveZone(ctx) {
  const neg = ctx?.active?.negotiated ?? null;
  const shelf = ctx?.active?.shelf ?? null;
  const inst = ctx?.active?.institutional ?? null;

  const zone = neg || shelf || inst || null;

  if (!zone) return { zone: null, zoneType: null };

  // Determine type label for UI
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
  if (isTruthy(s.inRetraceZone)) score += 10;
  if (isTruthy(s.near50)) score += 10;
  return score; // 0..20
}

function calcBiasFromZone(zone, zoneType) {
  // Prefer shelf semantics (accumulation/distribution) when available
  if (!zone) return null;

  const t = String(zone.type || zone.zoneType || "").toLowerCase();

  // If negotiated zones encode type like accumulation/distribution, honor it:
  if (t === "accumulation") return "long";
  if (t === "distribution") return "short";

  // If institutional-only, bias is unknown at Engine 5 level
  if (zoneType === "INSTITUTIONAL") return null;

  return null;
}

function deriveVolumeState(volume) {
  const note = String(volume?.diagnostics?.note || "");

  // If engine4 couldn't find a touch, keep it explicit
  if (note.includes("NO_TOUCH_FOUND")) return "NO_TOUCH";

  const f = volume?.flags || {};

  // Priority (LOCKED)
  if (isTruthy(f.liquidityTrap)) return "TRAP_SUSPECTED";
  if (isTruthy(f.initiativeMoveConfirmed)) return "INITIATIVE";
  if (isTruthy(f.volumeDivergence)) return "DIVERGENCE";
  if (isTruthy(f.absorptionDetected)) return "ABSORPTION";
  if (isTruthy(f.distributionDetected)) return "DISTRIBUTION";
  if (isTruthy(f.pullbackContraction)) return "PULLBACK_CONTRACTION";
  if (isTruthy(f.reversalExpansion)) return "REVERSAL_EXPANSION";

  return "NO_SIGNAL";
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

  const tradeReady = !!activeZone;

  flags.zoneType = zoneType;
  flags.tradeReady = tradeReady;

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
      scores: {
        engine1: 0,
        engine2: 0,
        engine3: 0,
        engine4: 0,
        total: 0,
        label: "IGNORE",
      },
      flags,
      context: {
        activeZone: null,
        institutional: engine1Context?.active?.institutional ?? null,
        negotiated: engine1Context?.active?.negotiated ?? null,
        shelf: engine1Context?.active?.shelf ?? null,
      },
      targets: {
        entryTarget: null,
        exitTarget: null,
        exitTargetHi: null,
        exitTargetLo: null,
      },
      volumeState: "NO_SIGNAL",
    };
  }

  // HARD GATE: fib invalidation (74%)
  const fibSignals = fib?.signals || {};
  const fibInvalidated = isTruthy(fibSignals.invalidated);
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
      scores: {
        engine1: 0,
        engine2: 0,
        engine3: 0,
        engine4: 0,
        total: 0,
        label: "IGNORE",
      },
      flags,
      context: {
        activeZone,
        institutional: engine1Context?.active?.institutional ?? null,
        negotiated: engine1Context?.active?.negotiated ?? null,
        shelf: engine1Context?.active?.shelf ?? null,
        fib,
      },
      targets: {
        entryTarget: midpoint(activeZone.lo, activeZone.hi),
        exitTarget: null,
        exitTargetHi: activeZone.hi ?? null,
        exitTargetLo: activeZone.lo ?? null,
      },
      volumeState: deriveVolumeState(volume),
    };
  }

  // HARD GATE: institutional dead/archived (only if institutional is involved as active zone)
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
      scores: {
        engine1: 0,
        engine2: 0,
        engine3: 0,
        engine4: 0,
        total: 0,
        label: "IGNORE",
      },
      flags,
      context: {
        activeZone,
        institutional: engine1Context?.active?.institutional ?? null,
        negotiated: engine1Context?.active?.negotiated ?? null,
        shelf: engine1Context?.active?.shelf ?? null,
        fib,
      },
      targets: {
        entryTarget: midpoint(activeZone.lo, activeZone.hi),
        exitTarget: null,
        exitTargetHi: activeZone.hi ?? null,
        exitTargetLo: activeZone.lo ?? null,
      },
      volumeState: deriveVolumeState(volume),
    };
  }

  // ----------------------------
  // Component scores
  // ----------------------------

  // Engine 1 score (0-100): use zone strength/readiness if present
  // negotiated/shelf likely have readiness/strength; institutional has strength.
  const e1Score = clamp(
    Number(activeZone.readiness ?? activeZone.strength ?? 0),
    0,
    100
  );

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

  const liquidityTrap = isTruthy(volume?.flags?.liquidityTrap);
  flags.liquidityTrap = liquidityTrap;

  let e4Capped = e4ScoreRaw;
  if (liquidityTrap) {
    reasons.push("VOLUME_TRAP_SUSPECTED");
    e4Capped = Math.min(e4Capped, 3);
  }

  const volumeConfirmed = isTruthy(volume?.volumeConfirmed);
  flags.volumeConfirmed = volumeConfirmed;

  // Weighted 0–100 (LOCKED scale)
  const e1Norm = e1Score;                 // already 0..100
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

  total = clamp(Math.round(total), 0, 100);
  const label = labelFromScore(total);

  // Targets (LOCKED rules)
  const entryTarget = midpoint(activeZone.lo, activeZone.hi);

  const bias = calcBiasFromZone(activeZone, zoneType);

  let exitTarget = null;
  const exitTargetHi = activeZone.hi ?? null;
  const exitTargetLo = activeZone.lo ?? null;

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
      total,
      label,
    },
    flags: {
      ...flags,
      zoneType,
    },
    context: {
      // UI-friendly: the exact zone used
      activeZone: {
        id: activeZone.id ?? null,
        zoneType,
        type: activeZone.type ?? null, // accumulation/distribution if present
        lo: activeZone.lo ?? null,
        hi: activeZone.hi ?? null,
        mid: activeZone.mid ?? entryTarget ?? null,
        strength: activeZone.strength ?? null,
        readiness: activeZone.readiness ?? null,
      },
      institutional: engine1Context?.active?.institutional ?? null,
      negotiated: engine1Context?.active?.negotiated ?? null,
      shelf: engine1Context?.active?.shelf ?? null,
      fib,
      reaction,
      volume,
    },
    targets: {
      entryTarget,
      exitTarget,
      exitTargetHi,
      exitTargetLo,
    },
    volumeState,
  };
}
