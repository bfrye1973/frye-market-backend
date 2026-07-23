/ services/core/tests/engine27TraderDecision.phase6.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTraderDecision,
} from "../logic/engine27/decision/buildTraderDecision.js";

const STRATEGY1_SETUP_CLASS =
  "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";

const IDENTITY = {
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-PHASE6-TEST",
  zoneId: "E26Z-PHASE6-TEST",
  setupClass: STRATEGY1_SETUP_CLASS,
  setupGrade: "A+++",
  identitySetupKey: STRATEGY1_SETUP_CLASS,
  candidateIdentityVersion: "engine26.strategy1.v1",
};

function laneAlpha({
  laneId,
  strategyId,
  displayName,
  degree,
} = {}) {
  return {
    active: true,
    laneId,
    strategyId,
    displayName,
    degree,
    decision: "WATCH",
    proximity: "AT_LEVEL",
    direction: "LONG",
    currentPrice: 7500,
    reaction: {
      confirmed: false,
      directionMatches: true,
      direction: "LONG",
    },
    participation: {
      allowed: false,
      hardBlocked: false,
    },
    permissionContext: {
      engine15Required: false,
      engine6Decision: "PAPER_STAND_DOWN",
      engine6Allowed: false,
      paperOnly: true,
      realExecutionAllowed: false,
      brokerExecutionAllowed: false,
      schwabExecutionAllowed: false,
    },
    plannerContext: {
      available: false,
      status: "NOT_AVAILABLE",
      ready: false,
    },
    higherTimeframeContext: {
      conflictsWithLong: false,
      conflictsWithShort: false,
    },
    blockers: [],
    geometryToolRecommended: false,
  };
}

function baseInputs() {
  return {
    engine27WaveIntelligence: {
      minute: {
        currentWave: "W3",
        nextExpectedWave: "W4",
        preferredTradeDirection: "LONG",
        structuralDirection: "LONG",
        invalidated: false,
        stage: "ACTIVE",
      },
      subminute: {
        currentWave: "W3",
        nextExpectedWave: "W4",
        preferredTradeDirection: "LONG",
        structuralDirection: "LONG",
        invalidated: false,
        stage: "ACTIVE",
      },
    },
    engine27FibIntelligence: {
      minute: {
        currentPrice: 7500,
        currentFib: {
          lastCompleted: "NONE",
          next: "e100",
        },
        nextFib: "e100",
        nextPrice: 7600,
        distance: 100,
      },
      subminute: {
        currentPrice: 7500,
        currentFib: {
          lastCompleted: "NONE",
          next: "e100",
        },
        nextFib: "e100",
        nextPrice: 7550,
        distance: 50,
      },
    },
    engine27Alignment: {
      active: true,
      direction: "LONG",
      alignmentState: "STRONG_BULLISH_ALIGNMENT",
      confidence: "VERY_HIGH",
      conflictingDegrees: [],
      lowerDegreeWarnings: [],
      waveStageCompatibility: {
        minorToMinute: {
          status: "CONFIRMS_PARENT",
        },
        minuteToSubminute: {
          status: "CONFIRMS_PARENT",
        },
      },
    },
    engine27MarketStory: {
      headline: "Phase 6 fixture",
      outlook: "Read-only test fixture.",
    },
    alphaDecisions: {
      minute: laneAlpha({
        laneId: "minute",
        strategyId: "intraday_scalp@10m",
        displayName: "Minute",
        degree: "minute",
      }),
      subminute: laneAlpha({
        laneId: "subminute",
        strategyId: "subminute_scalp@10m",
        displayName: "Subminute",
        degree: "subminute",
      }),
    },
  };
}

