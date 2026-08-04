const IDENTITY_FIELDS = [
  "symbol",
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "candidateIdentityVersion",
];

const MAX_CROSS_TIMEFRAME_SKEW_MS = 5 * 60 * 1000;

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
    const values = inputs.map((input) => input?.[field]);
    if (values.some((value) => value == null || value === "")) {
      reasons.push(`ENGINE3_READINESS_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_MISSING`);
      continue;
    }
    if (values.some((value) => value !== values[0])) {
      reasons.push(`ENGINE3_READINESS_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_MISMATCH`);
    }
  }
  return reasons;
}

function meaningFor(state) {
  const meanings = {
    IDENTITY_MISMATCH: "Required Engine 26, 1-minute, and 5-minute identities are missing or do not match.",
    STALE_DATA: "The 1-minute or 5-minute evidence is stale or the two timeframes are not aligned.",
    WAITING_FOR_ENGINE26_LOCATION: "Engine 26 has not published a complete negotiated location.",
    ENGINE26_NOT_AUTHORIZED: "Engine 26 has published the location but has not authorized Engine 3 evaluation.",
    CANONICAL_ENGINE3_QUALIFIED: "Canonical Engine 3 has qualified Strategy 1 for Engine 6 evaluation.",
    FAST_REACTION_AWAY_FROM_NEGOTIATED_ZONE: "A fresh local 1-minute reaction exists, but price is not inside or near the Engine 26 negotiated zone.",
    AT_NEGOTIATED_ZONE_WAITING_FOR_1M_REACTION: "Price is inside or near the Engine 26 negotiated zone, but no usable 1-minute reaction is present.",
    REACTION_OBSERVED_WAITING_FOR_5M_VALIDATION: "A fresh 1-minute reaction is present at the negotiated location, but 5-minute validation is missing or unresolved.",
    REACTION_VALIDATION_CONFLICT: "The fresh 5-minute validation conflicts with the 1-minute reaction direction.",
    FAST_EVIDENCE_ALIGNED: "Fresh 1-minute and 5-minute evidence aligns at the authorized negotiated location, but canonical Engine 3 has not qualified.",
  };
  return meanings[state] || "Strategy 1 diagnostic readiness is waiting for complete evidence.";
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
  const oneMinute = snapshot(observation1m);
  const fiveMinute = snapshot(validation5m);
  const canonical = snapshot(paperScalpReaction);
  const zone = snapshot(handoff?.zone);

  const zoneLow = finiteNumber(zone?.lo);
  const zoneHigh = finiteNumber(zone?.hi);
  const negotiatedReferenceLevel = finiteNumber(zone?.mid);
  const currentPrice = finiteNumber(candidate?.currentPrice);
  const relation = zone?.relation ?? null;
  const negotiatedZoneDistancePts = finiteNumber(zone?.distancePoints);
  const completeLocation =
    candidate != null &&
    handoff != null &&
    zoneLow != null &&
    zoneHigh != null &&
    negotiatedReferenceLevel != null &&
    currentPrice != null &&
    relation != null &&
    negotiatedZoneDistancePts != null;

  const identityInputs = completeLocation
    ? [candidate, handoff, ...(oneMinute ? [oneMinute] : []), ...(fiveMinute ? [fiveMinute] : [])]
    : [];
  const identityReasonCodes = identityInputs.length >= 2 ? identityReasons(identityInputs) : [];
  const identityAligned = completeLocation && oneMinute != null && identityReasonCodes.length === 0;

  const insideNegotiatedZone = relation === "INSIDE_ZONE";
  const nearNegotiatedZone = relation === "NEAR_ABOVE_ZONE" || relation === "NEAR_BELOW_ZONE";
  const locationReady = insideNegotiatedZone || nearNegotiatedZone;
  const engine26Authorized = handoff?.authorizeEngine3Evaluation === true;

  const oneMinuteStale = oneMinute?.stale === true;
  const fiveMinutePresent = fiveMinute != null && fiveMinute.active === true;
  const fiveMinuteStale = fiveMinutePresent && fiveMinute.stale === true;
  const skew = finiteNumber(fiveMinute?.crossTimeframeSkewMs);
  const crossTimeframeAligned = fiveMinutePresent && skew != null && skew <= MAX_CROSS_TIMEFRAME_SKEW_MS;
  const dataFresh = oneMinute != null && !oneMinuteStale && (!fiveMinutePresent || !fiveMinuteStale);

  const reactionObserved1m =
    oneMinute?.active === true &&
    oneMinute?.stale === false &&
    oneMinute?.direction != null &&
    oneMinute.direction !== "NEUTRAL" &&
    oneMinute?.state !== "NO_SIGNAL";
  const validationAvailable5m = fiveMinutePresent;
  const validationResolved5m = fiveMinute?.maturityResolved === true;
  const validationSupports1m = fiveMinute?.supports1mDirection === true;
  const validationConflictsWith1m = fiveMinute?.conflictsWith1mDirection === true;

  const canonicalEngine3Allowed = canonical?.allowed === true;
  const canonicalEngine3QualifiedForEngine6 = canonical?.engine3Strategy1QualifiedForEngine6 === true;
  const canonicalAliasesAgree = canonicalEngine3Allowed === canonicalEngine3QualifiedForEngine6;
  const canonicalQualified = canonicalEngine3Allowed && canonicalEngine3QualifiedForEngine6;

  let readinessState;
  if (!completeLocation) readinessState = "WAITING_FOR_ENGINE26_LOCATION";
  else if (!identityAligned) readinessState = "IDENTITY_MISMATCH";
  else if (oneMinuteStale || fiveMinuteStale || (fiveMinutePresent && !crossTimeframeAligned)) readinessState = "STALE_DATA";
  else if (!engine26Authorized) readinessState = "ENGINE26_NOT_AUTHORIZED";
  else if (canonicalQualified) readinessState = "CANONICAL_ENGINE3_QUALIFIED";
  else if (reactionObserved1m && !locationReady) readinessState = "FAST_REACTION_AWAY_FROM_NEGOTIATED_ZONE";
  else if (!reactionObserved1m) readinessState = "AT_NEGOTIATED_ZONE_WAITING_FOR_1M_REACTION";
  else if (!validationAvailable5m || !validationResolved5m) readinessState = "REACTION_OBSERVED_WAITING_FOR_5M_VALIDATION";
  else if (validationConflictsWith1m) readinessState = "REACTION_VALIDATION_CONFLICT";
  else if (validationSupports1m && crossTimeframeAligned) readinessState = "FAST_EVIDENCE_ALIGNED";
  else readinessState = "REACTION_OBSERVED_WAITING_FOR_5M_VALIDATION";

  const blockers = [];
  if (!completeLocation) blockers.push("ENGINE26_NEGOTIATED_LOCATION_MISSING");
  if (completeLocation && !identityAligned) blockers.push("IDENTITY_NOT_ALIGNED");
  if (oneMinuteStale || fiveMinuteStale || (fiveMinutePresent && !crossTimeframeAligned)) blockers.push("DIAGNOSTIC_DATA_STALE_OR_SKEWED");
  if (completeLocation && !engine26Authorized) blockers.push("ENGINE26_EVALUATION_NOT_AUTHORIZED");
  if (reactionObserved1m && !locationReady) blockers.push("PRICE_AWAY_FROM_ENGINE26_NEGOTIATED_ZONE");
  if (!reactionObserved1m) blockers.push("ONE_MINUTE_REACTION_NOT_OBSERVED");
  if (reactionObserved1m && (!validationAvailable5m || !validationResolved5m)) blockers.push("FIVE_MINUTE_VALIDATION_NOT_RESOLVED");
  if (validationConflictsWith1m) blockers.push("ONE_AND_FIVE_MINUTE_DIRECTION_CONFLICT");
  if (!canonicalAliasesAgree) blockers.push("CANONICAL_ENGINE3_QUALIFICATION_ALIAS_MISMATCH");

  const distanceToNegotiatedReferencePts =
    currentPrice != null && negotiatedReferenceLevel != null
      ? Math.round((currentPrice - negotiatedReferenceLevel) * 100) / 100
      : null;

  return {
    active: true,
    diagnosticOnly: true,
    noPermissionCreated: true,
    noExecution: true,
    readinessState,
    plainEnglishMeaning: meaningFor(readinessState),
    locationReady,
    engine26Authorized,
    insideNegotiatedZone,
    nearNegotiatedZone,
    negotiatedZoneDistancePts,
    reactionObserved1m,
    reactionDirection1m: oneMinute?.direction ?? "NEUTRAL",
    reactionQuality1m: oneMinute?.quality ?? null,
    validationAvailable5m,
    validationState5m: fiveMinute?.validationState ?? null,
    validationSupports1m,
    validationConflictsWith1m,
    identityAligned,
    dataFresh,
    crossTimeframeAligned,
    canonicalEngine3Allowed,
    canonicalEngine3QualifiedForEngine6,
    localReferenceLevel: finiteNumber(oneMinute?.referenceLevel),
    localReferenceType: oneMinute?.referenceType ?? null,
    negotiatedReferenceLevel,
    negotiatedReferenceType: "ENGINE26_NEGOTIATED_ZONE_MIDPOINT",
    distanceToLocalReferencePts: finiteNumber(oneMinute?.distancePts),
    distanceToNegotiatedReferencePts,
    contactState: handoff?.contactState ?? candidate?.contactState ?? null,
    symbol: handoff?.symbol ?? candidate?.symbol ?? null,
    laneId: handoff?.laneId ?? candidate?.laneId ?? null,
    strategyId: handoff?.strategyId ?? candidate?.strategyId ?? null,
    candidateId: handoff?.candidateId ?? candidate?.candidateId ?? null,
    zoneId: handoff?.zoneId ?? candidate?.zoneId ?? null,
    candidateIdentityVersion: handoff?.candidateIdentityVersion ?? candidate?.candidateIdentityVersion ?? null,
    blockers,
    reasonCodes: [
      "ENGINE3_STRATEGY1_READINESS_DIAGNOSTIC",
      ...identityReasonCodes,
      ...(!canonicalAliasesAgree ? ["CANONICAL_ENGINE3_QUALIFICATION_ALIAS_MISMATCH"] : []),
      readinessState,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
    observedAt: oneMinute?.observedAt ?? fiveMinute?.observedAt ?? null,
  };
}

export default buildStrategy1Readiness;
