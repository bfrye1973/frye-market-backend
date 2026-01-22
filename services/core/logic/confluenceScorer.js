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

function isInsideZone(price, z) {
  if (price == null || !z) return false;
  const lo = Number(z.lo);
  const hi = Number(z.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  return price >= lo && price <= hi;
}

function pickBestInstitutional(institutionals, price) {
  const inside = (institutionals || []).filter(z => isInsideZone(price, z));
  if (!inside.length) return null;
  // pick highest strength (ties: narrower zone)
  inside.sort((a, b) => {
    const sa = Number(a.strength ?? 0);
    const sb = Number(b.strength ?? 0);
    if (sb !== sa) return sb - sa;
    const wa = Math.abs(Number(a.hi) - Number(a.lo));
    const wb = Math.abs(Number(b.hi) - Number(b.lo));
    return wa - wb;
  });
  return inside[0];
}

function pickBestShelf(shelves, price) {
  const inside = (shelves || []).filter(z => isInsideZone(price, z));
  if (!inside.length) return null;
  // pick highest readiness (fallback to strength)
  inside.sort((a, b) => {
    const ra = Number(a.readiness ?? a.strength ?? 0);
    const rb = Number(b.readiness ?? b.strength ?? 0);
    return rb - ra;
  });
  return inside[0];
}

/**
 * Engine 1 dead-zone gate (institutional only)
 * Spec (LOCKED):
 *  - sticky.status === "archived" OR sticky.archivedUtc exists OR
 *  - sticky.distinctExitCount >= 2 OR sticky.exits.length >= 2 OR
 *  - (exitSide1h exists AND exitBars1h > 0)
 */
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
  // max 20: +10 retrace zone, +10 near50
  const s = fib?.signals || {};
  let score = 0;
  if (s.inRetraceZone) score += 10;
  if (s.near50) score += 10;
  return score;
}

function calcBiasFromShelf(shelf) {
  if (!shelf) return null;
  const t = String(shelf.type || "").toLowerCase();
  if (t === "accumulation") return "long";
  if (t === "distribution") return "short";
  return null;
}

