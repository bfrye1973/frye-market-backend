// services/core/logic/engine22/wave/lifecycle/core/resolveCurrentLifecycleState.js
// Engine 22 lifecycle current-state resolver
//
// Purpose:
// Choose the single current Engine 22 lifecycle state from already-built waveFibState.
//
// Safety contract:
// - Read-only.
// - No broker logic.
// - No execution.
// - No Engine 6 permission changes.
// - Paper-trade candidate context only.
//
// Engine 22 Learning / Wave Mark Maturity addition:
// - currentLifecycleState must respect waveFibState.markMaturity.
// - If W2 is only CANDIDATE, do NOT call it W2 complete / W3 launch.
// - Sideways B-wave chop, quick-pop trap, and final C-down risk keep W2 in maturity watch.
// - C-low sweep / violent reclaim can upgrade to C-low reaction watch, but still no chase.

function readDegreeLifecycle(waveFibState, degree) {
  return waveFibState?.lifecycle?.degreeLifecycle?.[degree] || null;
}

function readDegreeState(waveFibState, degree) {
  return waveFibState?.degrees?.[degree] || null;
}

function normalizeDegreeKey(degree) {
  return String(degree || "").trim().toLowerCase();
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function getActiveDegreeKeys(waveFibState = null) {
  if (!waveFibState || typeof waveFibState !== "object") return null;

  if (!Array.isArray(waveFibState.activeDegreeKeys)) return null;

  return waveFibState.activeDegreeKeys
    .map((key) => normalizeDegreeKey(key))
    .filter(Boolean);
}

function isActiveDegree(waveFibState = null, degree = "") {
  const keys = getActiveDegreeKeys(waveFibState);

  // Backward-compatible fallback:
  // if no active JSON metadata exists, legacy behavior is allowed.
  if (!keys) return true;

  return keys.includes(normalizeDegreeKey(degree));
}

function readCurrentMarkMaturity(waveFibState = null) {
  return waveFibState?.markMaturity?.current || null;
}

function getReasonCodes(markMaturity = null) {
  return Array.isArray(markMaturity?.reasonCodes)
    ? markMaturity.reasonCodes.map((code) => upper(code)).filter(Boolean)
    : [];
}

function getBasisCodes(markMaturity = null) {
  return Array.isArray(markMaturity?.basis)
    ? markMaturity.basis.map((code) => upper(code)).filter(Boolean)
    : [];
}

function hasCode(markMaturity = null, code = "") {
  const wanted = upper(code);
  if (!wanted) return false;

  return (
    getReasonCodes(markMaturity).includes(wanted) ||
    getBasisCodes(markMaturity).includes(wanted)
  );
}

function isIntermediateW2Candidate(markMaturity = null) {
  return (
    upper(markMaturity?.degree) === "INTERMEDIATE" &&
    upper(markMaturity?.wave) === "W2" &&
    upper(markMaturity?.status) === "CANDIDATE"
  );
}

function hasFinalCDownRisk(markMaturity = null) {
  return (
    hasCode(markMaturity, "W2_STILL_FORMING") ||
    hasCode(markMaturity, "FINAL_C_DOWN_SWEEP_RISK_BELOW_PRIOR_W2_CANDIDATE") ||
    hasCode(markMaturity, "POSSIBLE_B_WAVE_LIQUIDITY_RALLY_AFTER_W2_CANDIDATE") ||
    hasCode(markMaturity, "B_WAVE_SIDEWAYS_CONSOLIDATION") ||
    hasCode(markMaturity, "B_WAVE_EMA10_CHOP_NOT_W3_LAUNCH") ||
    hasCode(markMaturity, "B_WAVE_QUICK_POP_LIQUIDITY_TRAP")
  );
}

function hasCLowReactionEvidence(markMaturity = null) {
  return (
    hasCode(markMaturity, "C_DOWN_LIQUIDITY_SWEEP_DETECTED") ||
    hasCode(markMaturity, "VIOLENT_RECLAIM_FROM_C_LOW") ||
    hasCode(markMaturity, "POSSIBLE_W2_C_LOW_REACTION") ||
    hasCode(markMaturity, "WAIT_FOR_RECLAIM_HOLD_OR_CONTROLLED_PULLBACK")
  );
}

function buildMarkMaturitySummary(markMaturity = null) {
  if (!markMaturity || typeof markMaturity !== "object") return null;

  return {
    symbol: markMaturity.symbol || null,
    degree: markMaturity.degree || null,
    wave: markMaturity.wave || null,
    price: markMaturity.price ?? null,
    time: markMaturity.time || null,

    status: markMaturity.status || null,
    confidence: markMaturity.confidence || null,
    score: markMaturity.score ?? null,

    basis: Array.isArray(markMaturity.basis) ? markMaturity.basis : [],

    supersededPreviousMark: markMaturity.supersededPreviousMark === true,
    previousMark: markMaturity.previousMark || null,

    confirmationRequired: markMaturity.confirmationRequired !== false,
    noExecution: true,
    noPermissionCreated: true,
    noChase: true,

    reasonCodes: Array.isArray(markMaturity.reasonCodes)
      ? markMaturity.reasonCodes
      : [],
  };
}

function readEngine25ZoneContext(waveFibState = null) {
  const engine25 = waveFibState?.engine25Context || null;

  const zoneState =
    engine25?.esPermission?.zoneState ||
    engine25?.zoneAwareRead?.zoneState ||
    null;

  const nearestZone =
    engine25?.esPermission?.nearestZone ||
    engine25?.zoneAwareRead?.nearestZone ||
    null;

  const activeShelf =
    waveFibState?.context?.active?.shelf ||
    waveFibState?.zoneContext?.active?.shelf ||
    waveFibState?.zones?.active?.shelf ||
    null;

  return {
    engine25,
    zoneState,
    nearestZone,
    activeShelf,
  };
}

function buildZoneReferenceFromEngine25(waveFibState = null) {
  const { zoneState, nearestZone, activeShelf } =
    readEngine25ZoneContext(waveFibState);

  const institutional = nearestZone?.institutional || null;
  const negotiated = nearestZone?.negotiated || null;

  const zones = {
    state: zoneState?.state || null,
    tone: zoneState?.tone || null,
    permission: zoneState?.permission || null,

    insideInstitutional: zoneState?.insideInstitutional === true,
    insideNegotiated: zoneState?.insideNegotiated === true,
    aboveNegotiated: zoneState?.aboveNegotiated === true,
    aboveInstitutional: zoneState?.aboveInstitutional === true,

    reclaimNegotiated: zoneState?.reclaimNegotiated ?? null,
    reclaimInstitutional: zoneState?.reclaimInstitutional ?? null,
    failureInstitutional: zoneState?.failureInstitutional ?? null,
    lowerShelf: zoneState?.lowerShelf ?? null,

    institutional: institutional
      ? {
          lo: institutional.lo ?? null,
          hi: institutional.hi ?? null,
          mid: institutional.mid ?? null,
          raw: institutional.raw || null,
          active: zoneState?.insideInstitutional === true,
        }
      : null,

    negotiated: negotiated
      ? {
          lo: negotiated.lo ?? null,
          hi: negotiated.hi ?? null,
          mid: negotiated.mid ?? null,
          raw: negotiated.raw || null,
          active:
            zoneState?.insideNegotiated === true ||
            zoneState?.aboveNegotiated === true,
        }
      : null,

    shelf: activeShelf
      ? {
          lo: activeShelf.lo ?? null,
          hi: activeShelf.hi ?? null,
          mid: activeShelf.mid ?? null,
          type: activeShelf.type || null,
          strength: activeShelf.strength ?? null,
          active: activeShelf.active === true,
          source: activeShelf.source || null,
        }
      : null,

    engine3Reaction: zoneState?.engine3Reaction || null,
    engine4VolumeContext: zoneState?.engine4VolumeContext || null,

    reasonCodes: Array.isArray(zoneState?.reasonCodes)
      ? zoneState.reasonCodes
      : [],
  };

  const hasZone =
    zones.insideInstitutional ||
    zones.insideNegotiated ||
    zones.aboveNegotiated ||
    Boolean(zones.institutional) ||
    Boolean(zones.negotiated) ||
    Boolean(zones.shelf);

  return hasZone ? zones : null;
}

function isMajorInstitutionalWatchZoneActive(waveFibState = null) {
  const zones = buildZoneReferenceFromEngine25(waveFibState);

  if (!zones) return false;

  return (
    zones.insideInstitutional === true ||
    zones.insideNegotiated === true ||
    zones.aboveNegotiated === true ||
    Boolean(zones.shelf?.active)
  );
}

function isNegotiatedValueReclaimAttempt(waveFibState = null) {
  const zones = buildZoneReferenceFromEngine25(waveFibState);
  const currentPrice = Number(waveFibState?.currentPrice);

  if (!zones || !Number.isFinite(currentPrice)) return false;

  const reclaimNegotiated = Number(zones.reclaimNegotiated);
  const reclaimInstitutional = Number(zones.reclaimInstitutional);

  const reclaimedNegotiated =
    Number.isFinite(reclaimNegotiated) && currentPrice >= reclaimNegotiated;

  const nearInstitutionalReclaim =
    Number.isFinite(reclaimInstitutional) &&
    Math.abs(currentPrice - reclaimInstitutional) <= 10;

  return (
    zones.insideInstitutional === true &&
    (zones.aboveNegotiated === true ||
      reclaimedNegotiated ||
      nearInstitutionalReclaim)
  );
}

function isCLowIgnitionWatch(waveFibState = null, markMaturity = null) {
  const zones = buildZoneReferenceFromEngine25(waveFibState);
  const currentPrice = Number(waveFibState?.currentPrice);

  if (!zones || !Number.isFinite(currentPrice)) return false;

  const failureInstitutional = Number(zones.failureInstitutional);
  const reclaimNegotiated = Number(zones.reclaimNegotiated);

  const safelyAboveFailure =
    Number.isFinite(failureInstitutional)
      ? currentPrice > failureInstitutional
      : true;

  const closeToNegotiatedReclaim =
    Number.isFinite(reclaimNegotiated)
      ? currentPrice >= reclaimNegotiated - 20
      : true;

  const engine3Reaction = zones?.engine3Reaction || null;

  const engine3State = String(
    engine3Reaction?.state ||
      engine3Reaction?.reactionState ||
      ""
  ).toUpperCase();

  const engine3Bias = String(engine3Reaction?.bias || "").toUpperCase();
  const engine3Quality = String(engine3Reaction?.quality || "").toUpperCase();
  const engine3Score = Number(engine3Reaction?.qualityScore);

  const engine3AcceptingValue =
    engine3State.includes("ACCEPTING_VALUE") ||
    engine3State.includes("RECLAIM") ||
    engine3State.includes("DEFENSE") ||
    engine3Bias.includes("BULLISH") ||
    engine3Quality === "GOOD" ||
    engine3Quality === "FAIR" ||
    (Number.isFinite(engine3Score) && engine3Score >= 70);

  const cLowEvidence =
    hasCLowReactionEvidence(markMaturity) ||
    hasCode(markMaturity, "C_DOWN_LIQUIDITY_SWEEP_DETECTED") ||
    hasCode(markMaturity, "VIOLENT_RECLAIM_FROM_C_LOW") ||
    hasCode(markMaturity, "POSSIBLE_W2_C_LOW_REACTION");

  const insideManualValue =
    zones.insideInstitutional === true ||
    zones.insideNegotiated === true;

  const zonePermission = String(zones.permission || "").toUpperCase();
  const zoneState = String(zones.state || "").toUpperCase();

  const reclaimWatchContext =
    zonePermission.includes("RECLAIM") ||
    zoneState.includes("RECLAIM") ||
    zoneState.includes("ACCUMULATION") ||
    zoneState.includes("WATCH");

  const notBroken =
    safelyAboveFailure &&
    zones.belowInstitutional !== true &&
    zoneState !== "INSTITUTIONAL_SUPPORT_BROKEN";

  return (
    cLowEvidence &&
    insideManualValue &&
    closeToNegotiatedReclaim &&
    engine3AcceptingValue &&
    reclaimWatchContext &&
    notBroken
  );
}

function getHighAlertZoneReasonCodes(waveFibState = null) {
  const zones = buildZoneReferenceFromEngine25(waveFibState);

  if (!zones) return [];

  const codes = ["MAJOR_WATCH_ZONE_ACTIVE"];

  if (zones.insideInstitutional) {
    codes.push("PRICE_INSIDE_MANUAL_INSTITUTIONAL_ZONE");
  }

  if (zones.insideNegotiated) {
    codes.push("PRICE_INSIDE_NEGOTIATED_VALUE");
  }

  if (zones.aboveNegotiated) {
    codes.push("NEGOTIATED_VALUE_RECLAIM_ATTEMPT");
  }

  if (zones.shelf?.active) {
    codes.push("PRICE_INSIDE_AUTO_ACCUMULATION_SHELF");
  }

  if (isNegotiatedValueReclaimAttempt(waveFibState)) {
    codes.push("HIGH_ALERT_NEGOTIATED_VALUE_RECLAIM_WATCH");
  }

  return codes;
}

function buildConfirmationContext({
  waveFibState,
  key,
  mode = "CONTROLLED_PULLBACK_OR_RECLAIM",
  direction = "LONG",
  extraReasonCodes = [],
} = {}) {
  return {
    active: true,
    mode,
    direction,

    reactionRequired: true,
    reactionFocus: mode,

    participationRequired: true,
    participationFocus: "VOLUME_ON_RECLAIM",

    reference: {
      currentPrice: waveFibState?.currentPrice ?? null,
      triggerLevels: {
        reclaimNegotiated:
          buildZoneReferenceFromEngine25(waveFibState)?.reclaimNegotiated ??
          null,
        reclaimInstitutional:
          buildZoneReferenceFromEngine25(waveFibState)?.reclaimInstitutional ??
          null,
        failureInstitutional:
          buildZoneReferenceFromEngine25(waveFibState)?.failureInstitutional ??
          null,
      },
      zones: buildZoneReferenceFromEngine25(waveFibState),
      priceProgress: {
        intermediate:
          waveFibState?.degrees?.intermediate?.extensionProgress || null,
        minor: waveFibState?.degrees?.minor?.extensionProgress || null,
        minute: waveFibState?.degrees?.minute?.extensionProgress || null,
      },
      emaContext: waveFibState?.emaContext || null,
    },

    noExecution: true,
    noPermissionCreated: true,
    noChase: true,

    reasonCodes: [
      "ENGINE22_CONFIRMATION_CONTEXT",
      key,
      mode,
      "LONG_BIAS",
      "REACTION_REQUIRED",
      "PARTICIPATION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
      "NO_CHASE",
      ...extraReasonCodes,
    ].filter(Boolean),
  };
}

function buildCommonDegreeSnapshot({ intermediate, minor, minute } = {}) {
  return {
    intermediate: {
      phase: intermediate?.phase || null,
      confirmedPhase: intermediate?.confirmedPhase || null,
      targets: intermediate?.fibProjection?.levels || null,
      extensionProgress: intermediate?.extensionProgress || null,
    },

    minor: {
      phase: minor?.phase || null,
      confirmedPhase: minor?.confirmedPhase || null,
      targets: minor?.fibProjection?.levels || null,
      extensionProgress: minor?.extensionProgress || null,
      inactiveDegree: minor?.inactiveDegree === true,
    },

    minute: {
      phase: minute?.phase || null,
      confirmedPhase: minute?.confirmedPhase || null,
      targets: minute?.fibProjection?.levels || null,
      extensionProgress: minute?.extensionProgress || null,
      inactiveDegree: minute?.inactiveDegree === true,
    },
  };
}

function buildIntermediateW2StillFormingState({
  waveFibState,
  markMaturity,
  intermediate,
  minor,
  minute,
} = {}) {
  const cLowReaction = hasCLowReactionEvidence(markMaturity);
  const majorWatchZoneActive = isMajorInstitutionalWatchZoneActive(waveFibState);
  const negotiatedReclaimAttempt =
    isNegotiatedValueReclaimAttempt(waveFibState);

  const cLowIgnitionWatch = isCLowIgnitionWatch(
    waveFibState,
    markMaturity
  );

  const highAlertWatch =
    cLowReaction &&
    majorWatchZoneActive &&
    (negotiatedReclaimAttempt || cLowIgnitionWatch);

  const key = highAlertWatch
    ? cLowIgnitionWatch && !negotiatedReclaimAttempt
      ? "INTERMEDIATE_W2_C_LOW_REACTION_HIGH_ALERT_POSSIBLE_W3_IGNITION_WATCH"
      : "INTERMEDIATE_W2_C_LOW_REACTION_HIGH_ALERT_NEGOTIATED_RECLAIM_WATCH"
    : cLowReaction
    ? "INTERMEDIATE_W2_C_LOW_REACTION_DETECTED_RECLAIM_WATCH"
    : "INTERMEDIATE_W1_COMPLETE_W2_STILL_FORMING_FINAL_C_DOWN_WATCH";

  const headline = highAlertWatch
    ? cLowIgnitionWatch && !negotiatedReclaimAttempt
      ? "INTERMEDIATE W2 C-LOW REACTION — HIGH ALERT POSSIBLE W3 IGNITION WATCH"
      : "INTERMEDIATE W2 C-LOW REACTION — HIGH ALERT NEGOTIATED VALUE RECLAIM WATCH"
    : cLowReaction
    ? "INTERMEDIATE W2 C-LOW REACTION DETECTED — WATCH RECLAIM / CONTROLLED PULLBACK"
    : "INTERMEDIATE W1 COMPLETE — W2 STILL FORMING / FINAL C-DOWN WATCH";

  const action = cLowReaction
    ? "WAIT_FOR_RECLAIM_HOLD_OR_CONTROLLED_PULLBACK_CONFIRMATION"
    : "WAIT_FOR_C_LOW_REACTION_OR_RECLAIM";

  const mode = cLowReaction
    ? "C_LOW_REACTION_RECLAIM_OR_CONTROLLED_PULLBACK"
    : "FINAL_C_DOWN_C_LOW_REACTION_OR_RECLAIM";

  const maturitySummary = buildMarkMaturitySummary(markMaturity);

  const extraReasonCodes = [
    ...(Array.isArray(maturitySummary?.reasonCodes)
      ? maturitySummary.reasonCodes
      : []),
    cLowReaction
      ? "C_LOW_REACTION_DETECTED_CONFIRMATION_REQUIRED"
      : "W2_STILL_FORMING_FINAL_C_DOWN_WATCH",
    "MARK_MATURITY_PREVENTED_W3_LAUNCH_PROMOTION",
    highAlertWatch ? "HIGH_ALERT_WATCH" : null,
    cLowIgnitionWatch ? "C_LOW_TARGET_BOX_REACTION" : null,
    cLowIgnitionWatch ? "FAST_RECLAIM_FROM_W2_C_LOW" : null,
    cLowIgnitionWatch ? "POSSIBLE_W3_IGNITION_BEHAVIOR" : null,
    cLowIgnitionWatch && !negotiatedReclaimAttempt
      ? "STILL_NEEDS_NEGOTIATED_RECLAIM"
      : null,
    ...getHighAlertZoneReasonCodes(waveFibState),
  ];

  return {
    key,
    headline,
    sourcePath: "waveFibState.markMaturity.current",
    priority: 0,

    degree: "intermediate",
    wave: "W2",
    tacticalDegree: "minor/minute",
    tacticalWave: "NOT_YET_FORMED",

    action,
    direction: "LONG",
    bias: cLowReaction
      ? "BULLISH_W2_C_LOW_REACTION_WATCH"
      : "BULLISH_W2_MATURITY_WATCH",

    active: false,
    readOnly: true,

    readiness: "WATCH",
    alertLevel: highAlertWatch ? "HIGH_ALERT_WATCH" : "WATCH",

    noExecution: true,
    executionBlocked: true,

    confirmationRequired: true,
    paperTradeCandidate: true,
    paperTradeAllowedOnlyAfterConfirmation: true,

    tradeableOpportunityBlocked: false,
    setupEligible: false,
    executionBias: "LONG",

    activeDegreeKeys: waveFibState?.activeDegreeKeys || null,
    markMaturity: maturitySummary,
    zoneContext: buildZoneReferenceFromEngine25(waveFibState),

    confirmationContext: buildConfirmationContext({
      waveFibState,
      key,
      mode,
      direction: "LONG",
      extraReasonCodes,
    }),

    ...buildCommonDegreeSnapshot({
      intermediate,
      minor,
      minute,
    }),

    needs: cLowReaction
      ? [
          "NO_CHASE",
          "DO_NOT_CHASE_VERTICAL_RECLAIM",
          "WAIT_FOR_RECLAIM_HOLD_OR_CONTROLLED_PULLBACK",
          "ENGINE3_REACTION_CONFIRMATION",
          "ENGINE4_PARTICIPATION_CONFIRMATION",
          "ENGINE15_READY_REQUIRED",
          "ENGINE6_FINAL_PERMISSION_REQUIRED",
        ]
      : [
          "NO_CHASE",
          "WAIT_FOR_C_LOW_REACTION_OR_RECLAIM",
          "W2_STILL_FORMING",
          "B_WAVE_SIDEWAYS_ACTION_NOT_W3",
          "FINAL_C_DOWN_MAY_STILL_BE_ACTIVE",
          "ENGINE3_REACTION_CONFIRMATION",
          "ENGINE4_PARTICIPATION_CONFIRMATION",
          "ENGINE15_READY_REQUIRED",
          "ENGINE6_FINAL_PERMISSION_REQUIRED",
        ],

    reasonCodes: [
      "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
      "ACTIVE_WAVE_STATE_DEGREES_ENFORCED",
      "INTERMEDIATE_ACTIVE",
      "MINOR_INACTIVE_NOT_IN_ACTIVE_WAVE_STATE",
      "MINUTE_INACTIVE_NOT_IN_ACTIVE_WAVE_STATE",
      "INTERMEDIATE_W2_CANDIDATE",
      cLowReaction
        ? "INTERMEDIATE_W2_C_LOW_REACTION_DETECTED"
        : "INTERMEDIATE_W2_STILL_FORMING",
      hasFinalCDownRisk(markMaturity)
        ? "B_WAVE_OR_FINAL_C_DOWN_RISK_PRESENT"
        : null,
      "MARK_MATURITY_PREVENTED_W3_LAUNCH_PROMOTION",
      "PAPER_TRADE_CANDIDATE_ONLY",
      "NO_EXECUTION",
      "NO_CHASE",
      ...(Array.isArray(maturitySummary?.reasonCodes)
        ? maturitySummary.reasonCodes
        : []),
    ].filter(Boolean),
  };
}

export function resolveCurrentLifecycleState({ waveFibState } = {}) {
  const intermediateLifecycle = readDegreeLifecycle(
    waveFibState,
    "intermediate"
  );
  const minorLifecycle = readDegreeLifecycle(waveFibState, "minor");
  const minuteLifecycle = readDegreeLifecycle(waveFibState, "minute");

  const intermediate = readDegreeState(waveFibState, "intermediate");
  const minor = readDegreeState(waveFibState, "minor");
  const minute = readDegreeState(waveFibState, "minute");

  const onlyIntermediateActive =
    isActiveDegree(waveFibState, "intermediate") &&
    !isActiveDegree(waveFibState, "minor") &&
    !isActiveDegree(waveFibState, "minute");

  const markMaturity = readCurrentMarkMaturity(waveFibState);

  if (
    onlyIntermediateActive &&
    intermediateLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE" &&
    isIntermediateW2Candidate(markMaturity)
  ) {
    return buildIntermediateW2StillFormingState({
      waveFibState,
      markMaturity,
      intermediate,
      minor,
      minute,
    });
  }

  if (
    onlyIntermediateActive &&
    intermediateLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE"
  ) {
    const key = "INTERMEDIATE_W2_COMPLETE_W3_LAUNCH_WATCH";

    return {
      key,
      headline:
        "INTERMEDIATE W2 COMPLETE — WATCH W3 LAUNCH / RECLAIM CONFIRMATION",
      sourcePath: "waveFibState.lifecycle.degreeLifecycle",
      priority: 1,

      degree: "intermediate",
      wave: "W3",
      tacticalDegree: "minor/minute",
      tacticalWave: "NOT_YET_FORMED",

      action: "WAIT_FOR_W3_LAUNCH_RECLAIM_OR_CONTROLLED_PULLBACK_CONFIRMATION",
      direction: "LONG",
      bias: "BULLISH_W3_LAUNCH_WATCH",

      active: false,
      readOnly: true,

      readiness: "WATCH",

      noExecution: true,
      executionBlocked: true,

      confirmationRequired: true,
      paperTradeCandidate: true,
      paperTradeAllowedOnlyAfterConfirmation: true,

      tradeableOpportunityBlocked: false,
      setupEligible: false,
      executionBias: "LONG",

      activeDegreeKeys: waveFibState?.activeDegreeKeys || null,
      markMaturity: buildMarkMaturitySummary(markMaturity),

      confirmationContext: buildConfirmationContext({
        waveFibState,
        key,
        mode: "CONTROLLED_PULLBACK_OR_RECLAIM",
        direction: "LONG",
        extraReasonCodes: Array.isArray(markMaturity?.reasonCodes)
          ? markMaturity.reasonCodes
          : [],
      }),

      ...buildCommonDegreeSnapshot({
        intermediate,
        minor,
        minute,
      }),

      needs: [
        "NO_CHASE",
        "WAIT_FOR_W3_LAUNCH_RECLAIM_OR_CONTROLLED_PULLBACK",
        "MINOR_STRUCTURE_NOT_YET_FORMED",
        "MINUTE_STRUCTURE_NOT_YET_FORMED",
        "ENGINE3_REACTION_CONFIRMATION",
        "ENGINE4_PARTICIPATION_CONFIRMATION",
        "ENGINE15_READY_REQUIRED",
        "ENGINE6_FINAL_PERMISSION_REQUIRED",
      ],

      reasonCodes: [
        "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
        "ACTIVE_WAVE_STATE_DEGREES_ENFORCED",
        "INTERMEDIATE_ACTIVE",
        "MINOR_INACTIVE_NOT_IN_ACTIVE_WAVE_STATE",
        "MINUTE_INACTIVE_NOT_IN_ACTIVE_WAVE_STATE",
        "INTERMEDIATE_W2_MARKED",
        "WATCH_W3_LAUNCH_CONFIRMATION",
        "PAPER_TRADE_CANDIDATE_ONLY",
        "NO_EXECUTION",
        "NO_CHASE",
      ],
    };
  }

  const allNestedW3 =
    intermediateLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE" &&
    minorLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE" &&
    minuteLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE";

  if (!allNestedW3) {
    return null;
  }

  const key = "INTERMEDIATE_W3_MINOR_MINUTE_W3_CONTINUATION_WATCH";
  const nestedMarkMaturity = buildMarkMaturitySummary(markMaturity);

  return {
    key,
    headline:
      "INTERMEDIATE W3 ACTIVE — MINOR / MINUTE W3 CONTINUATION WATCH",
    sourcePath: "waveFibState.lifecycle.degreeLifecycle",
    priority: 1,

    degree: "intermediate",
    wave: "W3",
    tacticalDegree: "minor/minute",
    tacticalWave: "W3",

    action: "WAIT_FOR_CONTROLLED_PULLBACK_OR_RECLAIM_CONFIRMATION",
    direction: "LONG",
    bias: "BULLISH_CONTINUATION",

    active: false,
    readOnly: true,
    noExecution: true,
    tradeableOpportunityBlocked: true,

    paperTradeCandidate: true,
    paperTradeAllowedOnlyAfterConfirmation: true,

    markMaturity: nestedMarkMaturity,

    confirmationContext: buildConfirmationContext({
      waveFibState,
      key,
      mode: "CONTROLLED_PULLBACK_OR_RECLAIM",
      direction: "LONG",
      extraReasonCodes: Array.isArray(nestedMarkMaturity?.reasonCodes)
        ? nestedMarkMaturity.reasonCodes
        : [],
    }),

    ...buildCommonDegreeSnapshot({
      intermediate,
      minor,
      minute,
    }),

    needs: [
      "NO_CHASE",
      "WAIT_FOR_CONTROLLED_PULLBACK_OR_RECLAIM",
      "ENGINE3_REACTION_CONFIRMATION",
      "ENGINE4_PARTICIPATION_CONFIRMATION",
      "ENGINE15_READY_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ],

    reasonCodes: [
      "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
      "INTERMEDIATE_W3_ACTIVE",
      "MINOR_W3_ACTIVE",
      "MINUTE_W3_ACTIVE",
      "BULLISH_CONTINUATION_CONTEXT",
      "PAPER_TRADE_CANDIDATE_ONLY",
      "NO_EXECUTION",
      "NO_CHASE",
    ],
  };
}

export default resolveCurrentLifecycleState;
