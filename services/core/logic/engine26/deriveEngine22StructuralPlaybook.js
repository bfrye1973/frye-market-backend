// services/core/logic/engine26/deriveEngine22StructuralPlaybook.js
//
// Engine 26 Structural Playbook v1
//
// Purpose:
// Engine 22 tells the structural story first.
// Engine 26 reads that story, then classifies the active manual imbalance
// by its role inside the wave/correction structure.
//
// This module does NOT create permission.
// This module does NOT execute.
// This module does NOT call Engine 8.
// This module does NOT override Engine 6.
// It only returns a structural playbook for Engine 26 to display/use.

const ENGINE = "engine26.engine22StructuralPlaybook.v1";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  const n = toNum(value);
  return n == null ? null : Number(n.toFixed(2));
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value, needle) {
  return upper(value).includes(upper(needle));
}

function pickPreferredCorrectionModel(degreeState) {
  return (
    degreeState?.correctionModel?.preferredModel ||
    degreeState?.correctionModels?.preferredModel ||
    degreeState?.preferredModel ||
    null
  );
}

function pickAlternateTriangle(degreeState) {
  return (
    degreeState?.correctionModel?.alternateModels?.abcdeTriangle ||
    degreeState?.correctionModels?.alternateModels?.abcdeTriangle ||
    degreeState?.correctionModel?.abcdeTriangle ||
    degreeState?.correctionModels?.abcdeTriangle ||
    null
  );
}

function normalizeBand(band) {
  const low =
    toNum(band?.low) ??
    toNum(band?.lo) ??
    toNum(band?.r382) ??
    null;

  const high =
    toNum(band?.high) ??
    toNum(band?.hi) ??
    toNum(band?.r618) ??
    null;

  if (low == null || high == null) return null;

  return {
    lo: round2(Math.min(low, high)),
    hi: round2(Math.max(low, high)),
    source: band?.source || null,
  };
}

function distanceToZone(price, zone) {
  const p = toNum(price);
  const lo = toNum(zone?.lo);
  const hi = toNum(zone?.hi);

  if (p == null || lo == null || hi == null) return null;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);

  if (p >= a && p <= b) return 0;
  return p < a ? round2(a - p) : round2(p - b);
}

function priceInsideOrNear(price, zone, bufferPts = 3) {
  const d = distanceToZone(price, zone);
  return d != null && d <= bufferPts;
}

function buildWatchLevelsFromAbcModel(model) {
  const bBounceZone = model?.bBounceZone || null;
  const cProjectionZone = model?.cProjectionZone || null;

  const preferredBand =
    normalizeBand(bBounceZone?.preferredBand) ||
    normalizeBand(bBounceZone?.fibBand) ||
    null;

  const projectionFromB = cProjectionZone?.projectionFromB || null;
  const parentFibConfluence = cProjectionZone?.parentFibConfluence || null;

  return {
    aLeg: model?.aLeg
      ? {
          price: round2(model.aLeg.price),
          time: model.aLeg.time || null,
          status: model.aLeg.status || null,
          confidence: model.aLeg.confidence || null,
        }
      : null,

    bLeg: model?.bLeg
      ? {
          price: round2(model.bLeg.price),
          time: model.bLeg.time || null,
          status: model.bLeg.status || null,
          confidence: model.bLeg.confidence || null,
        }
      : null,

    cLeg: model?.cLeg
      ? {
          price: round2(model.cLeg.price),
          time: model.cLeg.time || null,
          status: model.cLeg.status || null,
          confidence: model.cLeg.confidence || null,
        }
      : null,

    bBounceBand: preferredBand,

    bBounceFibBand: bBounceZone?.fibBand
      ? {
          r382: round2(bBounceZone.fibBand.r382),
          r500: round2(bBounceZone.fibBand.r500),
          r618: round2(bBounceZone.fibBand.r618),
        }
      : null,

    manualB: bBounceZone?.manualB
      ? {
          price: round2(bBounceZone.manualB.price),
          time: bBounceZone.manualB.time || null,
          status: bBounceZone.manualB.status || null,
          confidence: bBounceZone.manualB.confidence || null,
          maturity: bBounceZone.manualB.maturity || null,
          confirmed: bBounceZone.manualB.confirmed === true,
        }
      : null,

    parentFibConfluence: parentFibConfluence
      ? {
          r382: round2(parentFibConfluence.r382),
          r500: round2(parentFibConfluence.r500),
          r618: round2(parentFibConfluence.r618),
        }
      : null,

    cProjection: projectionFromB
      ? {
          bHigh: round2(projectionFromB.bHigh),
          aLength: round2(projectionFromB.aLength),
          c100: round2(projectionFromB.c100),
          c1272: round2(projectionFromB.c1272),
          c1618: round2(projectionFromB.c1618),
        }
      : null,

    fibAnchors: model?.fibAnchors
      ? {
          impulseStart: round2(model.fibAnchors.impulseStart),
          impulseHigh: round2(model.fibAnchors.impulseHigh),
          range: round2(model.fibAnchors.range),
          valid: model.fibAnchors.valid === true,
          retracementSource: model.fibAnchors.retracementSource || null,
        }
      : null,
  };
}

