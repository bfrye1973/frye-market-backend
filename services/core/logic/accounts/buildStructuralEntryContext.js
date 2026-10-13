import { resolveStrategyAccountRole } from "./strategyAccountRegistry.js";

const DEGREE_ORDER = Object.freeze([
  "micro",
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
]);

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function text(value) {
  const out = String(value ?? "").trim();
  return out || null;
}

function normalizeDirection(value) {
  const v = upper(value);
  if (["UP", "LONG", "BULL", "BULLISH"].includes(v)) return "UP";
  if (["DOWN", "SHORT", "BEAR", "BEARISH"].includes(v)) return "DOWN";
  if (["FLAT", "NEUTRAL", "NONE"].includes(v)) return "NEUTRAL";
  return v || null;
}

function degreeState(engine22WaveStrategy, degree) {
  if (!engine22WaveStrategy) return null;

  if (degree === "micro") {
    const micro = engine22WaveStrategy?.microExecutionContext || null;
    if (!micro) return null;
    return {
      degree: "micro",
      source: "engine22WaveStrategy.microExecutionContext",
      activeWave: text(micro?.activeWave),
      direction: normalizeDirection(micro?.waveDirection ?? micro?.direction),
      lifecycle: text(micro?.lifecycle),
      stage: text(micro?.microTimingState ?? micro?.stage),
      countStatus: text(micro?.countStatus),
      countId: text(micro?.sourceCountId ?? micro?.countId),
      revision: Number.isFinite(Number(micro?.revision)) ? Number(micro.revision) : null,
      sourceTimestamp: text(micro?.sourceTimestamp),
      invalidation: clone(micro?.invalidation ?? null),
    };
  }

  const state = engine22WaveStrategy?.degreeStates?.[degree] || null;
  if (!state) return null;

  return {
    degree,
    source: "engine22WaveStrategy.degreeStates",
    activeWave: text(state?.activeWave ?? state?.currentWave ?? state?.wave),
    direction: normalizeDirection(state?.direction ?? state?.currentLegDirection ?? state?.preferredTradeDirection),
    lifecycle: text(state?.lifecycle ?? state?.state ?? state?.status),
    stage: text(state?.stage),
    countStatus: text(state?.countStatus),
    countId: text(state?.sourceCountId ?? state?.countId),
    revision: Number.isFinite(Number(state?.revision)) ? Number(state.revision) : null,
    sourceTimestamp: text(state?.sourceTimestamp ?? state?.updatedAt),
    invalidation: clone(state?.invalidation ?? state?.hardInvalidation ?? null),
  };
}

export function buildStructuralContextAtEntry({
  strategySnapshot = null,
  brokerAccountLabel = null,
  legacyJournalAccount = null,
  fillTime = null,
  capturedAt = null,
} = {}) {
  const roleResolution = resolveStrategyAccountRole({
    brokerAccountLabel,
    legacyJournalAccount,
  });

  if (!roleResolution?.resolved || !roleResolution?.account) {
    return {
      available: false,
      reason: "STRATEGY_ACCOUNT_ROLE_UNRESOLVED_AT_ENTRY",
      fillTime: text(fillTime),
      capturedAt: text(capturedAt),
      snapshotTime: text(strategySnapshot?.now),
      provenance: "NO_BACKFILL",
    };
  }

  const engine22WaveStrategy =
    strategySnapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy || null;

  if (!engine22WaveStrategy) {
    return {
      available: false,
      reason: "ENGINE22_STRUCTURE_UNAVAILABLE_AT_ENTRY",
      accountRole: roleResolution.account.accountRole,
      structuralOwner: roleResolution.account.structuralOwner,
      fillTime: text(fillTime),
      capturedAt: text(capturedAt),
      snapshotTime: text(strategySnapshot?.now),
      provenance: "NO_BACKFILL",
    };
  }

  const degrees = Object.fromEntries(
    DEGREE_ORDER.map((degree) => [degree, degreeState(engine22WaveStrategy, degree)])
  );

  const ownerDegree = roleResolution.account.degree;
  const ownerState = degrees[ownerDegree] || null;

  return {
    available: true,
    contractVersion: "engine10.structuralContextAtEntry.v1",
    immutable: true,
    accountRole: roleResolution.account.accountRole,
    structuralOwner: roleResolution.account.structuralOwner,
    ownerDegree,
    ownerState: clone(ownerState),
    degrees,
    fillTime: text(fillTime),
    capturedAt: text(capturedAt),
    snapshotTime: text(strategySnapshot?.now),
    captureTiming: "LIVE_SNAPSHOT_AT_ENGINE10_INGEST",
    provenance: "ENGINE22_CANONICAL_SNAPSHOT",
    historicalBackfill: false,
    warning:
      text(fillTime) && text(strategySnapshot?.now) && text(fillTime) !== text(strategySnapshot?.now)
        ? "SNAPSHOT_TIME_MAY_DIFFER_FROM_EXACT_BROKER_FILL_TIME"
        : null,
  };
}

