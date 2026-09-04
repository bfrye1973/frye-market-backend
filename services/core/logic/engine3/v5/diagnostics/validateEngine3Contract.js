// services/core/logic/engine3/v5/diagnostics/validateEngine3Contract.js
//
// Engine 3 v5 — Contract validator.
//
// Contract:
// - Validation-only.
// - Verifies frozen Engine 3 v5 ownership and authority rules.
// - Does not calculate price action.
// - Does not calculate control.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not create permission.
// - Does not create execution.
//
// Purpose:
// Fail closed when a future code change violates the v5 architecture.

const ENGINE = "engine3.v5.diagnostics.validateEngine3Contract.v1";
const SOURCE = "engine3.v5.diagnostics.validateEngine3Contract";

function unique(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .filter(Boolean)
        .map((value) => String(value))
    ),
  ];
}

function hasCanonicalDirectionValue(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  return ["LONG", "SHORT", "NEUTRAL"].includes(text);
}

export function validateEngine3Contract({
  normalizedZoneInput = null,
  oneMinuteEvidence = null,
  fiveMinuteReaction = null,
  tenMinuteContext = null,
  departureState = null,
  ema10TravelState = null,
  stateMachine = null,
  canonical = null,
  shadowMode = true,
} = {}) {
  const violations = [];
  const warnings = [];
  const checks = {};

  checks.zoneInputExists =
    normalizedZoneInput != null;

  if (!checks.zoneInputExists) {
    violations.push(
      "ENGINE3_V5_CONTRACT_ZONE_INPUT_MISSING"
    );
  }

  checks.engine26DirectionalOpinionAuthorityDisabled =
    normalizedZoneInput
      ?.directionalAuthority
      ?.engine26DirectionalOpinionAuthority !== true;

  if (!checks.engine26DirectionalOpinionAuthorityDisabled) {
    violations.push(
      "ENGINE3_V5_CONTRACT_ENGINE26_DIRECTION_AUTHORITY_VIOLATION"
    );
  }

  checks.oneMinuteCanonicalAuthorityDisabled =
    oneMinuteEvidence?.canonicalAuthority !== true &&
    oneMinuteEvidence?.canCreateCanonicalDirection !== true &&
    oneMinuteEvidence?.canFlipCanonicalDirection !== true;

  if (!checks.oneMinuteCanonicalAuthorityDisabled) {
    violations.push(
      "ENGINE3_V5_CONTRACT_1M_CANONICAL_AUTHORITY_VIOLATION"
    );
  }

  checks.oneMinuteNoTopLevelDirection =
    !hasCanonicalDirectionValue(
      oneMinuteEvidence?.direction
    );

  if (!checks.oneMinuteNoTopLevelDirection) {
    violations.push(
      "ENGINE3_V5_CONTRACT_1M_TOP_LEVEL_DIRECTION_VIOLATION"
    );
  }

  checks.formingFiveMinuteCanonicalAuthorityDisabled =
    fiveMinuteReaction
      ?.forming5mAuthorizedForStateMachine !== true;

  if (!checks.formingFiveMinuteCanonicalAuthorityDisabled) {
    violations.push(
      "ENGINE3_V5_CONTRACT_FORMING_5M_AUTHORITY_VIOLATION"
    );
  }

  checks.completedFiveMinuteAuthorityPresent =
    fiveMinuteReaction
      ?.completed5mAuthorizedForStateMachine === true;

  if (!checks.completedFiveMinuteAuthorityPresent) {
    violations.push(
      "ENGINE3_V5_CONTRACT_COMPLETED_5M_AUTHORITY_MISSING"
    );
  }

  checks.fiveMinuteBuilderDoesNotPublishCanonicalDirection =
    fiveMinuteReaction
      ?.stateMachineHandoff
      ?.canonicalDirection == null &&
    fiveMinuteReaction
      ?.canonicalDirectionPublisher !== true;

  if (!checks.fiveMinuteBuilderDoesNotPublishCanonicalDirection) {
    violations.push(
      "ENGINE3_V5_CONTRACT_5M_DIRECTION_PUBLISHER_VIOLATION"
    );
  }

  checks.tenMinuteCannotCreateInitialDirection =
    tenMinuteContext
      ?.canCreateInitialCanonicalDirection !== true;

  if (!checks.tenMinuteCannotCreateInitialDirection) {
    violations.push(
      "ENGINE3_V5_CONTRACT_10M_INITIAL_DIRECTION_AUTHORITY_VIOLATION"
    );
  }

  checks.departureCannotCreateDirection =
    departureState
      ?.canCreateDirectionFromNeutral !== true &&
    departureState
      ?.canonicalDirectionPublisher !== true;

  if (!checks.departureCannotCreateDirection) {
    violations.push(
      "ENGINE3_V5_CONTRACT_DEPARTURE_DIRECTION_AUTHORITY_VIOLATION"
    );
  }

  checks.ema10CannotCreateDirection =
    ema10TravelState
      ?.canCreateDirectionFromNeutral !== true &&
    ema10TravelState
      ?.canonicalDirectionPublisher !== true;

  if (!checks.ema10CannotCreateDirection) {
    violations.push(
      "ENGINE3_V5_CONTRACT_EMA10_DIRECTION_AUTHORITY_VIOLATION"
    );
  }

  checks.ema10CannotReverseDirection =
    ema10TravelState
      ?.canReverseDirection !== true;

  if (!checks.ema10CannotReverseDirection) {
    violations.push(
      "ENGINE3_V5_CONTRACT_EMA10_REVERSAL_AUTHORITY_VIOLATION"
    );
  }

  checks.stateMachineSoleDirectionPublisher =
    stateMachine
      ?.soleCanonicalDirectionPublisher === true &&
    stateMachine
      ?.canonicalAuthority === true;

  if (!checks.stateMachineSoleDirectionPublisher) {
    violations.push(
      "ENGINE3_V5_CONTRACT_STATE_MACHINE_AUTHORITY_MISSING"
    );
  }

  checks.canonicalDirectionMatchesStateMachine =
    String(
      canonical
        ?.canonical
        ?.direction ||
      ""
    ).toUpperCase() ===
    String(
      stateMachine
        ?.direction ||
      ""
    ).toUpperCase();

  if (!checks.canonicalDirectionMatchesStateMachine) {
    violations.push(
      "ENGINE3_V5_CONTRACT_CANONICAL_DIRECTION_MISMATCH"
    );
  }

  checks.shadowDownstreamAuthorityDisabled =
    shadowMode !== true ||
    (
      canonical
        ?.authoritativeDownstream !== true &&
      canonical
        ?.safety
        ?.engine4Authority !== true &&
      canonical
        ?.safety
        ?.engine6Authority !== true
    );

  if (!checks.shadowDownstreamAuthorityDisabled) {
    violations.push(
      "ENGINE3_V5_CONTRACT_SHADOW_DOWNSTREAM_AUTHORITY_VIOLATION"
    );
  }

  if (
    normalizedZoneInput?.eligible !== true
  ) {
    warnings.push(
      "ENGINE3_V5_ZONE_CURRENTLY_NOT_ELIGIBLE"
    );
  }

  const valid =
    violations.length === 0;

  return {
    ok: valid,

    engine: ENGINE,
    source: SOURCE,

    valid,

    status:
      valid
        ? "ENGINE3_V5_CONTRACT_VALID"
        : "ENGINE3_V5_CONTRACT_INVALID",

    shadowMode:
      shadowMode === true,

    checks,

    violations:
      unique(violations),

    warnings:
      unique(warnings),

    failClosed:
      valid !== true,

    downstreamAuthorityAllowed:
      shadowMode !== true &&
      valid === true,

    noPermissionCreated:
      true,

    noExecution:
      true,

    reasonCodes: unique([
      "ENGINE3_V5_CONTRACT_VALIDATED",

      valid
        ? "ENGINE3_V5_CONTRACT_VALID"
        : "ENGINE3_V5_CONTRACT_INVALID",

      valid
        ? "ENGINE3_V5_FROZEN_AUTHORITY_RULES_PASSED"
        : "ENGINE3_V5_FROZEN_AUTHORITY_RULES_FAILED",

      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ]),
  };
}

export default validateEngine3Contract;
