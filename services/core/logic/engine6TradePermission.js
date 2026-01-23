// services/core/logic/engine6TradePermission.js
// Engine 6 — Trade Permission Matrix (AUTHORITATIVE)
// Purpose: Decide IF trades are allowed, WHERE trades are allowed, WHAT TYPES are allowed.
// Outputs: ALLOW / REDUCE / STAND_DOWN + allowed trade types + sizeMultiplier
//
// LOCKED RULES FROM TEAMMATES:
// - Engine 5 invalid=true (Fib 74%) => total=0 (hard stand down)
// - Engine 5 score is 0..100 locked (Engine 6 may use fixed thresholds 55/70)
// - Engine 5 is setup-only (no market meter penalties baked in)
// - EOD Risk-Off is HARD BLOCK for NEW entries (exits allowed)
// - Single TF contracting => REDUCE
// - Multi-TF contracting (>=2 higher TFs) OR PSI>=90 => STAND_DOWN for new entries
// - Negotiated zones are highest grade execution zones; tradable with restrictions
// - Engine 6 MUST NOT infer “late”; upstream flags provide degraded/liquidityFail/reactionFailed

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n)));

function normalizeState(x) {
  const s = String(x || "").toUpperCase();
  if (s === "EXPANDING" || s === "CONTRACTING" || s === "STALLED" || s === "NEUTRAL") return s;
  return "NEUTRAL";
}
function normalizeRisk(x) {
  const s = String(x || "").toUpperCase();
  if (s === "RISK_ON" || s === "RISK_OFF" || s === "MIXED") return s;
  return "MIXED";
}
function normalizeBias(x) {
  const s = String(x || "").toUpperCase();
  if (s === "BULL" || s === "BEAR" || s === "NEUTRAL") return s;
  return "NEUTRAL";
}

function baseConstraints() {
  return {
    mustEnterWithinZone: true,
    noChaseOutsideZone: true,
    requireHigherTFBiasAlignment: true,
  };
}

