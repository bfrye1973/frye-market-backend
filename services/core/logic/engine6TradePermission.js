// services/core/logic/engine6TradePermission.js
// ENGINE 6 — Trade Permission Matrix (AUTHORITATIVE)
//
// Happy-medium v1
// - add market-regime awareness
// - do NOT over-tighten good signals
// - use regime mainly for strictness / reduce behavior
//
// IMPORTANT
// - Engine 6 = permission / aggressiveness
// - Engine 7 = actual position sizing

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
}

function baseConstraints() {
  return {
    mustEnterWithinZone: true,
    noChaseOutsideZone: true,
    requireHigherTFBiasAlignment: true,
  };
}

const ALLOWED_ZONES_PRIMARY = ["NEGOTIATED", "INSTITUTIONAL"];

function normalizeMarketRegime(regime = null) {
  return {
    regime: safeUpper(regime?.regime, "UNKNOWN"),
    directionBias: safeUpper(regime?.directionBias, "NONE"),
    strictness: safeUpper(regime?.strictness, "MEDIUM"),
    reasonCodes: Array.isArray(regime?.reasonCodes) ? regime.reasonCodes : [],
  };
}

function standDown(reasonCodes, debug, allowedZonesOverride = null) {
  return {
    permission: "STAND_DOWN",
    sizeMultiplier: 0.0,
    allowedTradeTypes: [],
    allowedZones:
      allowedZonesOverride || {
        primary: ALLOWED_ZONES_PRIMARY,
        secondary: [],
      },
    entryConstraints: baseConstraints(),
    reasonCodes,
    debug,
  };
}

function reduce(reasonCodes, debug, allowedTradeTypes = ["PULLBACK"]) {
  return {
    permission: "REDUCE",
    sizeMultiplier: 0.5,
    allowedTradeTypes,
    allowedZones: {
      primary: ["NEGOTIATED"],
      secondary: ["INSTITUTIONAL", "SHELF", "NEAR_ALLOWED_ZONE"],
    },
    entryConstraints: baseConstraints(),
    reasonCodes,
    debug,
  };
}

function allow(reasonCodes, debug, allowedTradeTypes = ["PULLBACK", "BREAKOUT", "CONTINUATION"]) {
  return {
    permission: "ALLOW",
    sizeMultiplier: 1.0,
    allowedTradeTypes,
    allowedZones: {
      primary: ["NEGOTIATED"],
      secondary: ["INSTITUTIONAL", "SHELF", "NEAR_ALLOWED_ZONE"],
    },
    entryConstraints: baseConstraints(),
    reasonCodes,
    debug,
  };
}

export function computeTradePermission(input) {
  const rawScore = input?.engine5?.total;
  const score =
    Number.isFinite(Number(rawScore)) ? clamp(rawScore, 0, 100) : null;

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
  const nearAllowedZone =
    zone?.locationState === "NEAR_ALLOWED_ZONE" ||
    zone?.nearAllowedZone === true;

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

  const strategyType = input?.strategyType || "UNKNOWN";
  const marketRegime = normalizeMarketRegime(input?.marketRegime);

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
    nearAllowedZone,
    zoneDegraded,
    liquidityFail,
    reactionFailed,
    strategyType,
    marketRegime,
    allowedZones: ALLOWED_ZONES_PRIMARY,
  };

  const reasons = [];

  // ---------------- HARD STAND DOWN ----------------

  if (invalid) {
    reasons.push("INVALID_IGNORED_FOR_TESTING");
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

  if (!withinZone && !nearAllowedZone) {
    if (strategyType === "CONTINUATION") {
      reasons.push("REDUCE_CONTINUATION_OUTSIDE_ZONE");
      return {
        permission: "REDUCE",
        sizeMultiplier: 0.5,
        allowedTradeTypes: ["CONTINUATION"],
        allowedZones: {
          primary: ["ANY"],
          secondary: [],
        },
        entryConstraints: baseConstraints(),
        reasonCodes: reasons,
        debug,
      };
    }

    reasons.push("OUT_OF_ALLOWED_ZONES");
    return standDown(reasons, debug, {
      primary: ALLOWED_ZONES_PRIMARY,
      secondary: [],
    });
  }

  if (zoneDegraded || liquidityFail || reactionFailed) {
    reasons.push("STANDDOWN_ZONE_FLAGGED_BAD");
    return standDown(reasons, debug);
  }

  // ---------------- REGIME AWARE REDUCE ----------------
  // happy-medium:
  // - HIGH strictness => reduced permission, not full block
  // - MEDIUM strictness => normal existing logic can still allow/reduce
  // - LOW strictness => normal flow

  if (isNewEntry && marketRegime.strictness === "HIGH") {
    reasons.push("REDUCE_HIGH_STRICTNESS_REGIME");

    if (strategyType === "CONTINUATION" || strategyType === "BREAKDOWN") {
      return reduce(reasons, debug, ["CONTINUATION", "BREAKDOWN"]);
    }

    return reduce(reasons, debug, ["PULLBACK", "BREAKOUT", "CONTINUATION", "EXHAUSTION"]);
  }

  // ---------------- REDUCE ----------------

  if ((score != null && score < 70) || singleTfContracting) {
    reasons.push(
      score != null && score < 70
        ? "REDUCE_SCORE_55_69"
        : "REDUCE_SINGLE_TF_CONTRACTING"
    );

    if (strategyType === "CONTINUATION" || strategyType === "BREAKDOWN") {
      return reduce(reasons, debug, ["CONTINUATION", "BREAKDOWN"]);
    }

    return reduce(reasons, debug);
  }

  // ---------------- ALLOW ----------------

  if (nearAllowedZone && !withinZone) {
    reasons.push("ALLOW_NEAR_ALLOWED_ZONE_TESTING");
  }

  if (score == null) {
    reasons.push("ALLOW_SCORE_UNKNOWN_TESTING");
  } else {
    reasons.push("ALLOW_SCORE_70_PLUS");
  }

  if (marketRegime.strictness === "MEDIUM") {
    reasons.push("ALLOW_WITH_CAUTION_TRANSITION_REGIME");
  } else if (marketRegime.strictness === "LOW") {
    reasons.push("ALLOW_ALIGNED_REGIME");
  }

  if (strategyType === "CONTINUATION" || strategyType === "BREAKDOWN") {
    reasons.push("ALLOW_STRUCTURE_TESTING");
    reasons.push("ALLOW_MARKET_OK");
    reasons.push("ALLOW_ZONE_OK");
    return allow(reasons, debug, ["CONTINUATION", "BREAKDOWN"]);
  }

  reasons.push("ALLOW_MARKET_OK");
  reasons.push("ALLOW_ZONE_OK");

  return allow(reasons, debug);
}
