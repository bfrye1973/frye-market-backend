// services/core/logic/engine3/buildStrategy1Readiness.js
//
// Strategy 1 Engine 3 readiness — diagnostic only.
//
// Ownership:
// - Engine 26 owns the negotiated location / candidate.
// - 1m is watch/display only.
// - 5m is mature negotiated-zone reaction evidence.
// - 10m is broader negotiated-zone confirmation.
// - paperScalpReaction owns the ONE canonical Engine 3 answer.
// - Engine 4 owns participation.
// - Engine 6 owns final PAPER permission.

const IDENTITY_FIELDS = [
  "symbol",
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "candidateIdentityVersion",
];

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function snapshot(value) {
  return value && typeof value === "object" ? value : null;
}

function identityReasons(inputs) {
  const reasons = [];

  for (const field of IDENTITY_FIELDS) {
    const values = inputs
      .map((input) => input?.[field])
      .filter((value) => value != null && value !== "");

    if (values.length < 2) continue;

    if (values.some((value) => String(value) !== String(values[0]))) {
      reasons.push(
        `ENGINE3_READINESS_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_MISMATCH`
      );
    }
  }

  return reasons;
}

function meaningFor(state) {
  const meanings = {
    WAITING_FOR_ENGINE26_LOCATION:
      "Engine 26 has not published the complete negotiated location yet.",
    IDENTITY_MISMATCH:
      "Engine 3 evidence does not match the current Engine 26 candidate identity.",
    ENGINE26_NOT_AUTHORIZED:
      "Engine 26 has published the negotiated location but has not authorized Engine 3 evaluation.",
    WAITING_FOR_5M_REACTION:
      "Engine 3 is watching the authorized negotiated zone and waiting for mature completed 5-minute price reaction evidence.",
    WAITING_FOR_10M_CONFIRMATION:
      "A mature 5-minute reaction exists and Engine 3 is waiting for broader completed 10-minute confirmation.",
    FIVE_TEN_CONFLICT:
      "The mature 5-minute reaction and broader 10-minute confirmation currently disagree.",
    CANONICAL_ENGINE3_QUALIFIED:
      "Engine 3 has confirmed the negotiated-zone price reaction and may hand the direction to Engine 4 for participation evaluation.",
    DIRECTION_LOCKED:
      "Engine 3 has already confirmed the current lifecycle direction; 1-minute and 5-minute observations are diagnostic only while the direction remains locked.",
    WAITING_FOR_CANONICAL_REACTION:
      "Engine 3 is waiting for a complete negotiated-zone reaction story.",
  };

  return meanings[state] || meanings.WAITING_FOR_CANONICAL_REACTION;
}

