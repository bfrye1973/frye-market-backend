// Engine 6 Strategy 1 — read-only zone-rotation context.
// Engine 22 owns waves, Engine 25 owns internals, Engine 3 owns direction,
// Engine 4 owns participation, and Engine 26A owns candidate identity.
// This module NEVER authorizes a trade or invents a wave/target/zone.
// It is deliberately independent of post-permission Engine 27 outputs.

const DIR = new Set(["LONG", "SHORT"]);
const upper = (x) => typeof x === "string" ? x.trim().toUpperCase() : null;
const obj = (x) => x && typeof x === "object" && !Array.isArray(x) ? x : null;
const path = (x, ...keys) => keys.reduce((v,k) => obj(v)?.[k], x);
const unique = (xs) => [...new Set(xs.filter(Boolean))];
const isAvailable = (x) => obj(x) && x.available === true;

export function buildEngine6ZoneRotationContext({
  symbol = "ES",
  strategyId = "intraday_scalp@10m",
  candidate = null,
  reaction = null,
  participation = null,
  engine22WaveStrategy = null,
  engine25Participation = null,
  engine25Context = null,
} = {}) {
  const warnings = [];
  const evidence = [];
  const blockers = [];
  const direction = upper(reaction?.direction);
  const e4Direction = upper(participation?.direction ?? participation?.intendedDirection);
  const e26 = obj(candidate);
  const e3 = obj(reaction);
  const e4 = obj(participation);
  const degrees = path(engine22WaveStrategy, "currentWavelength", "degrees");
  const submicro = path(degrees, "submicro");
  const micro = path(degrees, "micro");
  const w2 = path(submicro, "ownerSubmicroW2");
  const w3 = path(micro, "ownerMicroW3");
  const microSequence = path(micro, "microSequence");
  const distribution = path(engine25Participation, "participation", "distributionPressure");
  const freshness = path(engine25Participation, "freshness");

  // No synthetic directional fallback from wave projections or market breadth.
  if (upper(symbol) !== "ES" || strategyId !== "intraday_scalp@10m") blockers.push("NOT_STRATEGY1_ES");
  if (!e26?.candidateId || !e26?.zoneId) blockers.push("ENGINE26A_CANDIDATE_IDENTITY_MISSING");
  if (!e3?.candidateId || !e3?.zoneId || e3.candidateId !== e26?.candidateId || e3.zoneId !== e26?.zoneId)
    blockers.push("ENGINE3_CANDIDATE_IDENTITY_MISMATCH");
  if (!e4?.candidateId || !e4?.zoneId || e4.candidateId !== e26?.candidateId || e4.zoneId !== e26?.zoneId)
    blockers.push("ENGINE4_CANDIDATE_IDENTITY_MISMATCH");
  if (!DIR.has(direction) || e3?.engine3Strategy1QualifiedForEngine6 !== true || e3?.allowed !== true)
    blockers.push("ENGINE3_REACTION_NOT_QUALIFIED");
  if (e4?.participationConfirmed !== true || e4?.allowed !== true || e4?.hardBlocked === true)
    blockers.push("ENGINE4_PARTICIPATION_NOT_CONFIRMED");
  if (DIR.has(e4Direction) && e4Direction !== direction) blockers.push("ENGINE3_ENGINE4_DIRECTION_CONFLICT");
  if (e26?.candidateInvalidated === true || e26?.locationInvalidated === true)
    blockers.push("ENGINE26A_LOCATION_INVALIDATED");

  const submicroDirection = upper(submicro?.direction ?? w2?.direction);
  const microDirection = upper(w3?.direction ?? micro?.direction);
  const convert = (d) => d === "UP" ? "LONG" : d === "DOWN" ? "SHORT" : d;
  const submicroAligned = DIR.has(direction) && convert(submicroDirection) === direction;
  const microAligned = DIR.has(direction) && convert(microDirection) === direction;
  const submicroConflict = DIR.has(direction) && DIR.has(convert(submicroDirection)) && !submicroAligned;
  const microConflict = DIR.has(direction) && DIR.has(convert(microDirection)) && !microAligned;
  const submicroConfirmed = upper(w2?.confirmationStatus) === "CONFIRMED" ||
    upper(w2?.confirmationStatus) === "LOCKED";
  // W2 completion is not proof that Micro W3 itself is confirmed.
  const microConfirmed = ["CONFIRMED", "LOCKED"].includes(upper(microSequence?.confirmationStatus));
  const microW2Completed = upper(microSequence?.w2Completion?.state) === "LOCKED";
  if (!submicro) warnings.push("ENGINE22_SUBMICRO_UNAVAILABLE");
  if (!micro) warnings.push("ENGINE22_MICRO_UNAVAILABLE");
  if (submicroConflict) warnings.push("SUBMICRO_WORKING_WAVE_OPPOSES_REACTION");
  if (microConflict) warnings.push("COUNTERTREND_TO_MICRO");
  if (!submicroConfirmed) warnings.push("SUBMICRO_OWNER_WAVE_UNCONFIRMED");
  if (!microConfirmed) warnings.push("MICRO_STRUCTURAL_CONFIRMATION_NOT_PROVEN");
  if (path(engine22WaveStrategy, "engine22V3Projection", "v3LiveShadow"))
    evidence.push("ENGINE22_V3_RESEARCH_EXCLUDED_FROM_PERMISSION");

  const integrated = upper(distribution?.state);
  const trend1h = upper(path(distribution, "oneHourTrend", "state"));
  const transition30m = upper(path(distribution, "thirtyMinuteConfirmation", "state"));
  const acceleration10m = upper(path(distribution, "tenMinuteAcceleration", "state"));
  const obs = path(distribution, "observations");
  const validity = ["10m","30m","1h","4h"].map(tf => ({
    timeframe: tf,
    available: isAvailable(path(obs,tf)),
    reason: path(obs,tf,"reason") ?? null,
  }));
  const intradayFresh = upper(path(freshness, "intraday", "state")) === "FRESH";
  if (!engine25Participation) warnings.push("ENGINE25_PARTICIPATION_UNAVAILABLE");
  if (!intradayFresh) warnings.push("ENGINE25_INTRADAY_FRESHNESS_UNCONFIRMED");
  if (validity.some(v=>!v.available)) warnings.push("ENGINE25_TIMEFRAME_EVIDENCE_INCOMPLETE");

  const sellingConfirmed = transition30m === "SELLING_PRESSURE_CONFIRMED" ||
    acceleration10m === "FAST_SELLING_ACCELERATION_CONFIRMED";
  const buyingConfirmed = transition30m === "BUYING_RECOVERY_CONFIRMED" ||
    acceleration10m === "FAST_BUYING_RECOVERY_CONFIRMED";
  const easing = trend1h === "EASING";
  const rising = trend1h === "RISING";
  // Market support is trustworthy only when the specific confirming timeframes
  // and intraday freshness are available. No stale or partial evidence may pass.
  const available = Object.fromEntries(validity.map(v => [v.timeframe,v.available]));
  const pressureDataUsable = intradayFresh &&
    available["10m"] && available["30m"] && available["1h"];
  const pressure = !pressureDataUsable ? "UNAVAILABLE" :
    direction === "SHORT"
    ? (buyingConfirmed || easing ? "CAUTION" : sellingConfirmed && rising ? "SUPPORTIVE" : "MIXED")
    : direction === "LONG"
    ? (sellingConfirmed && rising ? "CAUTION" : buyingConfirmed && easing ? "SUPPORTIVE" : "MIXED")
    : "UNRESOLVED";
  // These are named qualitative combinations of published states, NOT scores or hard gates.
  if (pressure === "SUPPORTIVE") evidence.push("ENGINE25_TACTICAL_PRESSURE_SUPPORTS_DIRECTION");
  if (pressure === "CAUTION") warnings.push("ENGINE25_TACTICAL_PRESSURE_OPPOSES_OR_WEAKENS");
  if (upper(path(engine25Context, "flags", "hardBlock")) === "TRUE" ||
      path(engine25Context,"flags","hardBlock") === true)
    warnings.push("ENGINE25_LEGACY_HARD_BLOCK_CONTEXT_REVIEW");

  const eligibleForPermissionReview = blockers.length === 0;
  return {
    contract: "engine6.zoneRotationContext.v1",
    mode: "READ_ONLY_ADVISORY",
    allowed: false,
    canCreatePermission: false,
    symbol, strategyId,
    candidateId: e26?.candidateId ?? null, zoneId: e26?.zoneId ?? null,
    reactionDirection: direction,
    eligibleForPermissionReview,
    wave: {
      submicro: { activeWave: submicro?.activeWave ?? null, direction: submicroDirection,
        state: submicro?.state ?? null, confirmationStatus: w2?.confirmationStatus ?? null,
        alignedWithReaction: submicroAligned, confirmed: submicroConfirmed,
        levels: w2?.levels ?? null },
      micro: { activeWave: w3?.activeWave ?? micro?.activeWave ?? null,
        direction: microDirection, confirmationStatus: microSequence?.confirmationStatus ?? null,
        parentConflict: microConflict, structurallyConfirmed: microConfirmed,
        w2CompletionLocked: microW2Completed,
        levels: w3?.levels ?? null },
    },
    internals: {
      state: integrated, oneHourTrend: trend1h, thirtyMinuteConfirmation: transition30m,
      tenMinuteAcceleration: acceleration10m, intradayFresh,
      timeframeValidity: validity, directionalAssessment: pressure,
      esRelativeContext: path(engine25Context, "marketInternals", "alignment", "overall") ?? null,
    },
    blockers: unique(blockers),
    warnings: unique(warnings),
    reasonCodes: unique(evidence),
    sourcePolicy: "NO_ENGINE15_NO_ENGINE27_POST_PERMISSION_NO_NEW_WAVE_OR_ZONE",
  };
}

export default buildEngine6ZoneRotationContext;
