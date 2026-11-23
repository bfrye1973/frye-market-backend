// Engine 4 v2 — read-only consumer of engine29.downstreamContext.v1.
//
// Authority: CONTEXT ONLY. Nothing here creates direction, permission, or
// execution. Engine 29 owns these observations; Engine 4 only labels its own
// completed-5m participation evidence with them.
//
// Rules:
//   - Per-lane freshness. A degraded lane (e.g. ratesDuration) never takes
//     down unrelated lanes. The global dataDegraded flag is reported, not used.
//   - Anti-lookahead. A context recorded after the evaluation time is rejected,
//     using the same rule as Engine 12 Replay (selectEngine29ReplayContext).
//   - Intraday age limits are enforced here. Engine 29's own lane maxAgeMs
//     (18h) is a structural bound, too loose for a 5m participation read.
//   - Lanes Engine 29 marks eligibleForEngine4:false (trap, liquidity) are
//     surfaced as NOT_ELIGIBLE and never used.

export const ENGINE29_CONTRACT_SCHEMA = "engine29.downstreamContext.v1";

export const ENGINE4_E29_AGE_LIMITS_MS = Object.freeze({
  context: 10 * 60 * 1000,      // the whole receipt vs evaluation time
  thirtyMinute: 45 * 60 * 1000, // 30m bar + cadence
  parentMove: 45 * 60 * 1000,
  liveTenMinute: 25 * 60 * 1000, // 10m bar + cadence
  squeeze: 25 * 60 * 1000,
});

const FUTURE_TOLERANCE_MS = 60 * 1000;

const SQUEEZE_LIVE = new Set([
  "SQUEEZE_FORMING", "SQUEEZE_ACTIVE", "SQUEEZE_ACCELERATING", "SQUEEZE_HOLDING",
]);
const SQUEEZE_ENDING = new Set(["SQUEEZE_WEAKENING", "SQUEEZE_FAILED"]);

const ms = (v) => {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
};

function laneHealth(lane, receiptAgeMs, limitMs) {
  if (!lane) return { usable: false, health: "MISSING" };
  if (lane.dataDegraded === true) return { usable: false, health: "DEGRADED" };
  if (lane.freshness?.stale === true) return { usable: false, health: "STALE" };
  const laneAge = Number.isFinite(lane.freshness?.ageMs) ? lane.freshness.ageMs : null;
  // Lane age is measured at receipt time; add how old the receipt is now.
  const ageAtEval = laneAge == null ? null : laneAge + Math.max(0, receiptAgeMs ?? 0);
  if (ageAtEval == null) return { usable: false, health: "AGE_UNKNOWN" };
  if (ageAtEval > limitMs) return { usable: false, health: "TOO_OLD_FOR_INTRADAY", ageMs: ageAtEval };
  return { usable: true, health: "FRESH", ageMs: ageAtEval };
}

const trendOfThirty = (s) =>
  s === "BUYING_PRESSURE_INCREASING" ? "UP" :
  s === "SELLING_PRESSURE_INCREASING" ? "DOWN" :
  s ? "FLAT" : null;

const align = (trend, dir) =>
  dir !== "LONG" && dir !== "SHORT" ? "UNAVAILABLE"
  : trend == null ? "UNAVAILABLE"
  : trend === "FLAT" ? "NEUTRAL"
  : (trend === "UP") === (dir === "LONG") ? "WITH_TREND" : "AGAINST_TREND";

function momentumOf(liveState) {
  if (typeof liveState !== "string") return null;
  if (liveState.endsWith("_ACCELERATING")) return "ACCELERATING";
  if (liveState.endsWith("_WEAKENING")) return "WEAKENING";
  if (liveState.includes("SQUEEZE")) return "SQUEEZE";
  if (liveState.endsWith("_MOVE_ACTIVE")) return "ACTIVE";
  return null;
}

const unavailable = (reason, extra = {}) => ({
  available: false,
  reason,
  trend: "UNAVAILABLE",
  trendAlignment: "UNAVAILABLE",
  parentAlignment: "UNAVAILABLE",
  squeezeVsSetup: "UNAVAILABLE",
  authority: "CONTEXT_ONLY",
  ...extra,
});

/**
 * @param {object} p
 * @param {object|null} p.context  engine29.downstreamContext.v1
 * @param {number} p.evaluationTimeMs
 * @param {"LONG"|"SHORT"|"NEUTRAL"} p.direction  Engine 3 direction (read only)
 */
