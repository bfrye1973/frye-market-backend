// src/services/core/logic/confluenceScorer.js
// Unified confluence scoring (multi-engine) — v1: SMZ + Fib
// LOCKED: Engine 2 is gate + boost only, never a trade signal.

export function scoreConfluence({
  smzZone,     // object that includes SMZ institutional score + diagnostics
  fib,         // Engine 2 payload from /api/v1/fib-levels
  weights = {},
}) {
  const W = {
    smz: 80,     // base engine weight bucket
    fibMax: 20,  // Engine 2 max contribution
    ...weights,
  };

  const reasons = [];
  const detail = {
    smz: { score: 0 },
    fib: { boost: 0, gated: false, invalid: false },
  };

  // -----------------------
  // 1) Engine 1 base score
  // -----------------------
  const smzScore = clamp01to100(Number(smzZone?.score ?? smzZone?.institutionalScore ?? 0));
  detail.smz.score = smzScore;

  // If SMZ score is 0, we can treat as invalid setup (optional).
  // For now: don’t hard-kill; just let it score low.
  let total = smzScore * (W.smz / 100);

  // -----------------------
  // 2) Engine 2 EARLY GATE
  // -----------------------
  if (!fib || fib.ok !== true) {
    // If anchors are missing/invalid, this confluence setup cannot be evaluated.
    // Match your rule: invalid=true, total=0 with reason.
    return finalizeInvalid({
      reasons: ["FIB_NO_DATA"],
      detail: { ...detail, fib: { ...detail.fib, invalid: true, boost: 0 } },
    });
  }

  if (fib?.signals?.invalidated) {
    return finalizeInvalid({
      reasons: ["FIB_INVALIDATION_74"],
      detail: { ...detail, fib: { ...detail.fib, invalid: true, boost: 0 } },
    });
  }

  // -----------------------
  // 3) Engine 2 LATE BOOST
  // -----------------------
  let fibBoost = 0;
  if (fib?.signals?.inRetraceZone) fibBoost += 10;
  if (fib?.signals?.near50) fibBoost += 10;

  // Optional: W4 context caps boost (as previously recommended)
  if (fib?.anchors?.context === "W4") fibBoost = Math.min(fibBoost, 10);

  detail.fib.boost = fibBoost;

  // Apply boost into total
  total += fibBoost;

  // Clamp final score
  total = clamp01to100(total);

  // Flags
  if (!fib?.signals?.inRetraceZone) {
    detail.fib.gated = true; // “not in value”; not invalid, but tells UI/logic
    reasons.push("FIB_OUTSIDE_RETRACE_ZONE");
  }

  return {
    ok: true,
    invalid: false,
    total,
    reasons,
    detail,
  };
}

// ---------- helpers ----------
function clamp01to100(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}

function finalizeInvalid({ reasons, detail }) {
  return {
    ok: true,
    invalid: true,
    total: 0,
    reasons,
    detail,
  };
}
