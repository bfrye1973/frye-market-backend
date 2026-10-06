// services/core/logic/engine3/v5/buildEngine3Strategy1Handoff.js
//
// Engine 3 v5 — Strategy 1 stable downstream handoff.
//
// PURPOSE
// -------
// Convert Engine 3 v5 canonical state into ONE stable contract that existing
// Engine 4 / Engine 6 consumers can read.
//
// IMPORTANT OWNERSHIP RULES
// -------------------------
// - Engine 26 owns WHERE / candidate / zone / authorization.
// - Engine 3 v5 owns canonical LONG / SHORT / NEUTRAL.
// - Engine 4 owns participation.
// - Engine 6 owns final PAPER permission.
//
// CRITICAL SIGNAL RULE
// --------------------
// Once Engine 3 v5 has established a canonical LONG or SHORT, this handoff
// keeps reactionConfirmed = true while that canonical direction remains held.
//
// Temporary local price-action states such as:
//   CONTESTED / ABSORPTION / NO_CONTROL
// do NOT withdraw the canonical signal.
//
// Only the Engine 3 v5 state machine may reverse or reset the canonical signal.
//
// This module creates:
// - no Engine 6 permission
// - no ticket
// - no execution
// - no journal event

const ENGINE = "engine3.v5.strategy1Handoff.v1";
const SOURCE = "engine3.v5.buildEngine3Strategy1Handoff";

function safeUpper(value, fallback = "") {
  const text = String(value ?? "").trim().toUpperCase();
  return text || fallback;
}

function normalizeDirection(value) {
  const d = safeUpper(value, "NEUTRAL");

  if (d === "LONG") return "LONG";
  if (d === "SHORT") return "SHORT";

  return "NEUTRAL";
}