function buildNoStructurePlaybook({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  reason,
}) {
  return {
    active: false,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "NO_ENGINE22_STRUCTURAL_PLAYBOOK",
    activeImbalanceRole: "NEUTRAL_MANUAL_IMBALANCE",
    primaryScenario: "WAIT_FOR_ENGINE22_STRUCTURE",
    preferredAction: "WAIT_FOR_ENGINE22_STRUCTURE",

    structuralBias: "NEUTRAL",
    preferredDirection: "NONE",
    doNotChaseLong: true,
    shortResearchOnly: true,

    confirmationNeeds: [
      "ENGINE22_DEGREE_STATES_REQUIRED",
      "ENGINE3_REACTION_REQUIRED",
      "ENGINE4_PARTICIPATION_REQUIRED",
      "ENGINE15_RISK_AND_TARGET_PATH_REQUIRED",
      "ENGINE6_PAPER_PERMISSION_REQUIRED",
    ],

    watchLevels: null,
    invalidation: null,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_STRUCTURE_MISSING_OR_UNUSABLE",
      reason || "NO_ENGINE22_DEGREE_STATES",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function classifyAbcDownBMarked({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  degreeStates,
  minute,
  subminute,
  model,
}) {
  const watchLevels = buildWatchLevelsFromAbcModel(model);
  const bBounceBand = watchLevels.bBounceBand;

  const nearBBounceBand =
    activeImbalance &&
    bBounceBand &&
    (
      priceInsideOrNear(currentPrice, bBounceBand, 8) ||
      priceInsideOrNear(currentPrice, activeImbalance, 0)
    );

  const activeImbalanceRole = nearBBounceBand
    ? "B_BOUNCE_FINAL_FILL_ZONE"
    : "ABC_DOWN_STRUCTURAL_WATCH_ZONE";

  const status = nearBBounceBand
    ? "B_BOUNCE_FINAL_FILL_ZONE_C_DOWN_WATCH"
    : "ABC_DOWN_C_DOWN_WATCH";

  return {
    active: true,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "ABC_DOWN_B_BOUNCE_C_DOWN_WATCH",
    status,
    activeImbalanceRole,
    structuralBias: "C_DOWN_WATCH",
    preferredDirection: "SHORT_WATCH_ONLY",
    primaryScenario: "MINUTE_C_DOWN_TO_COMPLETE_PARENT_CORRECTION",
    preferredAction: "WATCH_FAILED_ACCEPTANCE_OR_LEVEL_LOSS",

    doNotChaseLong: true,
    shortResearchOnly: true,

    engine22Structure: {
      minor: {
        currentRead: degreeStates?.minor?.currentRead || null,
        action: degreeStates?.minor?.action || null,
      },
      minute: {
        currentRead: minute?.currentRead || null,
        action: minute?.action || null,
      },
      subminute: {
        currentRead: subminute?.currentRead || null,
        action: subminute?.action || null,
      },
      nestedCorrectionContext: minute?.nestedCorrectionContext || null,
    },

    watchLevels,

    triggerMap: {
      firstWarning: watchLevels?.bBounceFibBand?.r618 ?? watchLevels?.bBounceBand?.hi ?? null,
      bBounceMid: watchLevels?.bBounceFibBand?.r500 ?? null,
      bBounceLower: watchLevels?.bBounceFibBand?.r382 ?? watchLevels?.bBounceBand?.lo ?? null,
      parentR382: watchLevels?.parentFibConfluence?.r382 ?? null,
      parentR500: watchLevels?.parentFibConfluence?.r500 ?? null,
      parentR618: watchLevels?.parentFibConfluence?.r618 ?? null,
      c100: watchLevels?.cProjection?.c100 ?? null,
      c1272: watchLevels?.cProjection?.c1272 ?? null,
      c1618: watchLevels?.cProjection?.c1618 ?? null,
    },

    confirmationNeeds: [
      "ENGINE3_REJECTING_VALUE_OR_LOST_LEVEL_SHORT",
      "ENGINE4_SELLER_PARTICIPATION_IMPROVING",
      "ENGINE15_RISK_AND_TARGET_PATH_DEFINED",
      "ENGINE6_PAPER_PERMISSION_REQUIRED",
    ],

    invalidation: {
      invalidatesCDownWatchIf: [
        "PRICE_ACCEPTS_ABOVE_B_HIGH_OR_B_D_RESISTANCE",
        "ENGINE3_CONFIRMS_RECLAIM_OR_BULLISH_ACCEPTANCE",
        "ENGINE4_CONFIRMS_BUYER_PARTICIPATION_EXPANSION",
      ],
      bHigh: watchLevels?.manualB?.price ?? watchLevels?.cProjection?.bHigh ?? null,
    },

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_READ_FIRST",
      "TEMPLATE_ABC_DOWN_B_BOUNCE_C_DOWN_WATCH",
      activeImbalanceRole,
      "DO_NOT_CHASE_LONG",
      "SHORT_RESEARCH_ONLY",
      "ENGINE3_ENGINE4_CONFIRMATION_REQUIRED",
      "ENGINE15_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function classifyAbcUpBPullback({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  degreeStates,
  minute,
  subminute,
  model,
}) {
  const watchLevels = buildWatchLevelsFromAbcModel(model);

  return {
    active: true,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "ABC_UP_B_PULLBACK_C_UP_WATCH",
    status: "B_PULLBACK_FINAL_FILL_ZONE_C_UP_WATCH",
    activeImbalanceRole: "B_PULLBACK_FINAL_FILL_ZONE",
    structuralBias: "C_UP_WATCH",
    preferredDirection: "LONG_AFTER_RECLAIM",
    primaryScenario: "MINUTE_C_UP_TO_COMPLETE_PARENT_CORRECTION",
    preferredAction: "WATCH_SUPPORT_HOLD_OR_RECLAIM",

    doNotChaseLong: false,
    shortResearchOnly: false,

    engine22Structure: {
      minor: {
        currentRead: degreeStates?.minor?.currentRead || null,
        action: degreeStates?.minor?.action || null,
      },
      minute: {
        currentRead: minute?.currentRead || null,
        action: minute?.action || null,
      },
      subminute: {
        currentRead: subminute?.currentRead || null,
        action: subminute?.action || null,
      },
      nestedCorrectionContext: minute?.nestedCorrectionContext || null,
    },

    watchLevels,

    confirmationNeeds: [
      "ENGINE3_SUPPORT_HOLD_OR_RECLAIM_LONG",
      "ENGINE4_BUYER_PARTICIPATION_IMPROVING",
      "ENGINE15_RISK_AND_TARGET_PATH_DEFINED",
      "ENGINE6_PAPER_PERMISSION_REQUIRED",
    ],

    invalidation: {
      invalidatesCUpWatchIf: [
        "PRICE_LOSES_B_PULLBACK_SUPPORT",
        "ENGINE3_CONFIRMS_BREAKDOWN_OR_FAILED_RECLAIM",
        "ENGINE4_CONFIRMS_SELLER_PARTICIPATION_EXPANSION",
      ],
    },

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_READ_FIRST",
      "TEMPLATE_ABC_UP_B_PULLBACK_C_UP_WATCH",
      "ENGINE3_ENGINE4_CONFIRMATION_REQUIRED",
      "ENGINE15_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function classifyPostEReactionDecisionWatch({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  degreeStates,
  minor,
  minute,
  subminute,
}) {
  return {
    active: true,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "TRIANGLE_RESOLUTION_DECISION_WATCH",
    status: "POST_E_REACTION_WATCH",
    activeImbalanceRole: "POST_E_REACTION_DECISION_ZONE",
    structuralBias: "TRIANGLE_RESOLUTION_DECISION",
    preferredDirection: "NONE_WAIT_FOR_7560_RECLAIM_OR_7500_FAILURE",
    primaryScenario: "MINOR_E_COMPLETED_CANDIDATE_TRIANGLE_RESOLUTION",
    preferredAction: "WATCH_7560_SUPPORT_OR_7500_RESISTANCE",

    doNotChaseLong: true,
    shortResearchOnly: false,

    engine22Structure: {
      minor: {
        stage: minor?.stage || null,
        currentRead: minor?.currentRead || null,
        action: minor?.action || null,
      },
      minute: {
        stage: minute?.stage || null,
        currentRead: minute?.currentRead || null,
        action: minute?.action || null,
      },
      subminute: {
        stage: subminute?.stage || null,
        currentRead: subminute?.currentRead || null,
        action: subminute?.action || null,
      },
      nestedCorrectionContext: minute?.nestedCorrectionContext || null,
    },

    decisionMap: {
      active: true,
      mode: "POST_E_TRIANGLE_RESOLUTION",
      bullPath: {
        level: 7560,
        condition: "HOLD_OR_RECLAIM",
        label: "BULL_RECOVERY_WATCH",
      },
      bearPath: {
        level: 7500,
        condition: "FAIL_OR_BECOME_RESISTANCE",
        label: "BEAR_CONTINUATION_WATCH",
      },
      noDirectionAssumption: true,
      noExecution: true,
      noPermissionCreated: true,
    },

    watchLevels: {
      decisionZone: {
        lo: 7500,
        hi: 7560,
        label: "POST_E_TRIANGLE_RESOLUTION_DECISION_ZONE",
      },
      bullRecoveryLevel: 7560,
      bearControlLevel: 7500,
    },

    confirmationNeeds: [
      "ENGINE3_RECLAIM_7560_OR_FAILED_RECLAIM_7500_REQUIRED",
      "ENGINE4_DIRECTIONAL_PARTICIPATION_REQUIRED",
      "ENGINE15_RISK_AND_TARGET_PATH_AFTER_DIRECTION_CONFIRMS",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ],

    invalidation: {
      retiresOldCDownWatchBecause: [
        "MINOR_E_COMPLETED_CANDIDATE",
        "MINUTE_C_DOWN_POST_COMPLETION_REACTION",
        "SUBMINUTE_C_DOWN_RETIRED",
      ],
    },

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_READ_FIRST",
      "TEMPLATE_TRIANGLE_RESOLUTION_DECISION_WATCH",
      "OLD_C_DOWN_MAP_RETIRED",
      "MINOR_E_COMPLETED_CANDIDATE",
      "POST_E_REACTION_WATCH",
      "DIRECTION_NOT_ASSUMED",
      "WATCH_7560_SUPPORT_OR_7500_RESISTANCE",
      "ENGINE3_ENGINE4_CONFIRMATION_REQUIRED",
      "ENGINE15_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function classifyTriangleECompletion({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  degreeStates,
  minor,
  minute,
  subminute,
}) {
  const nested = minute?.nestedCorrectionContext || null;
  const parentMarks = nested?.parentTriangleMarks || null;

  return {
    active: true,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "ABCDE_TRIANGLE_E_COMPLETION_WATCH",
    status: "TRIANGLE_E_COMPLETION_WATCH",
    activeImbalanceRole: "MINOR_E_COMPLETION_SUPPORT_ZONE",
    structuralBias: "TRIANGLE_E_COMPLETION_WATCH",
    preferredDirection: "LONG_AFTER_RECLAIM_OR_WAIT_FOR_RESOLUTION",
    primaryScenario: "PARENT_TRIANGLE_E_COMPLETION_THEN_RESOLUTION",
    preferredAction: "WATCH_E_COMPLETION_REACTION_THEN_TRIANGLE_RESOLUTION",

    doNotChaseLong: true,
    shortResearchOnly: false,

    engine22Structure: {
      minor: {
        currentRead: minor?.currentRead || null,
        action: minor?.action || null,
      },
      minute: {
        currentRead: minute?.currentRead || null,
        action: minute?.action || null,
      },
      subminute: {
        currentRead: subminute?.currentRead || null,
        action: subminute?.action || null,
      },
      nestedCorrectionContext: nested,
    },

    watchLevels: {
      parentTriangleMarks: parentMarks
        ? {
            A: parentMarks.A || null,
            B: parentMarks.B || null,
            C: parentMarks.C || null,
            D: parentMarks.D || null,
            E: parentMarks.E || null,
          }
        : null,
      completionGoal: nested?.completionGoal || null,
      nextExpected: nested?.nextExpected || null,
    },

    confirmationNeeds: [
      "ENGINE3_E_COMPLETION_RECLAIM_OR_SUPPORT_HOLD",
      "ENGINE4_BUYER_PARTICIPATION_IMPROVING",
      "ENGINE15_RISK_AND_TARGET_PATH_DEFINED",
      "ENGINE6_PAPER_PERMISSION_REQUIRED",
    ],

    invalidation: {
      invalidatesECompletionWatchIf: [
        "PRICE_BREAKS_BELOW_A_C_E_SUPPORT_WITH_SELLER_EXPANSION",
        "PRICE_BREAKS_ABOVE_B_D_RESISTANCE_BEFORE_E_COMPLETES",
      ],
    },

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_READ_FIRST",
      "TEMPLATE_ABCDE_TRIANGLE_E_COMPLETION_WATCH",
      "WAIT_FOR_TRIANGLE_RESOLUTION",
      "ENGINE3_ENGINE4_CONFIRMATION_REQUIRED",
      "ENGINE15_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function classifyW3Ignition({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  degreeStates,
  minor,
  minute,
  subminute,
}) {
  return {
    active: true,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "W3_IGNITION_AFTER_W2_RECLAIM",
    status: "W3_IGNITION_AFTER_W2_RECLAIM_WATCH",
    activeImbalanceRole: "W3_RECLAIM_LAUNCH_ZONE",
    structuralBias: "BULLISH_IMPULSE_W3_WATCH",
    preferredDirection: "LONG_AFTER_RECLAIM",
    primaryScenario: "W2_COMPLETE_W3_IGNITION_WATCH",
    preferredAction: "WATCH_RECLAIM_AND_PARTICIPATION_EXPANSION",

    doNotChaseLong: true,
    shortResearchOnly: false,

    engine22Structure: {
      minor: {
        currentRead: minor?.currentRead || null,
        action: minor?.action || null,
      },
      minute: {
        currentRead: minute?.currentRead || null,
        action: minute?.action || null,
      },
      subminute: {
        currentRead: subminute?.currentRead || null,
        action: subminute?.action || null,
      },
    },

    watchLevels: {
      targetModel: minute?.targetModel || minor?.targetModel || null,
      fibProjection: minute?.fibProjection || minor?.fibProjection || null,
    },

    confirmationNeeds: [
      "ENGINE3_RECLAIM_OR_BULLISH_ACCEPTANCE",
      "ENGINE4_BUYER_PARTICIPATION_EXPANSION",
      "ENGINE15_RISK_AND_TARGET_PATH_DEFINED",
      "ENGINE6_PAPER_PERMISSION_REQUIRED",
    ],

    invalidation: {
      invalidatesW3IgnitionIf: [
        "PRICE_LOSES_W2_INVALIDATION",
        "RECLAIM_FAILS_WITH_SELLER_PARTICIPATION",
        "ENGINE25_HARD_RISK_BLOCK",
      ],
    },

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_READ_FIRST",
      "TEMPLATE_W3_IGNITION_AFTER_W2_RECLAIM",
      "NO_CHASE",
      "ENGINE3_ENGINE4_CONFIRMATION_REQUIRED",
      "ENGINE15_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function classifyW4Pullback({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  degreeStates,
  minor,
  minute,
  subminute,
}) {
  return {
    active: true,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "W4_CONTROLLED_PULLBACK_HOLD",
    status: "W4_CONTROLLED_PULLBACK_HOLD_WATCH",
    activeImbalanceRole: "W4_CONTROLLED_PULLBACK_SUPPORT_ZONE",
    structuralBias: "BULLISH_PULLBACK_WATCH",
    preferredDirection: "LONG_AFTER_SUPPORT_HOLD_OR_RECLAIM",
    primaryScenario: "W4_PULLBACK_THEN_W5_OR_CONTINUATION",
    preferredAction: "WATCH_SUPPORT_HOLD_OR_RECLAIM_NO_CHASE",

    doNotChaseLong: true,
    shortResearchOnly: false,

    engine22Structure: {
      minor: {
        currentRead: minor?.currentRead || null,
        action: minor?.action || null,
      },
      minute: {
        currentRead: minute?.currentRead || null,
        action: minute?.action || null,
      },
      subminute: {
        currentRead: subminute?.currentRead || null,
        action: subminute?.action || null,
      },
    },

    watchLevels: {
      targetModel: minute?.targetModel || minor?.targetModel || null,
      pullbackLevels:
        minute?.pullbackLevels ||
        minor?.pullbackLevels ||
        minute?.correctionModel?.preferredModel?.parentImpulseFib ||
        null,
    },

    confirmationNeeds: [
      "ENGINE3_SUPPORT_HOLD_OR_RECLAIM_LONG",
      "ENGINE4_BUYER_PARTICIPATION_IMPROVING",
      "ENGINE15_RISK_AND_TARGET_PATH_DEFINED",
      "ENGINE6_PAPER_PERMISSION_REQUIRED",
    ],

    invalidation: {
      invalidatesW4PullbackIf: [
        "PRICE_LOSES_W4_INVALIDATION",
        "SELLER_PARTICIPATION_EXPANDS_BELOW_SUPPORT",
      ],
    },

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_READ_FIRST",
      "TEMPLATE_W4_CONTROLLED_PULLBACK_HOLD",
      "NO_CHASE",
      "ENGINE3_ENGINE4_CONFIRMATION_REQUIRED",
      "ENGINE15_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function classifyW5Exhaustion({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  degreeStates,
  minor,
  minute,
  subminute,
}) {
  return {
    active: true,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "W5_EXHAUSTION_POST_W5_CORRECTION_WATCH",
    status: "W5_EXHAUSTION_POST_W5_CORRECTION_WATCH",
    activeImbalanceRole: "W5_EXHAUSTION_REJECTION_ZONE",
    structuralBias: "POST_W5_CORRECTION_WATCH",
    preferredDirection: "SHORT_WATCH_ONLY_OR_WAIT_FOR_PULLBACK",
    primaryScenario: "W5_MATURE_OR_COMPLETE_POST_W5_CORRECTION_RISK",
    preferredAction: "DO_NOT_CHASE_LONG_WATCH_REJECTION_OR_PULLBACK",

    doNotChaseLong: true,
    shortResearchOnly: true,

    engine22Structure: {
      minor: {
        currentRead: minor?.currentRead || null,
        action: minor?.action || null,
      },
      minute: {
        currentRead: minute?.currentRead || null,
        action: minute?.action || null,
      },
      subminute: {
        currentRead: subminute?.currentRead || null,
        action: subminute?.action || null,
      },
    },

    watchLevels: {
      targetModel: minute?.targetModel || minor?.targetModel || null,
      correctionModel: minute?.correctionModel || minor?.correctionModel || null,
    },

    confirmationNeeds: [
      "ENGINE3_REJECTION_OR_LOST_LEVEL",
      "ENGINE4_SELLER_PARTICIPATION_IMPROVING",
      "ENGINE15_RISK_AND_TARGET_PATH_DEFINED",
      "ENGINE6_PAPER_PERMISSION_REQUIRED",
    ],

    invalidation: {
      invalidatesPostW5CorrectionIf: [
        "PRICE_ACCEPTS_ABOVE_EXTENSION_TARGET_WITH_PARTICIPATION",
        "ENGINE3_CONFIRMS_BULLISH_ACCEPTANCE",
        "ENGINE4_CONFIRMS_BUYER_EXPANSION",
      ],
    },

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_READ_FIRST",
      "TEMPLATE_W5_EXHAUSTION_POST_W5_CORRECTION_WATCH",
      "DO_NOT_CHASE_LONG",
      "SHORT_RESEARCH_ONLY",
      "ENGINE3_ENGINE4_CONFIRMATION_REQUIRED",
      "ENGINE15_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function classifyNeutral({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  degreeStates,
  minor,
  minute,
  subminute,
}) {
  return {
    active: activeImbalance ? true : false,
    engine: ENGINE,
    source: "engine22WaveStrategy.degreeStates",
    engine22ReadFirst: true,

    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),
    activeImbalance: activeImbalance || null,

    template: "NEUTRAL_MANUAL_IMBALANCE_WATCH",
    status: activeImbalance ? "NEUTRAL_MANUAL_IMBALANCE_WATCH" : "NO_ACTIVE_STRUCTURAL_IMBALANCE",
    activeImbalanceRole: "NEUTRAL_MANUAL_IMBALANCE",
    structuralBias: "NEUTRAL",
    preferredDirection: "NONE",
    primaryScenario: "WAIT_FOR_CLEAR_ENGINE22_PLAYBOOK",
    preferredAction: "WAIT_FOR_ENGINE22_ENGINE3_ENGINE4_ALIGNMENT",

    doNotChaseLong: true,
    shortResearchOnly: true,

    engine22Structure: {
      minor: {
        currentRead: minor?.currentRead || null,
        action: minor?.action || null,
      },
      minute: {
        currentRead: minute?.currentRead || null,
        action: minute?.action || null,
      },
      subminute: {
        currentRead: subminute?.currentRead || null,
        action: subminute?.action || null,
      },
    },

    watchLevels: null,

    confirmationNeeds: [
      "ENGINE22_CLEAR_PLAYBOOK_REQUIRED",
      "ENGINE3_REACTION_REQUIRED",
      "ENGINE4_PARTICIPATION_REQUIRED",
      "ENGINE15_RISK_AND_TARGET_PATH_REQUIRED",
      "ENGINE6_PAPER_PERMISSION_REQUIRED",
    ],

    invalidation: null,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_STRUCTURAL_PLAYBOOK_BUILT",
      "ENGINE22_READ_FIRST",
      "TEMPLATE_NEUTRAL_MANUAL_IMBALANCE_WATCH",
      "DIRECTION_NOT_ASSUMED",
      "ENGINE3_ENGINE4_CONFIRMATION_REQUIRED",
      "ENGINE15_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

export function deriveEngine22StructuralPlaybook({
  symbol,
  strategyId,
  tf,
  currentPrice,
  activeImbalance,
  engine22WaveStrategy,
} = {}) {
  const degreeStates = engine22WaveStrategy?.degreeStates || null;

  if (!degreeStates || typeof degreeStates !== "object") {
    return buildNoStructurePlaybook({
      symbol,
      strategyId,
      tf,
      currentPrice,
      activeImbalance,
      reason: "MISSING_DEGREE_STATES",
    });
  }

  const primary = degreeStates.primary || null;
  const intermediate = degreeStates.intermediate || null;
  const minor = degreeStates.minor || null;
  const minute = degreeStates.minute || null;
  const subminute = degreeStates.subminute || degreeStates.micro || null;

  const minorRead = upper(minor?.currentRead);
  const minuteRead = upper(minute?.currentRead);
  const subminuteRead = upper(subminute?.currentRead);
  const minorStage = upper(minor?.stage);
  const minorCorrectionStage = upper(
    minor?.correctionModel?.stage ||
      minor?.correction?.stage ||
      minor?.stage
  );
  const minuteStage = upper(minute?.stage);
  const subminuteStage = upper(subminute?.stage);

  const minuteNested = minute?.nestedCorrectionContext || null;
  const childPurpose = upper(minuteNested?.childPurpose);
  const currentChildLeg = upper(minuteNested?.currentChildLeg);
  const expectedPath = upper(minuteNested?.expectedPath);
  const parentCorrectionType = upper(minuteNested?.parentCorrectionType);
  const parentActiveLeg = upper(minuteNested?.parentActiveLeg);

  const minuteModel = pickPreferredCorrectionModel(minute);
  const minorModel = pickPreferredCorrectionModel(minor);
  const minuteModelType = upper(minuteModel?.type);
  const minorModelType = upper(minorModel?.type);

  const reasonCodes = [
    "ENGINE26_DERIVE_STRUCTURAL_PLAYBOOK",
    primary?.currentRead ? `PRIMARY_${upper(primary.currentRead)}` : null,
    intermediate?.currentRead ? `INTERMEDIATE_${upper(intermediate.currentRead)}` : null,
    minor?.currentRead ? `MINOR_${upper(minor.currentRead)}` : null,
    minute?.currentRead ? `MINUTE_${upper(minute.currentRead)}` : null,
    subminute?.currentRead ? `SUBMINUTE_${upper(subminute.currentRead)}` : null,
  ].filter(Boolean);

  const common = {
    symbol,
    strategyId,
    tf,
    currentPrice,
    activeImbalance,
    degreeStates,
    primary,
    intermediate,
    minor,
    minute,
    subminute,
  };

  const isPostECompletionReaction =
    hasText(minorRead, "E_COMPLETED_CANDIDATE") ||
    hasText(minorRead, "TRIANGLE_RESOLUTION") ||
    hasText(minorCorrectionStage, "E_COMPLETED_CANDIDATE") ||
    hasText(minorCorrectionStage, "TRIANGLE_RESOLUTION") ||
    hasText(minuteRead, "POST_E_REACTION") ||
    hasText(minuteRead, "COMPLETED_POST_E_REACTION") ||
    hasText(minuteRead, "C_DOWN_COMPLETED") ||
    hasText(subminuteRead, "C_DOWN_RETIRED") ||
    hasText(subminuteRead, "WAIT_FOR_NEW_STRUCTURE") ||
    hasText(subminuteStage, "COMPLETE");

  const isAbcDownCWatch =
    minuteModelType === "ABC_DOWN" ||
    hasText(minuteRead, "ABC") && hasText(minuteRead, "MINOR_E") ||
    hasText(currentChildLeg, "C_DOWN") ||
    hasText(subminuteRead, "C_DOWN");

  const isAbcUpCWatch =
    minuteModelType === "ABC_UP" ||
    hasText(currentChildLeg, "C_UP") ||
    hasText(expectedPath, "A_UP_B_DOWN_C_UP");

  const isParentTriangleEWatch =
    parentCorrectionType === "ABCDE_TRIANGLE" &&
    (
      parentActiveLeg === "E" ||
      hasText(minorRead, "W2_CORRECTION_ACTIVE") ||
      hasText(minuteRead, "MINOR_E") ||
      hasText(childPurpose, "COMPLETE_PARENT_E_LEG")
    );

  const isW3Ignition =
    hasText(minorRead, "W3") ||
    hasText(minuteRead, "W3") ||
    hasText(subminuteRead, "W3") ||
    hasText(minor?.state, "IMPULSE_EXPANSION_ACTIVE") ||
    hasText(minute?.state, "IMPULSE_EXPANSION_ACTIVE");

  const isW4Pullback =
    hasText(minorRead, "W4") ||
    hasText(minuteRead, "W4") ||
    hasText(minor?.action, "WAIT_FOR_SUPPORT_RECLAIM") ||
    hasText(minute?.action, "WAIT_FOR_SUPPORT_RECLAIM");

  const isW5Exhaustion =
    hasText(minorRead, "W5_COMPLETE") ||
    hasText(minuteRead, "W5_COMPLETE") ||
    hasText(minorRead, "POSSIBLE_W5") ||
    hasText(minuteRead, "POSSIBLE_W5") ||
    hasText(minor?.state, "IMPULSE_COMPLETE") ||
    hasText(minute?.state, "IMPULSE_COMPLETE");

  let playbook = null;

  // Priority matters:
  // 1. Nested ABC down/up must beat generic triangle labels because it is the tactical timing path.
  // 2. E completion comes after because it describes the parent goal.
  // 3. Impulse/pullback/exhaustion templates follow.
  if (isPostECompletionReaction) {
    playbook = classifyPostEReactionDecisionWatch({
      ...common,
    });
  } else if (isAbcDownCWatch && minuteModel) {
    playbook = classifyAbcDownBMarked({
      ...common,
      model: minuteModel,
    });
  } else if (isAbcUpCWatch && minuteModel) {
    playbook = classifyAbcUpBPullback({
      ...common,
      model: minuteModel,
    });
  } else if (isParentTriangleEWatch) {
    playbook = classifyTriangleECompletion({
      ...common,
    });
  } else if (isW5Exhaustion) {
    playbook = classifyW5Exhaustion({
      ...common,
    });
  } else if (isW4Pullback) {
    playbook = classifyW4Pullback({
      ...common,
    });
  } else if (isW3Ignition) {
    playbook = classifyW3Ignition({
      ...common,
    });
  } else {
    playbook = classifyNeutral({
      ...common,
    });
  }

  return {
    ...playbook,
    parserDebug: {
      minuteModelType,
      minorModelType,
      isPostECompletionReaction,
      parentCorrectionType,
      parentActiveLeg,
      childPurpose,
      currentChildLeg,
      expectedPath,
      reasonCodes,
      alternateTriangle: pickAlternateTriangle(minute) || pickAlternateTriangle(minor) || null,
    },
  };
}

export default deriveEngine22StructuralPlaybook;