function strategy1Pipeline({
  reactionConfirmed = true,
  participationConfirmed = true,
  hardBlocked = false,
  decision = "FAST_INTRADAY_PAPER_ALLOW",
  allowed = true,
  planningAllowed = true,
  geometryActive = true,
  lifecycleStatus = "PROPOSED_GEOMETRY_AVAILABLE",
  candidateInvalidated = false,
  geometryOverrides = {},
  reactionOverrides = {},
  participationOverrides = {},
  permissionOverrides = {},
} = {}) {
  return {
    engine26LocationCandidate: {
      ...IDENTITY,
      invalidated: candidateInvalidated,
    },
    engine3AuthorizedReaction: {
      strategyId: IDENTITY.strategyId,
      candidateId: IDENTITY.candidateId,
      zoneId: IDENTITY.zoneId,
      reactionConfirmed,
      reactionState:
        reactionConfirmed
          ? "REACTION_CONFIRMED"
          : "REACTION_DEVELOPING",
      authorizedReactionState:
        reactionConfirmed
          ? "REACTION_CONFIRMED"
          : "REACTION_DEVELOPING",
      ...reactionOverrides,
    },
    engine4AuthorizedParticipation: {
      ...IDENTITY,
      participationConfirmed,
      participationState:
        participationConfirmed
          ? "PARTICIPATION_CONFIRMED"
          : "PARTICIPATION_WAITING",
      hardBlocked,
      ...participationOverrides,
    },
    engine6Permission: {
      strategyId: IDENTITY.strategyId,
      candidateId: IDENTITY.candidateId,
      zoneId: IDENTITY.zoneId,
      decision,
      allowed,
      planningAllowed,
      ...permissionOverrides,
    },
    engine26ProposedGeometry: {
      ...IDENTITY,
      active: geometryActive,
      lifecycleStatus,
      proposedEntryPrice: 7445.75,
      proposedStopPrice: 7433.5,
      proposedTargets: [
        {
          sequence: 1,
          price: 7504,
          purpose: "FIRST_PROFIT_NEXT_NEGOTIATED_ZONE_TOUCH",
        },
        {
          sequence: 2,
          price: 7511.25,
          purpose: "SECOND_PROFIT_NEXT_NEGOTIATED_ZONE_MIDLINE",
        },
        {
          sequence: 3,
          price: null,
          purpose: "ENGINE9_RUNNER_HANDOFF",
          runnerHandoffRequired: true,
        },
      ],
      ...geometryOverrides,
    },
  };
}

function decisionFor(pipelineContext, extra = {}) {
  const result = buildTraderDecision({
    ...baseInputs(),
    pipelineContext,
    ...extra,
  });

  return result.decisions.minute;
}

test("Phase 6 all-ready Strategy 1 publishes all readiness true", () => {
  const decision = decisionFor(
    strategy1Pipeline()
  );

  assert.deepEqual(
    decision.readiness,
    {
      structureReady: true,
      priceReady: true,
      reactionReady: true,
      participationReady: true,
      permissionReady: true,
      plannerReady: true,
      invalidated: false,
    }
  );

  assert.equal(
    decision.decisionState,
    "READY"
  );
  assert.equal(
    decision.noExecution,
    true
  );
  assert.equal(
    decision.paperPipeline.executable,
    false
  );
});

test("Phase 6 preserves exact Strategy 1 identity", () => {
  const decision = decisionFor(
    strategy1Pipeline()
  );

  for (
    const field
    of [
      "laneId",
      "strategyId",
      "candidateId",
      "zoneId",
      "setupClass",
      "identitySetupKey",
      "candidateIdentityVersion",
    ]
  ) {
    assert.equal(
      decision[field],
      IDENTITY[field]
    );
  }

  assert.equal(
    decision.pipelineIdentity.complete,
    true
  );
  assert.equal(
    decision.pipelineIdentity.consistent,
    true
  );
});

test("Phase 6 developing upstream states remain waiting, not hard-blocked", () => {
  const decision = decisionFor(
    strategy1Pipeline({
      reactionConfirmed: false,
      participationConfirmed: false,
      decision: "PAPER_STAND_DOWN",
      allowed: false,
      planningAllowed: false,
      geometryActive: false,
      lifecycleStatus:
        "WAITING_FOR_ENGINE6_PERMISSION",
    })
  );

  assert.equal(
    decision.readiness.reactionReady,
    false
  );
  assert.equal(
    decision.readiness.participationReady,
    false
  );
  assert.equal(
    decision.readiness.permissionReady,
    false
  );
  assert.equal(
    decision.readiness.plannerReady,
    false
  );
  assert.equal(
    decision.blockers.includes(
      "ENGINE4_HARD_BLOCK"
    ),
    false
  );
  assert.notEqual(
    decision.decisionState,
    "READY"
  );
});

test("Phase 6 completed-close candidate invalidation forces invalidated and planner false", () => {
  const decision = decisionFor(
    strategy1Pipeline({
      candidateInvalidated: true,
    })
  );

  assert.equal(
    decision.readiness.invalidated,
    true
  );
  assert.equal(
    decision.readiness.plannerReady,
    false
  );
  assert.equal(
    decision.decisionState,
    "INVALIDATED"
  );
  assert.equal(
    decision.noExecution,
    true
  );
});

test("Phase 6 identity mismatch safely forces all pipeline readiness false", () => {
  const decision = decisionFor(
    strategy1Pipeline({
      geometryOverrides: {
        zoneId: "E26Z-MISMATCH",
      },
    })
  );

  assert.equal(
    decision.pipelineIdentity.consistent,
    false
  );
  assert.equal(
    decision.readiness.reactionReady,
    false
  );
  assert.equal(
    decision.readiness.participationReady,
    false
  );
  assert.equal(
    decision.readiness.permissionReady,
    false
  );
  assert.equal(
    decision.readiness.plannerReady,
    false
  );
  assert.equal(
    decision.blockers.includes(
      "ENGINE26_PIPELINE_IDENTITY_MISMATCH"
    ),
    false
  );
  assert.equal(
    decision.warnings.includes(
      "ENGINE26_PIPELINE_IDENTITY_MISMATCH"
    ),
    true
  );
});

