// services/core/logic/engine27/v2/buildTraderIntelligenceV2.js
//
// Engine 27 V2 — additive read-only trader intelligence.
//
// Frozen architecture:
// - Engine 22 owns Elliott Wave structural truth.
// - Engine 27 explains Engine 22 truth; it does not create a competing count.
// - Existing Engine 27A–27E contracts remain untouched.
// - Micro is additive as a sixth presentation degree.
// - Wave direction, Strategy 1 direction, and expected reversal remain separate.
// - Fib destination and wave-completion confirmation remain separate.
// - No permission, sizing, geometry, execution, or journal authority is created.

const DEGREE_ORDER = Object.freeze([
  "micro",
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
]);

const DEGREE_LABELS = Object.freeze({
  micro: "Micro",
  subminute: "Subminute",
  minute: "Minute",
  minor: "Minor",
  intermediate: "Intermediate",
  primary: "Primary",
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeDirection(value) {
  const direction = upper(value);

  if (["UP", "LONG", "BULLISH", "BULL", "BUY"].includes(direction)) {
    return "UP";
  }

  if (["DOWN", "SHORT", "BEARISH", "BEAR", "SELL"].includes(direction)) {
    return "DOWN";
  }

  if (["NEUTRAL", "FLAT", "SIDEWAYS", "NONE", "WAIT"].includes(direction)) {
    return "NEUTRAL";
  }

  return textOrNull(value);
}

function getStrategy(snapshot) {
  return snapshot?.strategies?.["intraday_scalp@10m"] || null;
}

function getEngine22(snapshot) {
  return getStrategy(snapshot)?.engine22WaveStrategy || null;
}

function snapshotTimestamp(snapshot) {
  return (
    textOrNull(snapshot?.now) ||
    textOrNull(snapshot?.ts) ||
    textOrNull(snapshot?.snapshotTime) ||
    textOrNull(snapshot?.generatedAtUtc) ||
    textOrNull(snapshot?.generatedAt) ||
    null
  );
}

function rowLookup(displayDegree, wantedLabels = []) {
  const wanted = wantedLabels.map((label) => upper(label));

  return safeArray(displayDegree?.rows).find((item) => {
    const label = upper(item?.label);
    return wanted.includes(label);
  }) || null;
}

function rowsContaining(displayDegree, fragments = []) {
  const wanted = fragments.map((fragment) => upper(fragment));

  return safeArray(displayDegree?.rows).filter((item) => {
    const label = upper(item?.label);
    return wanted.some((fragment) => label.includes(fragment));
  });
}

function normalizeLevel(level) {
  if (!isObject(level)) return null;

  const price = numberOrNull(level.price);

  if (price === null) return null;

  return {
    key: textOrNull(level.key),
    label: textOrNull(level.label) || textOrNull(level.key) || "Level",
    price,
    status: textOrNull(level.status),
    anchorSource: textOrNull(level.anchorSource),
    touchedAt: textOrNull(level.touchedAt),
    confirmedAt: textOrNull(level.confirmedAt),
  };
}

function collectLevels({ wavelength, display }) {
  const wavelengthLevels = safeArray(wavelength?.levels)
    .map(normalizeLevel)
    .filter(Boolean);

  if (wavelengthLevels.length) return wavelengthLevels;

  return safeArray(display?.levels)
    .map(normalizeLevel)
    .filter(Boolean);
}

function microCompletion(currentWavelength) {
  const micro = currentWavelength?.degrees?.micro || null;
  const sequence = micro?.microSequence || null;
  const activeWave = upper(sequence?.activeWave || micro?.activeWave);

  if (activeWave === "W2") {
    return sequence?.w2Completion || null;
  }

  if (activeWave === "W1") {
    return sequence?.w1Completion || null;
  }

  return null;
}

function confirmationEvidence({ degree, wavelength, currentWavelength }) {
  if (degree === "micro") {
    const completion = microCompletion(currentWavelength);

    return {
      // Keep the wave-completion lifecycle and Engine 22 confirmation summary
      // separate. currentCondition owns DEVELOPING -> CANDIDATE -> CONFIRMED
      // -> LOCKED; this field preserves Engine 22's broader confirmation read.
      status:
        textOrNull(wavelength?.confirmationStatus) ||
        textOrNull(currentWavelength?.degrees?.micro?.microSequence?.confirmationStatus) ||
        textOrNull(completion?.state) ||
        "NOT_PUBLISHED",
      evidence: unique([
        ...safeArray(completion?.reasonCodes),
        textOrNull(completion?.evidence?.event),
        textOrNull(completion?.evidence?.structureState),
      ]),
      sourceTimestamp:
        textOrNull(completion?.evidence?.sourceTimestamp) ||
        textOrNull(completion?.evidence?.timestamp) ||
        null,
    };
  }

  return {
    status: textOrNull(wavelength?.confirmationStatus) || "NOT_PUBLISHED",
    evidence: unique([
      textOrNull(wavelength?.confirmationRule),
      textOrNull(wavelength?.confirmationNote),
    ]),
    sourceTimestamp: null,
  };
}

function currentCondition({ degree, wavelength, display, state, currentWavelength }) {
  if (degree === "micro") {
    const completion = microCompletion(currentWavelength);

    return (
      textOrNull(completion?.state) ||
      textOrNull(wavelength?.state) ||
      textOrNull(display?.headline) ||
      "NOT_PUBLISHED"
    );
  }

  return (
    textOrNull(wavelength?.state) ||
    textOrNull(rowLookup(display, ["Current"])?.status) ||
    textOrNull(state?.stage) ||
    textOrNull(display?.headline) ||
    "NOT_PUBLISHED"
  );
}

function activeWave({ wavelength, display, state }) {
  return (
    textOrNull(wavelength?.activeWave) ||
    textOrNull(display?.badge) ||
    textOrNull(state?.activeWave) ||
    "NOT_PUBLISHED"
  );
}

function invalidationRead({ wavelength, display, state }) {
  const displayInvalidation =
    rowLookup(display, ["Invalidation", "Invalid", "W5 Invalidation"]) ||
    rowsContaining(display, ["INVALID"])[0] ||
    null;

  const price =
    numberOrNull(wavelength?.invalidation) ??
    numberOrNull(state?.internalStructure?.invalidationLevel) ??
    numberOrNull(state?.invalidationLevel) ??
    numberOrNull(displayInvalidation?.value);

  return {
    price,
    displayText: textOrNull(displayInvalidation?.value),
    reviewRule:
      textOrNull(wavelength?.invalidationTouchRule) ||
      null,
    failureRule:
      textOrNull(wavelength?.failureRule) ||
      null,
  };
}

function parentRead({ degree, state, display, currentWavelength }) {
  const parentRow = rowLookup(display, ["Parent"]);

  if (degree === "micro") {
    const timingDegree = textOrNull(currentWavelength?.timingDegree);
    const activeDegree = textOrNull(currentWavelength?.primaryActiveDegree);

    return {
      parentDegree:
        timingDegree === "micro" ? activeDegree : null,
      parentWave: null,
      displayText:
        timingDegree === "micro" && activeDegree
          ? `Micro timing is nested inside ${DEGREE_LABELS[activeDegree] || activeDegree}.`
          : null,
    };
  }

  return {
    parentDegree: textOrNull(state?.parentDegree),
    parentWave: textOrNull(state?.parentWave),
    displayText: textOrNull(parentRow?.value),
  };
}

function potentialCompletion({ wavelength, display }) {
  const levels = collectLevels({ wavelength, display });
  const next = normalizeLevel(wavelength?.nextLevel);

  return {
    nextLevel: next,
    levels,
    summary:
      next?.price != null
        ? `Next published structural level: ${next.label} at ${next.price}.`
        : levels.length
        ? "Published Engine 22 structural levels are shown below."
        : "No completion area is currently published by Engine 22.",
  };
}

function traderRead({
  degree,
  wave,
  direction,
  condition,
  confirmationStatus,
  display,
}) {
  const rules = safeArray(display?.rules).filter(Boolean);
  const directionText = direction || "direction not published";

  const lead =
    `${DEGREE_LABELS[degree]} ${wave} is ${directionText}. Current condition: ${condition}.`;

  const confirm =
    confirmationStatus && confirmationStatus !== "NOT_PUBLISHED"
      ? ` Confirmation status: ${confirmationStatus}.`
      : " Completion is not confirmed unless Engine 22 publishes confirmation.";

  return {
    headline: textOrNull(display?.headline) || lead,
    summary: `${lead}${confirm}`,
    rules,
  };
}

function freshnessRead({ snapshotTime, evidenceTimestamp }) {
  return {
    status:
      evidenceTimestamp
        ? "EVIDENCE_TIMESTAMP_PUBLISHED"
        : snapshotTime
        ? "SNAPSHOT_TIMESTAMP_ONLY"
        : "TIMESTAMP_UNAVAILABLE",
    snapshotTimestamp: snapshotTime,
    evidenceTimestamp: evidenceTimestamp || null,
  };
}

function buildDegree({
  degree,
  state,
  display,
  wavelength,
  currentWavelength,
  snapshotTime,
}) {
  const wave = activeWave({ wavelength, display, state });

  const direction = normalizeDirection(
    display?.direction ?? state?.direction
  );

  const condition = currentCondition({
    degree,
    wavelength,
    display,
    state,
    currentWavelength,
  });

  const confirmation = confirmationEvidence({
    degree,
    wavelength,
    currentWavelength,
  });

  const invalidation = invalidationRead({
    wavelength,
    display,
    state,
  });

  const parentContext = parentRead({
    degree,
    state,
    display,
    currentWavelength,
  });

  const completion = potentialCompletion({
    wavelength,
    display,
  });

  const source =
    wavelength
      ? "engine22WaveStrategy.currentWavelength"
      : display
      ? "engine22WaveStrategy.engine22Display"
      : state
      ? "engine22WaveStrategy.degreeStates"
      : "NOT_PUBLISHED";

  return {
    degree,
    label: DEGREE_LABELS[degree],

    activeWave: wave,
    waveDirection: direction,
    currentCondition: condition,

    potentialCompletion: completion,

    confirmationNeeded: {
      status: confirmation.status,
      evidence: confirmation.evidence,
      rule: textOrNull(wavelength?.confirmationRule),
      note: textOrNull(wavelength?.confirmationNote),
    },

    invalidation,
    parentContext,

    traderRead: traderRead({
      degree,
      wave,
      direction,
      condition,
      confirmationStatus: confirmation.status,
      display,
    }),

    provenance: {
      structuralSource: source,
      confirmationStatus: confirmation.status,
      freshness: freshnessRead({
        snapshotTime,
        evidenceTimestamp: confirmation.sourceTimestamp,
      }),
    },

    noPermissionCreated: true,
    noSizingCreated: true,
    noGeometryCreated: true,
    noExecution: true,
    noJournalWrite: true,
  };
}

function buildMinuteStrategy1Readiness(snapshot) {
  const strategy = getStrategy(snapshot);

  if (!strategy) return null;

  const candidate = strategy.engine26LocationCandidate || null;
  const reaction =
    strategy?.confluence?.context?.reaction?.paperScalpReaction || null;
  const participation =
    strategy?.confluence?.context?.volume
      ?.engine4AuthorizedReactionParticipation || null;
  const permission = strategy?.permission?.paper || null;
  const geometry = strategy?.engine26ProposedGeometry || null;

  return {
    title: "STRATEGY 1 READINESS",

    candidateIdentity: {
      laneId: textOrNull(candidate?.laneId),
      strategyId: textOrNull(candidate?.strategyId),
      candidateId: textOrNull(candidate?.candidateId),
      zoneId: textOrNull(candidate?.zoneId),
      setupClass: textOrNull(candidate?.setupClass),
      setupGrade: textOrNull(candidate?.setupGrade),
      identitySetupKey: textOrNull(candidate?.identitySetupKey),
      candidateIdentityVersion: textOrNull(candidate?.candidateIdentityVersion),
    },

    strategyDirection:
      textOrNull(candidate?.currentObservationDirection) ||
      textOrNull(candidate?.direction) ||
      "NEUTRAL",

    expectedReversal:
      textOrNull(candidate?.expectedReversalDirection) ||
      textOrNull(reaction?.expectedReactionDirection) ||
      textOrNull(participation?.intendedDirection) ||
      null,

    location: {
      status:
        textOrNull(candidate?.contactState) ||
        textOrNull(candidate?.directionState) ||
        textOrNull(candidate?.status),
      currentPrice: numberOrNull(candidate?.currentPrice),
      invalidationBoundary:
        numberOrNull(candidate?.locationInvalidationBoundary),
    },

    reaction: {
      active: reaction?.active === true,
      armed: reaction?.armed === true,
      confirmed:
        reaction?.reactionConfirmed === true ||
        reaction?.confirmed === true ||
        reaction?.allowed === true,
      state:
        textOrNull(reaction?.reactionState) ||
        textOrNull(reaction?.state),
    },

    participation: {
      active: participation?.active === true,
      armed: participation?.armed === true,
      confirmed:
        participation?.participationConfirmed === true ||
        participation?.confirmed === true ||
        participation?.allowed === true,
      state:
        textOrNull(participation?.participationState) ||
        textOrNull(participation?.status) ||
        textOrNull(participation?.state),
    },

    permission: {
      allowed: permission?.allowed === true,
      planningAllowed: permission?.planningAllowed === true,
      decision: textOrNull(permission?.decision),
    },

    geometry: {
      ready:
        geometry?.geometryReady === true ||
        (
          geometry?.active === true &&
          upper(geometry?.lifecycleStatus) === "PROPOSED_GEOMETRY_AVAILABLE"
        ),
      lifecycleStatus: textOrNull(geometry?.lifecycleStatus),
    },

    noPermissionCreated: true,
    noSizingCreated: true,
    noGeometryCreated: true,
    noExecution: true,
  };
}

export function buildEngine27TraderIntelligenceV2({ snapshot } = {}) {
  const engine22 = getEngine22(snapshot);
  const degreeStates = isObject(engine22?.degreeStates)
    ? engine22.degreeStates
    : {};
  const displayDegrees = isObject(engine22?.engine22Display?.degrees)
    ? engine22.engine22Display.degrees
    : {};
  const currentWavelength = isObject(engine22?.currentWavelength)
    ? engine22.currentWavelength
    : {};
  const wavelengthDegrees = isObject(currentWavelength?.degrees)
    ? currentWavelength.degrees
    : {};

  const snapshotTime = snapshotTimestamp(snapshot);
  const degrees = {};

  for (const degree of DEGREE_ORDER) {
    degrees[degree] = buildDegree({
      degree,
      state: degreeStates?.[degree] || null,
      display: displayDegrees?.[degree] || null,
      wavelength: wavelengthDegrees?.[degree] || null,
      currentWavelength,
      snapshotTime,
    });
  }

  degrees.minute.strategy1Readiness =
    buildMinuteStrategy1Readiness(snapshot);

  return {
    active: Boolean(engine22),
    engine: "engine27.traderIntelligenceV2.v1",
    mode: "READ_ONLY",
    symbol: textOrNull(snapshot?.symbol),
    builtAt: new Date().toISOString(),

    degreeOrder: [...DEGREE_ORDER],
    degrees,

    architecture: {
      structuralAuthority: "ENGINE22",
      locationAuthority: "ENGINE26",
      geometryAuthority: "ENGINE26B",
      reactionAuthority: "ENGINE3",
      participationAuthority: "ENGINE4",
      permissionAuthority: "ENGINE6",
      sizingAuthority: "ENGINE7",
      managementAuthority: "ENGINE9",
      executionAuthority: "ENGINE8",
      journalAuthority: "ENGINE10",
    },

    compatibility: {
      additiveOnly: true,
      existingEngine27ContractsUntouched: true,
      existingFiveDegreePipelinePreserved: true,
      microAddedForPresentation: true,
    },

    noPermissionCreated: true,
    noSizingCreated: true,
    noGeometryCreated: true,
    noTicketCreated: true,
    noExecution: true,
    noJournalWrite: true,

    reasonCodes: [
      "ENGINE27_V2_SIX_DEGREE_PRESENTATION_BUILT",
      "ENGINE22_STRUCTURAL_AUTHORITY_PRESERVED",
      "ENGINE27_V2_ADDITIVE_ONLY",
      "ENGINE27_EXISTING_A_TO_E_CONTRACTS_PRESERVED",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildEngine27TraderIntelligenceV2;