export function buildStrategy1Readiness({
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
  observation1m = null,
  validation5m = null,
  paperScalpReaction = null,
} = {}) {
  const candidate = snapshot(engine26LocationCandidate);
  const handoff = snapshot(engine26ReactionHandoff);
  const canonical = snapshot(paperScalpReaction);

  // Prefer Engine 3's negotiated-zone interpretations published by the
  // canonical object. Raw 1m/5m helpers remain diagnostic inputs only.
  const oneMinute = snapshot(canonical?.reactionObservation1m) || snapshot(observation1m);
  const fiveMinute = snapshot(canonical?.reactionValidation5m) || snapshot(validation5m);
  const tenMinute = snapshot(canonical?.tenMinuteConfirmation) || snapshot(canonical?.broaderReaction10m);

  const zone = snapshot(handoff?.zone);
  const zoneLow = finiteNumber(zone?.lo);
  const zoneHigh = finiteNumber(zone?.hi);
  const zoneMid = finiteNumber(zone?.mid);
  const currentPrice =
    finiteNumber(canonical?.currentPrice) ??
    finiteNumber(candidate?.currentPrice);

  const completeLocation =
    candidate != null &&
    handoff != null &&
    zoneLow != null &&
    zoneHigh != null &&
    zoneMid != null &&
    currentPrice != null;

  const identityInputs = [candidate, handoff, fiveMinute].filter(Boolean);
  const identityReasonCodes =
    completeLocation && identityInputs.length >= 2
      ? identityReasons(identityInputs)
      : [];

  const identityAligned = completeLocation && identityReasonCodes.length === 0;
  const engine26Authorized = handoff?.authorizeEngine3Evaluation === true;

  const oneMinuteDirection = oneMinute?.direction ?? "NEUTRAL";
  const oneMinuteState = oneMinute?.state ?? "NO_SIGNAL";

  const fiveMinuteDirection = fiveMinute?.direction ?? "NEUTRAL";
  const fiveMinuteState =
    fiveMinute?.reactionState ?? fiveMinute?.state ?? "NO_SIGNAL";
  const fiveMinuteMaturity = fiveMinute?.maturity ?? "WAIT";
  const fiveMinuteMature =
    fiveMinuteMaturity === "MATURE_REACTION" &&
    ["LONG", "SHORT"].includes(fiveMinuteDirection);

  const tenMinuteDirection = tenMinute?.direction ?? "NEUTRAL";
  const tenMinuteState = tenMinute?.state ?? "NO_SIGNAL";
  const tenMinuteConfirmed = tenMinute?.confirmed === true;

  const fiveTenAligned =
    fiveMinuteMature &&
    tenMinuteConfirmed &&
    fiveMinuteDirection === tenMinuteDirection;

  const canonicalQualified =
    canonical?.engine3Strategy1QualifiedForEngine6 === true &&
    canonical?.allowed === true &&
    canonical?.reactionConfirmed === true &&
    ["LONG", "SHORT"].includes(canonical?.direction);

  const directionLocked =
    canonical?.reactionConfirmed === true &&
    ["LONG", "SHORT"].includes(canonical?.direction) &&
    (canonical?.directionPersistenceActive === true ||
      canonical?.canonicalResolutionStatus?.includes("LIFECYCLE_DIRECTION_LOCKED"));

  let readinessState;

  if (!completeLocation) {
    readinessState = "WAITING_FOR_ENGINE26_LOCATION";
  } else if (!identityAligned) {
    readinessState = "IDENTITY_MISMATCH";
  } else if (!engine26Authorized) {
    readinessState = "ENGINE26_NOT_AUTHORIZED";
  } else if (directionLocked) {
    readinessState = "DIRECTION_LOCKED";
  } else if (canonicalQualified) {
    readinessState = "CANONICAL_ENGINE3_QUALIFIED";
  } else if (!fiveMinuteMature) {
    readinessState = "WAITING_FOR_5M_REACTION";
  } else if (!tenMinuteConfirmed) {
    readinessState = "WAITING_FOR_10M_CONFIRMATION";
  } else if (!fiveTenAligned) {
    readinessState = "FIVE_TEN_CONFLICT";
  } else {
    readinessState = "WAITING_FOR_CANONICAL_REACTION";
  }

  const blockers = [];
  if (!completeLocation) blockers.push("ENGINE26_NEGOTIATED_LOCATION_MISSING");
  if (completeLocation && !identityAligned) blockers.push("IDENTITY_NOT_ALIGNED");
  if (completeLocation && !engine26Authorized) blockers.push("ENGINE26_EVALUATION_NOT_AUTHORIZED");
  if (engine26Authorized && !fiveMinuteMature && !canonicalQualified && !directionLocked) {
    blockers.push("FIVE_MINUTE_MATURE_REACTION_NOT_PRESENT");
  }
  if (fiveMinuteMature && !tenMinuteConfirmed && !canonicalQualified && !directionLocked) {
    blockers.push("TEN_MINUTE_CONFIRMATION_NOT_PRESENT");
  }
  if (fiveMinuteMature && tenMinuteConfirmed && !fiveTenAligned && !canonicalQualified && !directionLocked) {
    blockers.push("FIVE_AND_TEN_MINUTE_DIRECTION_CONFLICT");
  }

  return {
    active: true,
    diagnosticOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    readinessState,
    plainEnglishMeaning: meaningFor(readinessState),

    locationReady: completeLocation,
    engine26Authorized,
    identityAligned,

    negotiatedReferenceLevel: zoneMid,
    negotiatedReferenceType: "ENGINE26_NEGOTIATED_ZONE_MIDPOINT",
    negotiatedZoneLo: zoneLow,
    negotiatedZoneHi: zoneHigh,
    currentPrice,

    // 1m is visible, but never gates Strategy 1 readiness.
    oneMinuteWatchOnly: true,
    reactionObserved1m: false,
    reactionDirection1m: oneMinuteDirection,
    reactionState1m: oneMinuteState,
    reactionQuality1m: oneMinute?.quality ?? null,

    // 5m is the mature reaction evidence layer.
    validationAvailable5m: fiveMinute != null,
    validationState5m: fiveMinuteState,
    reactionDirection5m: fiveMinuteDirection,
    reactionMaturity5m: fiveMinuteMaturity,
    fiveMinuteMature,

    // Legacy 1m-vs-5m comparison aliases are intentionally false.
    validationSupports1m: false,
    validationConflictsWith1m: false,

    // 10m confirms the same negotiated-zone reaction.
    tenMinuteDirection,
    tenMinuteState,
    tenMinuteConfirmed,
    fiveTenAligned,

    canonicalDirection: canonical?.direction ?? "NEUTRAL",
    canonicalReactionState: canonical?.reactionState ?? canonical?.state ?? null,
    canonicalReactionConfirmed: canonical?.reactionConfirmed === true,
    canonicalEngine3Allowed: canonical?.allowed === true,
    canonicalEngine3QualifiedForEngine6:
      canonical?.engine3Strategy1QualifiedForEngine6 === true,
    authorizedForEngine4: canonical?.authorizedForEngine4 === true,
    directionLocked,

    symbol: handoff?.symbol ?? candidate?.symbol ?? null,
    laneId: handoff?.laneId ?? candidate?.laneId ?? null,
    strategyId: handoff?.strategyId ?? candidate?.strategyId ?? null,
    candidateId: handoff?.candidateId ?? candidate?.candidateId ?? null,
    zoneId: handoff?.zoneId ?? candidate?.zoneId ?? null,
    candidateIdentityVersion:
      handoff?.candidateIdentityVersion ?? candidate?.candidateIdentityVersion ?? null,

    blockers,
    reasonCodes: [
      "ENGINE3_STRATEGY1_READINESS_DIAGNOSTIC_V2",
      "ENGINE3_1M_WATCH_ONLY",
      "ENGINE3_5M_MATURE_REACTION_EVIDENCE",
      "ENGINE3_10M_BROADER_PRICE_CONFIRMATION",
      ...identityReasonCodes,
      readinessState,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],

    observedAt:
      fiveMinute?.observedAt ??
      oneMinute?.observedAt ??
      null,
  };
}

export default buildStrategy1Readiness;