test("Phase 6 accepts two numeric targets plus null Engine 9 runner handoff", () => {
  const decision = decisionFor(
    strategy1Pipeline()
  );

  assert.equal(
    decision.readiness.plannerReady,
    true
  );
  assert.equal(
    decision.reasonCodes.includes(
      "ENGINE27_TRADER_ENGINE9_RUNNER_HANDOFF_ACCEPTED"
    ),
    true
  );
});

test("Phase 6 rejects a fabricated numeric price on the Engine 9 runner handoff", () => {
  const pipeline = strategy1Pipeline();
  pipeline.engine26ProposedGeometry
    .proposedTargets[2].price = 7520;

  const decision = decisionFor(
    pipeline
  );

  assert.equal(
    decision.readiness.plannerReady,
    false
  );
});

test("Minute non-Strategy-1 path retains existing explicit readiness behavior", () => {
  const legacyIdentity = {
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    candidateId: "E26C-LEGACY",
    zoneId: "E26Z-LEGACY",
    setupClass: "OTHER_SETUP",
  };

  const decision = decisionFor({
    engine26LocationCandidate: {
      ...legacyIdentity,
      pipelineIdentity: {
        ...legacyIdentity,
        complete: true,
      },
    },
    engine3AuthorizedReaction: {
      ...legacyIdentity,
      authorized: true,
      allowed: true,
      authorizedReactionState:
        "REACTION_CONFIRMED",
    },
    engine4AuthorizedParticipation: {
      ...legacyIdentity,
      allowed: true,
      confirmed: true,
      hardBlocked: false,
      status:
        "PARTICIPATION_CONFIRMED",
    },
    engine6Permission: {
      ...legacyIdentity,
      allowed: true,
      decision:
        "FAST_INTRADAY_PAPER_ALLOW",
    },
    engine26Planner: {
      ...legacyIdentity,
      active: true,
      status:
        "FAST_INTRADAY_PAPER_TICKET_READY",
    },
  });

  assert.equal(
    decision.readiness.reactionReady,
    true
  );
  assert.equal(
    decision.readiness.participationReady,
    true
  );
  assert.equal(
    decision.readiness.permissionReady,
    true
  );
  assert.equal(
    decision.readiness.plannerReady,
    true
  );
});

test("Subminute remains isolated from Minute Strategy 1 contracts", () => {
  const inputs = baseInputs();

  const result = buildTraderDecision({
    ...inputs,
    pipelineContext:
      strategy1Pipeline(),
    subminutePipelineContext: {
      engine26LocationCandidate: {
        laneId: "subminute",
        strategyId:
          "subminute_scalp@10m",
        candidateId:
          "E26C-SUBMINUTE-ONLY",
        zoneId:
          "E26Z-SUBMINUTE-ONLY",
        symbol: "ES",
        pipelineIdentity: {
          laneId: "subminute",
          strategyId:
            "subminute_scalp@10m",
          candidateId:
            "E26C-SUBMINUTE-ONLY",
          zoneId:
            "E26Z-SUBMINUTE-ONLY",
          complete: true,
        },
      },
      engine26PipelineIdentity: {
        laneId: "subminute",
        strategyId:
          "subminute_scalp@10m",
        candidateId:
          "E26C-SUBMINUTE-ONLY",
        zoneId:
          "E26Z-SUBMINUTE-ONLY",
        complete: true,
      },
      engine26LocationContext: {
        laneId: "subminute",
        strategyId:
          "subminute_scalp@10m",
        candidateId:
          "E26C-SUBMINUTE-ONLY",
        zoneId:
          "E26Z-SUBMINUTE-ONLY",
      },
      engine26ControlMap: {
        laneId: "subminute",
        strategyId:
          "subminute_scalp@10m",
        candidateId:
          "E26C-SUBMINUTE-ONLY",
        zoneId:
          "E26Z-SUBMINUTE-ONLY",
      },
      engine26ProposedGeometry: {
        laneId: "subminute",
        strategyId:
          "subminute_scalp@10m",
        candidateId:
          "E26C-SUBMINUTE-ONLY",
        zoneId:
          "E26Z-SUBMINUTE-ONLY",
        active: true,
        lifecycleStatus:
          "PROPOSED_GEOMETRY_AVAILABLE",
        candidateIdentityPreserved: true,
        proposalOnly: true,
        plannerOnly: true,
        official: false,
        nonExecutable: true,
        noExecution: true,
      },
    },
  });

  assert.equal(
    result.decisions.minute.candidateId,
    IDENTITY.candidateId
  );
  assert.equal(
    result.decisions.subminute.candidateId,
    "E26C-SUBMINUTE-ONLY"
  );
  assert.notEqual(
    result.decisions.subminute.candidateId,
    result.decisions.minute.candidateId
  );
});
