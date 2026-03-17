// services/core/logic/engine6TradePermission.js
// ENGINE 6 — Trade Permission Matrix (AUTHORITATIVE)
//
// Decides:
//   - IF trades are allowed
//   - WHAT type of trades are allowed
//   - HOW aggressive sizing may be
//
// IMPORTANT:
// - Pure logic only
// - No Express
// - No side effects
// - Never infers lateness or context
// - Consumes upstream metadata ONLY

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function baseConstraints() {
  return {
    mustEnterWithinZone: true,
    noChaseOutsideZone: true,
    requireHigherTFBiasAlignment: true,
  };
}

// LOCKED: only take NEW entries in these zones
const ALLOWED_ZONES_PRIMARY = ["NEGOTIATED", "INSTITUTIONAL"];

function standDown(reasonCodes, debug, allowedZonesOverride = null) {
  return {
    permission: "STAND_DOWN",
    sizeMultiplier: 0.0,
    allowedTradeTypes: [],
    // Include allowedZones for UI clarity (LOCKED improvement)
    allowedZones: allowedZonesOverride || {
      primary: ALLOWED_ZONES_PRIMARY,
      secondary: [],
    },
    entryConstraints: baseConstraints(),
    reasonCodes,
    debug,
  };
}

function reduce(reasonCodes, debug) {
  return {
    permission: "REDUCE",
    sizeMultiplier: 0.5,
    allowedTradeTypes: ["PULLBACK"],
    allowedZones: {
      primary: ["NEGOTIATED"],
      secondary: ["INSTITUTIONAL", "SHELF"],
    },
    entryConstraints: baseConstraints(),
    reasonCodes,
    debug,
  };
}

function allow(reasonCodes, debug) {
  return {
    permission: "ALLOW",
    sizeMultiplier: 1.0,
    allowedTradeTypes: ["PULLBACK", "BREAKOUT", "CONTINUATION"],
    allowedZones: {
      primary: ["NEGOTIATED"],
      secondary: ["INSTITUTIONAL", "SHELF"],
    },
    entryConstraints: baseConstraints(),
    reasonCodes,
    debug,
  };
}

export function computeTradePermission(input) {
  const score = clamp(input?.engine5?.total ?? 0, 0, 100);
  const invalid = !!input?.engine5?.invalid;

  const mm = input?.marketMeter || {};
  const eod = mm.eod || {};
  const h4 = mm.h4 || {};
  const h1 = mm.h1 || {};

  const eodRisk = eod.risk || "MIXED";
  const eodPsi = Number(eod.psi ?? NaN);
  const eodState = eod.state || "NEUTRAL";

  const h4State = h4.state || "NEUTRAL";
  const h1State = h1.state || "NEUTRAL";

  const zone = input?.zoneContext || {};
  const zoneType = zone.zoneType || "UNKNOWN";
  const withinZone = !!zone.withinZone;

  const flags = zone.flags || {};
  const zoneDegraded = !!flags.degraded;
  const liquidityFail = !!flags.liquidityFail;
  const reactionFailed = !!flags.reactionFailed;

  const intent = input?.intent?.action || "NEW_ENTRY";
  const isNewEntry = intent === "NEW_ENTRY";

  const psiDanger = Number.isFinite(eodPsi) && eodPsi >= 90;

  const multiTfContracting =
    (h1State === "CONTRACTING" && h4State === "CONTRACTING") ||
    (h4State === "CONTRACTING" && eodState === "CONTRACTING") ||
    (h1State === "CONTRACTING" && eodState === "CONTRACTING");

  const singleTfContracting =
    h1State === "CONTRACTING" ||
    h4State === "CONTRACTING" ||
    eodState === "CONTRACTING";

  const debug = {
    score,
    invalid,
    eodRisk,
    eodPsi,
    eodState,
    h1State,
    h4State,
    multiTfContracting,
    singleTfContracting,
    psiDanger,
    zoneType,
    withinZone,
    zoneDegraded,
    liquidityFail,
    reactionFailed,
    allowedZones: ALLOWED_ZONES_PRIMARY,
  };

  const reasons = [];

  // ---------------- HARD STAND DOWN ----------------

  if (invalid || score === 0) {
    reasons.push("STANDDOWN_INVALID_OR_ZERO");
    return standDown(reasons, debug);
  }

  if (isNewEntry && eodRisk === "RISK_OFF") {
    reasons.push("STANDDOWN_EOD_RISK_OFF");
    return standDown(reasons, debug);
  }

  if (isNewEntry && psiDanger) {
    reasons.push("STANDDOWN_PSI_DANGER");
    return standDown(reasons, debug);
  }

  if (isNewEntry && multiTfContracting) {
    reasons.push("STANDDOWN_MULTI_TF_CONTRACTING");
    return standDown(reasons, debug);
  }

  // ✅ Contract improvement:
  // Out of allowed zones => STAND_DOWN, but make reason explicit
  // Alias old reason to new standardized reason.
  if (!withinZone) {
    reasons.push("OUT_OF_ALLOWED_ZONES");
    // Optional backward compat (leave commented if you want only new code)
    // reasons.push("STANDDOWN_NOT_IN_ZONE");
    return standDown(reasons, debug, { primary: ALLOWED_ZONES_PRIMARY, secondary: [] });
  }

  if (zoneDegraded || liquidityFail || reactionFailed) {
    reasons.push("STANDDOWN_ZONE_FLAGGED_BAD");
    return standDown(reasons, debug);
  }

  // ---------------- REDUCE ----------------

  if (score < 70 || singleTfContracting) {
    reasons.push(score < 70 ? "REDUCE_SCORE_55_69" : "REDUCE_SINGLE_TF_CONTRACTING");
    return reduce(reasons, debug);
  }

  // ---------------- ALLOW ----------------

  reasons.push("ALLOW_SCORE_70_PLUS");
  reasons.push("ALLOW_MARKET_OK");
  reasons.push("ALLOW_ZONE_OK");

  return allow(reasons, debug);
}