export function readEngine29ForEngine4({ context = null, evaluationTimeMs = null, direction = "NEUTRAL" } = {}) {
  if (!context) return unavailable("ENGINE29_CONTEXT_MISSING");
  if (context.schema !== ENGINE29_CONTRACT_SCHEMA) {
    return unavailable("ENGINE29_SCHEMA_MISMATCH", { schema: context.schema ?? null });
  }
  const recordedMs = ms(context.timestamp);
  const evalMs = ms(evaluationTimeMs);
  if (recordedMs == null || evalMs == null) return unavailable("ENGINE29_TIME_UNVERIFIABLE");
  if (recordedMs > evalMs + FUTURE_TOLERANCE_MS) {
    return unavailable("ENGINE29_CONTEXT_FROM_FUTURE_REJECTED", { receiptTimestamp: context.timestamp });
  }
  const receiptAgeMs = Math.max(0, evalMs - recordedMs);
  if (receiptAgeMs > ENGINE4_E29_AGE_LIMITS_MS.context) {
    return unavailable("ENGINE29_CONTEXT_TOO_OLD", { receiptTimestamp: context.timestamp, receiptAgeMs });
  }

  const L = context.lanes || {};
  const A = ENGINE4_E29_AGE_LIMITS_MS;
  const h30 = laneHealth(L.thirtyMinute, receiptAgeMs, A.thirtyMinute);
  const hParent = laneHealth(L.parentMove, receiptAgeMs, A.parentMove);
  const hLive = laneHealth(L.liveTenMinute, receiptAgeMs, A.liveTenMinute);
  // Squeeze age is reported as observationAgeMs, not freshness.ageMs.
  const sqLane = L.squeeze ? { ...L.squeeze, freshness: { ...(L.squeeze.freshness || {}), ageMs: L.squeeze.observationAgeMs ?? L.squeeze.freshness?.ageMs } } : null;
  const hSq = laneHealth(sqLane, receiptAgeMs, A.squeeze);

  const dir = direction === "LONG" || direction === "SHORT" ? direction : "NEUTRAL";

  // Trend = 30m fast tactical state (the input validated in the Nov 16–23 study).
  const trend = h30.usable ? trendOfThirty(L.thirtyMinute.state) : null;
  // Parent MOVE is reported separately; it is never recomputed here.
  const parentDir = hParent.usable && L.parentMove.state !== "NO_ACTIVE_MOVE"
    ? (L.parentMove.direction ?? "FLAT") : (hParent.usable ? "FLAT" : null);

  const live = hLive.usable ? {
    direction: L.liveTenMinute.direction ?? null,
    state: L.liveTenMinute.state ?? null,
    momentum: momentumOf(L.liveTenMinute.state),
    contextVsParent: L.liveTenMinute.contextVsParent ?? null,
    persistence20m: L.liveTenMinute.persistence20m === true,
  } : null;

  const camp = hSq.usable ? L.squeeze.campaign : null;
  const squeeze = camp ? {
    state: camp.state ?? null,
    direction: camp.direction ?? null,
    active: camp.active === true,
    counterToParent: camp.counterToParent === true,
    campaignId: camp.campaignId ?? null,
  } : null;

  let squeezeVsSetup = "UNAVAILABLE";
  if (squeeze && dir !== "NEUTRAL") {
    const setupUp = dir === "LONG";
    if (!SQUEEZE_LIVE.has(squeeze.state) && !SQUEEZE_ENDING.has(squeeze.state)) squeezeVsSetup = "NONE";
    else if ((squeeze.direction === "UP") === setupUp) squeezeVsSetup = SQUEEZE_ENDING.has(squeeze.state) ? "WITH_SETUP_ENDING" : "WITH_SETUP";
    else squeezeVsSetup = SQUEEZE_ENDING.has(squeeze.state) ? "AGAINST_SETUP_ENDING" : "AGAINST_SETUP";
  } else if (squeeze) {
    squeezeVsSetup = "NO_DIRECTION";
  }

  const notEligible = (lane) => lane ? {
    eligibleForEngine4: lane.eligibleForEngine4 === true,
    reason: lane.reason ?? null,
    used: false,
  } : null;

  return {
    available: h30.usable || hParent.usable || hLive.usable || hSq.usable,
    authority: "CONTEXT_ONLY",
    trend: trend ?? "UNAVAILABLE",
    trendSource: "engine29.lanes.thirtyMinute.state",
    trendAlignment: align(trend, dir),
    parentDirection: parentDir ?? "UNAVAILABLE",
    parentAlignment: align(parentDir, dir),
    live,
    squeeze,
    squeezeVsSetup,
    laneHealth: { thirtyMinute: h30, parentMove: hParent, liveTenMinute: hLive, squeeze: hSq },
    notUsed: { trap: notEligible(L.trap), liquidity: notEligible(L.liquidity) },
    globalDataDegraded: context.dataDegraded === true,
    globalDegradedGroups: context.degradedGroups || [],
    receipt: {
      schema: context.schema,
      timestamp: context.timestamp,
      observationId: context.observationId ?? null,
      receiptAgeMs,
      engine26ZoneId: context.engine26ZoneId ?? null,
    },
  };
}

/**
 * Classify a climactic 5m bar using Engine 29 squeeze + live 10m momentum.
 * SQUEEZE_FUEL: a live squeeze in the bar's direction with momentum not
 *   weakening — the climax is more likely continuation than exhaustion.
 * EXHAUSTION_RISK: squeeze ending/absent in that direction, or live 10m
 *   momentum in that direction is weakening.
 * NO_SQUEEZE_SUPPORT: Engine 29 readable, no squeeze in the bar's direction
 *   and no weakening signal — the base climax meaning stands.
 * UNCLASSIFIED: Engine 29 lanes unavailable.
 */
export function classifyClimaxWithEngine29(barDirection, e29) {
  if (!e29 || (!e29.squeeze && !e29.live)) return "UNCLASSIFIED";
  const side = barDirection === "UP" ? "UP" : barDirection === "DOWN" ? "DOWN" : null;
  if (!side) return "UNCLASSIFIED";
  const sq = e29.squeeze;
  const liveSameSide = e29.live && e29.live.direction === side;
  const liveWeakening = liveSameSide && e29.live.momentum === "WEAKENING";
  if (sq && sq.direction === side && SQUEEZE_LIVE.has(sq.state) && !liveWeakening) return "SQUEEZE_FUEL";
  if ((sq && sq.direction === side && SQUEEZE_ENDING.has(sq.state)) || liveWeakening) return "EXHAUSTION_RISK";
  return "NO_SQUEEZE_SUPPORT";
}