export function computeConfluenceScore({
  symbol,
  tf,
  degree,
  wave,
  price,
  engine1Context, // /engine5-context payload
  fibW1,          // /fib-levels payload (W1)
  reaction,       // /reaction-score payload
  volume,         // /volume-behavior payload
  weights = { e1: 0.60, e2: 0.15, e3: 0.10, e4: 0.15 },
  engine1WeakCapThreshold = 50,
  engine1WeakCapValue = 55,
}) {
  const reasons = [];
  const flags = {};

  const institutionals = engine1Context?.render?.institutional || [];
  const shelves = engine1Context?.render?.shelves || [];

  const inst = pickBestInstitutional(institutionals, price);
  const shelf = pickBestShelf(shelves, price);

  const inInstitutional = !!inst;
  const inShelf = !!shelf;
  const inZone = inInstitutional || inShelf;

  flags.inInstitutional = inInstitutional;
  flags.inShelf = inShelf;
  flags.inZone = inZone;

  // HARD GATE A: must be inside some zone
  if (!inZone) {
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
      flags: { ...flags, fibInvalidated: false },
      context: { institutional: null, shelf: null },
    };
  }

  // HARD GATE B: fib invalidation (74%)
  const fibSignals = fibW1?.signals || {};
  const fibInvalidated = !!fibSignals.invalidated;
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
      bias: calcBiasFromShelf(shelf),
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
      context: { institutional: inst ?? null, shelf: shelf ?? null, fib: fibW1 ?? null },
    };
  }

  // HARD GATE C: institutional dead/archived (only if institutional is involved)
  if (inInstitutional && institutionalIsDead(inst)) {
    return {
      ok: true,
      symbol,
      tf,
      degree,
      wave,
      invalid: true,
      reasonCodes: ["ZONE_ARCHIVED_OR_EXITED"],
      tradeReady: false,
      bias: calcBiasFromShelf(shelf),
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
      context: { institutional: inst, shelf: shelf ?? null, fib: fibW1 ?? null },
    };
  }

  // Engine 1 score (0-100): if both present, blend regime+readiness
  const instStrength = inInstitutional ? Number(inst.strength ?? 0) : 0;
  const shelfReadiness = inShelf ? Number(shelf.readiness ?? shelf.strength ?? 0) : 0;

  let engine1Score = 0;
  if (inInstitutional && inShelf) engine1Score = clamp(0.60 * instStrength + 0.40 * shelfReadiness, 0, 100);
  else if (inShelf) engine1Score = clamp(shelfReadiness, 0, 100);
  else engine1Score = clamp(instStrength, 0, 100);

  // Engine 2 score (0-20)
  const engine2Score = clamp(calcEngine2Score(fibW1), 0, 20);

  // Engine 3 score (0-10)
  const reactionScore = clamp(Number(reaction?.reactionScore ?? 0), 0, 10);

  // Engine 4 score (0-15)
  const volumeScoreRaw = clamp(Number(volume?.volumeScore ?? 0), 0, 15);

  // Caps (NOT hard gates)
  let reactionScoreCapped = reactionScore;
  if (reactionScore <= 2) {
    reasons.push("REACTION_WEAK");
    reactionScoreCapped = Math.min(reactionScoreCapped, 2);
  }

  let volumeScoreCapped = volumeScoreRaw;
  const liquidityTrap = !!volume?.flags?.liquidityTrap;
  flags.liquidityTrap = liquidityTrap;

  if (liquidityTrap) {
    reasons.push("VOLUME_TRAP_SUSPECTED");
    volumeScoreCapped = Math.min(volumeScoreCapped, 3);
  }

  const volumeConfirmed = !!volume?.volumeConfirmed;
  flags.volumeConfirmed = volumeConfirmed;

  // Weighted 0–100 assembly (recommended)
  const e1Norm = clamp(engine1Score, 0, 100);
  const e2Norm = clamp((engine2Score / 20) * 100, 0, 100);
  const e3Norm = clamp((reactionScoreCapped / 10) * 100, 0, 100);
  const e4Norm = clamp((volumeScoreCapped / 15) * 100, 0, 100);

  let total = (
    weights.e1 * e1Norm +
    weights.e2 * e2Norm +
    weights.e3 * e3Norm +
    weights.e4 * e4Norm
  );

  // Engine 1 weak-location cap (safety)
  if (engine1Score < engine1WeakCapThreshold) {
    reasons.push("ENGINE1_WEAK_LOCATION");
    total = Math.min(total, engine1WeakCapValue);
  }

  total = clamp(Math.round(total), 0, 100);

  const label = labelFromScore(total);
  const bias = calcBiasFromShelf(shelf);

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
      engine1: Math.round(engine1Score),
      engine2: Math.round(engine2Score),
      engine3: Number(reactionScore.toFixed(2)),
      engine4: Number(volumeScoreRaw.toFixed(2)),
      total,
      label,
      parts: {
        e1Norm: Number(e1Norm.toFixed(2)),
        e2Norm: Number(e2Norm.toFixed(2)),
        e3Norm: Number(e3Norm.toFixed(2)),
        e4Norm: Number(e4Norm.toFixed(2)),
        volumeScoreCapped: Number(volumeScoreCapped.toFixed(2)),
        reactionScoreCapped: Number(reactionScoreCapped.toFixed(2)),
      }
    },
    flags,
    context: {
      institutional: inst ?? null,
      shelf: shelf ?? null,
      engine1: {
        institutionalStrength: instStrength,
        shelfReadiness: shelfReadiness,
        engine1ScoreUsed: engine1Score,
      },
      fib: fibW1 ?? null,
      reaction: reaction ?? null,
      volume: volume ?? null,
      zoneUsed: inShelf
        ? { id: shelf?.id ?? null, source: "shelf", lo: shelf?.lo ?? null, hi: shelf?.hi ?? null }
        : { id: inst?.id ?? null, source: "institutional", lo: inst?.lo ?? null, hi: inst?.hi ?? null },
    }
  };
}