function normalizeQuality(value) {
  const q = safeUpper(value, "WEAK");

  if (["STRONG", "GOOD", "MIXED", "WEAK"].includes(q)) {
    return q;
  }

  return "WEAK";
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeZone(zone = null) {
  if (!zone || typeof zone !== "object") {
    return null;
  }

  const low =
    toNumberOrNull(zone.low) ??
    toNumberOrNull(zone.lo);

  const high =
    toNumberOrNull(zone.high) ??
    toNumberOrNull(zone.hi);

  if (low == null || high == null) {
    return null;
  }

  const midline =
    toNumberOrNull(zone.midline) ??
    toNumberOrNull(zone.mid) ??
    Number(((low + high) / 2).toFixed(2));

  const zoneId =
    zone.zoneId ??
    zone.id ??
    null;

  return {
    ...zone,

    zoneId,
    id: zoneId,

    low,
    high,
    midline,

    // Compatibility aliases for older downstream readers.
    lo: low,
    hi: high,
    mid: midline,
  };
}

export function buildEngine3Strategy1Handoff({
  engine3V5 = null,

  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,

  observation1m = null,
  validation5m = null,
  confirmation10m = null,
} = {}) {
  /*
   * Current v5 canonical shape:
   *
   * engine3V5.canonical.canonical
   *
   * Keep a small fallback to stateMachine so this handoff fails gracefully
   * if the canonical wrapper is temporarily absent during development.
   */
  const canonicalEnvelope =
    engine3V5?.canonical &&
    typeof engine3V5.canonical === "object"
      ? engine3V5.canonical
      : null;

  const canonical =
    canonicalEnvelope?.canonical &&
    typeof canonicalEnvelope.canonical === "object"
      ? canonicalEnvelope.canonical
      : null;

  const stateMachine =
    engine3V5?.stateMachine &&
    typeof engine3V5.stateMachine === "object"
      ? engine3V5.stateMachine
      : null;

  /*
   * Price-action control is diagnostic/supporting evidence here.
   *
   * It must never override the state machine's canonical direction.
   */
  const priceActionControl =
    engine3V5?.priceActionControl ||
    engine3V5?.evidence?.priceActionControl ||
    engine3V5?.evidence?.priceAction ||
    null;

  const canonicalDirection =
    normalizeDirection(
      canonical?.direction ??
      stateMachine?.direction
    );

  const canonicalQuality =
    normalizeQuality(
      canonical?.quality ??
      stateMachine?.quality ??
      priceActionControl?.quality
    );

  const directional =
    canonicalDirection === "LONG" ||
    canonicalDirection === "SHORT";

  /*
   * Engine 3 v5 must itself be healthy.
   *
   * We intentionally do NOT fall back to legacy Engine 3 direction here.
   */
  const v5Available =
    engine3V5 &&
    typeof engine3V5 === "object";

  const v5FailClosed =
    engine3V5?.failClosed === true;

  const validationExplicitlyFailed =
    engine3V5?.validation?.valid === false;

  const v5Usable =
    v5Available &&
    v5FailClosed !== true &&
    validationExplicitlyFailed !== true;

  /*
   * Engine 26 remains the upstream authorization owner.
   */
  const engine26Authorized =
    engine26ReactionHandoff?.authorizeEngine3Evaluation === true &&
    engine26ReactionHandoff?.terminalLifecycle !== true;

  const candidateId =
    canonicalEnvelope?.candidateId ??
    engine26ReactionHandoff?.candidateId ??
    engine26LocationCandidate?.candidateId ??
    null;

  const zoneId =
    canonicalEnvelope?.zoneId ??
    engine26ReactionHandoff?.zoneId ??
    engine26LocationCandidate?.zoneId ??
    null;

  const laneId =
    canonicalEnvelope?.laneId ??
    engine26ReactionHandoff?.laneId ??
    engine26LocationCandidate?.laneId ??
    "minute";

  const strategyId =
    canonicalEnvelope?.strategyId ??
    engine26ReactionHandoff?.strategyId ??
    engine26LocationCandidate?.strategyId ??
    "intraday_scalp@10m";

  const symbol =
    canonicalEnvelope?.symbol ??
    engine26ReactionHandoff?.symbol ??
    engine26LocationCandidate?.symbol ??
    "ES";

  const identityComplete =
    candidateId != null &&
    zoneId != null &&
    laneId === "minute" &&
    strategyId === "intraday_scalp@10m";

  const resetNow =
    canonical?.resetNow === true ||
    stateMachine?.resetNow === true;

  /*
   * THIS IS THE STABLE SIGNAL.
   *
   * Once canonical direction is LONG or SHORT, reactionConfirmed stays true
   * while that canonical direction remains held.
   *
   * Local price-action noise is NOT allowed to switch this off.
   */
  const stableCanonicalSignal =
    v5Usable &&
    engine26Authorized &&
    identityComplete &&
    directional &&
    resetNow !== true;

  const reactionConfirmed =
    stableCanonicalSignal;

  const participationEvaluationEligible =
    stableCanonicalSignal;

  const authorizedReactionState =
    engine26ReactionHandoff?.terminalLifecycle === true
      ? "REACTION_INVALIDATED"
      : stableCanonicalSignal
      ? "REACTION_CONFIRMED"
      : "REACTION_WAITING";

  const zone =
    normalizeZone(
      canonicalEnvelope?.zone ??
      engine26ReactionHandoff?.zone ??
      engine26LocationCandidate?.entryZone ??
      null
    );

  const localControlState =
    safeUpper(
      priceActionControl?.controlState ??
      priceActionControl?.state,
      "NO_CONTROL"
    );

  const stateTransition =
    canonical?.stateTransition ??
    stateMachine?.stateTransition ??
    null;

  const establishedNow =
    canonical?.establishedNow === true ||
    stateMachine?.establishedNow === true;

  const reversedNow =
    canonical?.reversedNow === true ||
    stateMachine?.reversedNow === true;

  const heldNow =
    canonical?.heldNow === true ||
    stateMachine?.heldNow === true;

  const blockers = unique([
    !v5Available
      ? "ENGINE3_V5_UNAVAILABLE"
      : null,

    v5FailClosed
      ? "ENGINE3_V5_FAIL_CLOSED"
      : null,

    validationExplicitlyFailed
      ? "ENGINE3_V5_VALIDATION_FAILED"
      : null,

    !engine26Authorized
      ? "ENGINE26_ENGINE3_EVALUATION_NOT_AUTHORIZED"
      : null,

    !identityComplete
      ? "ENGINE3_V5_IDENTITY_INCOMPLETE"
      : null,

    !directional
      ? "ENGINE3_V5_CANONICAL_DIRECTION_NEUTRAL"
      : null,

    resetNow
      ? "ENGINE3_V5_CANONICAL_SIGNAL_RESET"
      : null,
  ]);

  const reasonCodes = unique([
    "ENGINE3_V5_STRATEGY1_HANDOFF",

    stableCanonicalSignal
      ? "ENGINE3_V5_STABLE_CANONICAL_SIGNAL_ACTIVE"
      : "ENGINE3_V5_STABLE_CANONICAL_SIGNAL_INACTIVE",

    stableCanonicalSignal
      ? `ENGINE3_V5_REACTION_CONFIRMED_${canonicalDirection}`
      : "ENGINE3_V5_REACTION_NOT_CONFIRMED",

    establishedNow
      ? "ENGINE3_V5_SIGNAL_ESTABLISHED_NOW"
      : null,

    reversedNow
      ? "ENGINE3_V5_SIGNAL_REVERSED_NOW"
      : null,

    heldNow
      ? "ENGINE3_V5_SIGNAL_HELD"
      : null,

    resetNow
      ? "ENGINE3_V5_SIGNAL_RESET"
      : null,

    `ENGINE3_V5_CANONICAL_DIRECTION_${canonicalDirection}`,

    `ENGINE3_V5_LOCAL_CONTROL_${localControlState}`,

    "ENGINE3_V5_LOCAL_CONTROL_CANNOT_WITHDRAW_HELD_CANONICAL_SIGNAL",
    "ENGINE3_V5_TIMEFRAME_LABELS_HAVE_NO_DIRECTION_AUTHORITY",

    "ENGINE4_PARTICIPATION_REQUIRED",
    "ENGINE6_FINAL_PAPER_PERMISSION_REQUIRED",

    "NO_PERMISSION_CREATED",
    "NO_EXECUTION",
  ]);

  return {
    active:
      v5Usable &&
      identityComplete,

    engine: ENGINE,
    source: SOURCE,
    version: "engine3.v5",

    mode: "PAPER_ONLY",

    /*
     * Canonical Engine 3 signal.
     */
    direction:
      canonicalDirection,

    quality:
      canonicalQuality,

    state:
      authorizedReactionState,

    reactionState:
      authorizedReactionState,

    authorizedReactionState,

    reactionConfirmed,
    confirmed:
      reactionConfirmed,

    /*
     * Engine 4 gate.
     *
     * Existing Engine 4 already understands this explicit field.
     */
    participationEvaluationEligible,

    /*
     * Compatibility field.
     *
     * Existing Engine 6 code still reads .allowed as part of its legacy /
     * transitional Strategy 1 qualification path.
     *
     * This is NOT final Engine 6 trade permission.
     */
    allowed:
      reactionConfirmed,

    /*
     * Explicit v5 qualification publication.
     */
    engine3Strategy1QualifiedForEngine6:
      reactionConfirmed,

    qualificationExplicitlyPublished:
      true,

    /*
     * Engine 26 authorization.
     */
    authorized:
      engine26Authorized,

    evaluationAuthorized:
      engine26Authorized,

    authorizeEngine3Evaluation:
      engine26Authorized,

    /*
     * Strategy identity.
     */
    symbol,
    laneId,
    strategyId,
    candidateId,
    zoneId,

    setupClass:
      canonicalEnvelope?.setupClass ??
      engine26ReactionHandoff?.setupClass ??
      engine26LocationCandidate?.setupClass ??
      null,

    setupGrade:
      engine26ReactionHandoff?.setupGrade ??
      engine26LocationCandidate?.setupGrade ??
      null,

    identitySetupKey:
      engine26ReactionHandoff?.identitySetupKey ??
      engine26LocationCandidate?.identitySetupKey ??
      null,

    candidateIdentityVersion:
      canonicalEnvelope?.candidateIdentityVersion ??
      engine26ReactionHandoff?.candidateIdentityVersion ??
      engine26LocationCandidate?.candidateIdentityVersion ??
      null,

    snapshotTime:
      canonicalEnvelope?.snapshotTime ??
      engine26ReactionHandoff?.snapshotTime ??
      engine26LocationCandidate?.snapshotTime ??
      null,

    /*
     * Zone identity / compatibility.
     */
    zone,
    entryZone:
      zone,
    negotiatedZone:
      zone,

    /*
     * Signal lifecycle diagnostics.
     */
    canonicalMode:
      canonical?.mode ??
      stateMachine?.mode ??
      null,

    canonicalSource:
      canonical?.canonicalSource ??
      stateMachine?.canonicalSource ??
      null,

    stateTransition,
    establishedNow,
    reversedNow,
    heldNow,
    resetNow,

    stableCanonicalSignal,

    /*
     * Local control is diagnostic only.
     */
    localControlState,

    localControlConfidence:
      priceActionControl?.controlConfidence ??
      priceActionControl?.confidence ??
      null,

    localControlQuality:
      priceActionControl?.quality ??
      null,

    /*
     * Preserve evidence objects for downstream diagnostics.
     *
     * They do NOT own canonical direction.
     */
    reactionObservation1m:
      observation1m,

    reactionValidation5m:
      validation5m,

    tenMinuteConfirmation:
      confirmation10m,

    /*
     * Existing Engine 4 candle-source compatibility contract.
     *
     * Source truth comes from the already-built 1m observation and 5m
     * validation objects. These fields are transport only; they do not
     * change Engine 3 canonical direction or held-signal behavior.
     */
    sourceTimeframe:
      observation1m?.sourceTimeframe ??
      null,

    reactionTimeframe:
      observation1m?.sourceTimeframe ??
      null,

    candleSourceFresh:
      observation1m?.stale === false &&
      (
        validation5m == null ||
        validation5m?.stale === false
      ),

    sourceAgeMs:
      observation1m?.sourceAgeMs ??
      null,

    stale:
      observation1m?.stale === true,

    staleReason:
      observation1m?.staleReason ??
      null,

    currentCandle:
      observation1m?.currentCandle ??
      null,

    lastCandle:
      observation1m?.currentCandle ??
      null,

    priorCandle:
      observation1m?.priorCandle ??
      null,

    currentCandleStatus:
      observation1m?.currentCandleStatus ??
      null,

    priorCandleStatus:
      observation1m?.priorCandleStatus ??
      null,

    candleClosed:
      observation1m?.currentCandleStatus === "COMPLETED"
        ? true
        : observation1m?.currentCandleStatus === "FORMING"
        ? false
        : null,

    priorCandleCompleted:
      observation1m?.priorCandleStatus === "COMPLETED"
        ? true
        : observation1m?.priorCandleStatus === "FORMING"
        ? false
        : null,

    supportingBarTime:
      observation1m?.supportingBarTime ??
      null,

    evaluationTimeMs:
      observation1m?.evaluationTimeMs ??
      observation1m?.observedAt ??
      null,

    currentPrice:
      toNumberOrNull(
        observation1m?.currentPrice ??
        engine26LocationCandidate?.currentPrice
      ),

    /*
     * Engine 26 context is transported for identity/contact diagnostics only.
     */
    contactState:
      engine26ReactionHandoff?.contactState ??
      engine26LocationCandidate?.contactState ??
      null,

    chainArmed:
      engine26ReactionHandoff?.chainArmed === true ||
      engine26LocationCandidate?.chainArmed === true,

    armed:
      engine26ReactionHandoff?.armed === true ||
      engine26LocationCandidate?.armed === true,

    directionState:
      engine26ReactionHandoff?.directionState ??
      engine26LocationCandidate?.directionState ??
      null,

    /*
     * Safety.
     */
    requiresEngine6PaperApproval:
      true,

    noPermissionCreated:
      true,

    noRealPermissionCreated:
      true,

    noExecution:
      true,

    realExecutionAuthority:
      false,

    executable:
      false,

    blockers,
    reasonCodes,
  };
}

export default buildEngine3Strategy1Handoff;