function standDown(reasonCodes, debug) {
  return {
    permission: "STAND_DOWN",
    sizeMultiplier: 0.0,
    allowedTradeTypes: [],
    allowedZones: { primary: [], secondary: [] },
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

/**
 * computeTradePermission(input)
 * input shape (recommended):
 * {
 *   symbol, tf, asOf,
 *   engine5: { invalid, total, reasonCodes },
 *   marketMeter: {
 *     eod: { risk, psi, state, bias },
 *     h4:  { state, bias },
 *     h1:  { state, bias },
 *     m10: { state, bias }
 *   },
 *   zoneContext: {
 *     zoneType, zoneId, withinZone,
 *     flags: { degraded, liquidityFail, reactionFailed },
 *     meta:  { touchCount, minutesSinceLastReaction }
 *   },
 *   intent: { action: "NEW_ENTRY" | "EXIT" | "REDUCE_RISK" }
 * }
 */
export function computeTradePermission(input = {}) {
  const symbol = String(input.symbol || "SPY").toUpperCase();
  const tf = String(input.tf || "1h");
  const asOf = input.asOf || new Date().toISOString();

  const score = clamp(input.engine5?.total ?? 0, 0, 100);
  const invalid = !!input.engine5?.invalid;

  const eodRisk = normalizeRisk(input.marketMeter?.eod?.risk);
  const eodPsi = Number(input.marketMeter?.eod?.psi ?? NaN);
  const eodState = normalizeState(input.marketMeter?.eod?.state);
  const eodBias = normalizeBias(input.marketMeter?.eod?.bias);

  const h4State = normalizeState(input.marketMeter?.h4?.state);
  const h4Bias = normalizeBias(input.marketMeter?.h4?.bias);

  const h1State = normalizeState(input.marketMeter?.h1?.state);
  const h1Bias = normalizeBias(input.marketMeter?.h1?.bias);

  const m10State = normalizeState(input.marketMeter?.m10?.state);
  const m10Bias = normalizeBias(input.marketMeter?.m10?.bias);

  const zoneType = String(input.zoneContext?.zoneType || "UNKNOWN").toUpperCase();
  const zoneId = String(input.zoneContext?.zoneId || "");
  const withinZone = !!input.zoneContext?.withinZone;

  const zoneDegraded = !!input.zoneContext?.flags?.degraded;
  const liquidityFail = !!input.zoneContext?.flags?.liquidityFail;
  const reactionFailed = !!input.zoneContext?.flags?.reactionFailed;

  const intent = String(input.intent?.action || "NEW_ENTRY").toUpperCase();
  const isNewEntry = intent === "NEW_ENTRY";

  const psiDanger = Number.isFinite(eodPsi) ? eodPsi >= 90 : false;

  // Multi-TF contracting rule:
  // “hard no-trade only when multi-TF contracting aligns (≥2 higher TFs)”
  // Higher TFs = 1h, 4h, EOD
  const contractingCount =
    (h1State === "CONTRACTING" ? 1 : 0) +
    (h4State === "CONTRACTING" ? 1 : 0) +
    (eodState === "CONTRACTING" ? 1 : 0);
  const multiTfContracting = contractingCount >= 2;

  const singleTfContracting = contractingCount === 1;

  const reasonCodes = [];

  const debug = {
    symbol,
    tf,
    asOf,
    score,
    invalid,
    eodRisk,
    eodPsi: Number.isFinite(eodPsi) ? eodPsi : null,
    eodState,
    eodBias,
    h4State,
    h4Bias,
    h1State,
    h1Bias,
    m10State,
    m10Bias,
    psiDanger,
    contractingCount,
    multiTfContracting,
    singleTfContracting,
    zoneType,
    zoneId,
    withinZone,
    zoneDegraded,
    liquidityFail,
    reactionFailed,
    intent,
  };

  // ===========================
  // HARD BLOCKS (NEW ENTRIES)
  // ===========================

  // 1) Fib invalidation / score hard-zero
  if (invalid || score === 0) {
    reasonCodes.push("STANDDOWN_INVALID_OR_ZERO");
    return standDown(reasonCodes, debug);
  }

  // 2) EOD risk-off blocks NEW entries (exits allowed)
  if (isNewEntry && eodRisk === "RISK_OFF") {
    reasonCodes.push("STANDDOWN_EOD_RISK_OFF_NEW_ENTRY");
    return standDown(reasonCodes, debug);
  }

  // 3) PSI danger extreme blocks NEW entries
  if (isNewEntry && psiDanger) {
    reasonCodes.push("STANDDOWN_PSI_DANGER_90_PLUS");
    return standDown(reasonCodes, debug);
  }

  // 4) Multi-TF contracting blocks NEW entries
  if (isNewEntry && multiTfContracting) {
    reasonCodes.push("STANDDOWN_MULTI_TF_CONTRACTING");
    return standDown(reasonCodes, debug);
  }

  // 5) Zone hard failures
  if (!withinZone) {
    reasonCodes.push("STANDDOWN_NOT_WITHIN_ZONE");
    return standDown(reasonCodes, debug);
  }

  if (zoneDegraded || liquidityFail || reactionFailed) {
    reasonCodes.push("STANDDOWN_ZONE_FLAGGED_BAD");
    return standDown(reasonCodes, debug);
  }

  // ===========================
  // REDUCE (SELECTIVE)
  // ===========================
  // Score thresholds are LOCKED:
  // - REDUCE if 55–69 OR single-TF contracting
  // - ALLOW if >= 70 and market is not hard blocked above
  if (score < 70 || singleTfContracting) {
    if (score < 70) reasonCodes.push("REDUCE_SCORE_55_69");
    if (singleTfContracting) reasonCodes.push("REDUCE_SINGLE_TF_CONTRACTING");

    // Default allowed trade types under reduce:
    // - pullback only (most conservative + consistent with your policy)
    return reduce(reasonCodes, debug, ["PULLBACK"]);
  }

  // ===========================
  // ALLOW
  // ===========================
  reasonCodes.push("ALLOW_SCORE_70_PLUS");
  reasonCodes.push("ALLOW_MARKET_OK");
  reasonCodes.push("ALLOW_ZONE_OK");

  return allow(reasonCodes, debug);
}