export function compareStructuralContext({
  entryContext = null,
  currentEngine22WaveStrategy = null,
  positionDirection = null,
} = {}) {
  if (!entryContext?.available) {
    return {
      available: false,
      state: "ENTRY_STRUCTURE_UNAVAILABLE",
      reason: entryContext?.reason || "NO_ENTRY_STRUCTURE",
    };
  }

  const ownerDegree = entryContext.ownerDegree;
  const currentDegrees = Object.fromEntries(
    DEGREE_ORDER.map((degree) => [degree, degreeState(currentEngine22WaveStrategy, degree)])
  );
  const currentOwner = currentDegrees[ownerDegree] || null;
  const entryOwner = entryContext.ownerState || entryContext?.degrees?.[ownerDegree] || null;

  const desired = upper(positionDirection) === "SHORT" ? "DOWN" : upper(positionDirection) === "LONG" ? "UP" : null;
  const ownerDirection = normalizeDirection(currentOwner?.direction);
  const ownerAlignment = !desired || !ownerDirection
    ? "UNAVAILABLE"
    : ownerDirection === desired
      ? "ALIGNED"
      : ownerDirection === "NEUTRAL"
        ? "NEUTRAL"
        : "OPPOSED";

  const ownerIndex = DEGREE_ORDER.indexOf(ownerDegree);
  const lowerDegrees = ownerIndex > 0 ? DEGREE_ORDER.slice(0, ownerIndex) : [];
  const higherDegrees = ownerIndex >= 0 ? DEGREE_ORDER.slice(ownerIndex + 1) : [];

  const alignmentFor = (degree) => {
    const direction = normalizeDirection(currentDegrees?.[degree]?.direction);
    if (!desired || !direction) return "UNAVAILABLE";
    if (direction === desired) return "ALIGNED";
    if (direction === "NEUTRAL") return "NEUTRAL";
    return "OPPOSED";
  };

  const degreeAlignment = Object.fromEntries(
    DEGREE_ORDER.map((degree) => [degree, alignmentFor(degree)])
  );

  const opposedLower = lowerDegrees.filter((degree) => degreeAlignment[degree] === "OPPOSED");
  const opposedHigher = higherDegrees.filter((degree) => degreeAlignment[degree] === "OPPOSED");
  const immediateLower = ownerIndex > 0 ? DEGREE_ORDER[ownerIndex - 1] : null;

  let state = "ALIGNED";
  if (ownerAlignment === "OPPOSED") {
    state = "THESIS_BROKEN";
  } else if (ownerAlignment === "UNAVAILABLE" || ownerAlignment === "NEUTRAL") {
    state = "THESIS_WEAKENING";
  } else if (opposedHigher.length > 0) {
    state = "THESIS_WEAKENING";
  } else if (immediateLower && degreeAlignment[immediateLower] === "OPPOSED" && opposedLower.length >= 2) {
    state = "EARLY_WARNING";
  } else if (opposedLower.length > 0) {
    state = "LOWER_DEGREE_PULLBACK";
  }

  const changedSinceEntry =
    text(entryOwner?.activeWave) !== text(currentOwner?.activeWave) ||
    normalizeDirection(entryOwner?.direction) !== normalizeDirection(currentOwner?.direction) ||
    text(entryOwner?.lifecycle) !== text(currentOwner?.lifecycle) ||
    text(entryOwner?.stage) !== text(currentOwner?.stage) ||
    text(entryOwner?.countId) !== text(currentOwner?.countId) ||
    Number(entryOwner?.revision ?? -1) !== Number(currentOwner?.revision ?? -1);

  return {
    available: true,
    state,
    ownerDegree,
    ownerAlignment,
    degreeAlignment,
    opposedLowerDegrees: opposedLower,
    opposedHigherDegrees: opposedHigher,
    entryOwner: clone(entryOwner),
    currentOwner: clone(currentOwner),
    changedSinceEntry,
    managementAuthority: false,
    executionAuthority: false,
    guidance:
      state === "THESIS_BROKEN"
        ? "Structural owner is opposed to the open position. Review Engine 9 management; no automatic exit is created here."
        : state === "THESIS_WEAKENING"
          ? "Higher/owner structure is no longer cleanly aligned. Review Engine 9 management and profit protection."
          : state === "EARLY_WARNING"
            ? "The immediate lower degree and additional lower structure are opposed. Treat as an early warning, not an automatic exit."
            : state === "LOWER_DEGREE_PULLBACK"
              ? "Lower-degree countertrend is present while the structural owner remains aligned. Do not treat lower-degree noise as an automatic thesis break."
              : "The structural owner remains aligned with the open position.",
  };
}

export { DEGREE_ORDER };