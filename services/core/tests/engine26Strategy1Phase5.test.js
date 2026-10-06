// services/core/tests/engine26Strategy1Phase5.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine26PaperTradePlan,
} from "../logic/engine26/paperTradePlanner.js";

const SETUP = "NEGOTIATED_ZONE_ROTATION";
const VERSION = "engine26.strategy1.v2";

function candidate(overrides = {}) {
  return {
    active: true,
    status: "INSIDE_LOCATION",
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    candidateId: "E26C-PHASE5-TEST",
    zoneId: "E26Z-PHASE5-ENTRY",
    directionBias: "LONG",
    direction: "LONG",
    tradeDirectionBias: "LONG",
    directionState:
      "LONG_REVERSAL_DEVELOPING",
    setupType: SETUP,
    setupClass: SETUP,
    setupGrade: "A+++",
    identitySetupKey: SETUP,
    candidateIdentityVersion: VERSION,
    snapshotTime:
      "2026-07-23T20:00:00.000Z",
    entryZone: {
      id: "E26Z-PHASE5-ENTRY",
      zoneId: "E26Z-PHASE5-ENTRY",
      low: 7540.75,
      high: 7574,
      midline: 7557.5,
    },
    targetZone: {
      id: "E26Z-PHASE5-TARGET",
      zoneId: "E26Z-PHASE5-TARGET",
      low: 7590.5,
      high: 7611.5,
      midline: 7601,
    },
    locationInvalidationBoundary: 7540.5,
    invalidationFacts: {
      completedCloseInvalidationConfirmed:
        false,
    },
    ...overrides,
  };
}

function handoff(overrides = {}) {
  return {
    active: true,
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    candidateId: "E26C-PHASE5-TEST",
    zoneId: "E26Z-PHASE5-ENTRY",
    direction: "LONG",
    directionState:
      "LONG_REVERSAL_DEVELOPING",
    setupClass: SETUP,
    setupGrade: "A+++",
    identitySetupKey: SETUP,
    candidateIdentityVersion: VERSION,
    entryZone: {
      id: "E26Z-PHASE5-ENTRY",
      zoneId: "E26Z-PHASE5-ENTRY",
      low: 7540.75,
      high: 7574,
      midline: 7557.5,
    },
    targetZone: {
      id: "E26Z-PHASE5-TARGET",
      zoneId: "E26Z-PHASE5-TARGET",
      low: 7590.5,
      high: 7611.5,
      midline: 7601,
    },
    locationInvalidationBoundary: 7540.5,
    snapshotTime:
      "2026-07-23T20:00:00.000Z",
    ...overrides,
  };
}

function permission(overrides = {}) {
  return {
    paper: {
      decision:
        "FAST_INTRADAY_PAPER_ALLOW",
      allowed: true,
      planningAllowed: true,
      mode: "PAPER_ONLY",
      direction: "LONG",
      setupType: SETUP,
      realExecutionAllowed: false,
      requiresEngine8Paper: true,
      requiresEngine10Journal: true,
      ...overrides,
    },
  };
}

function geometry({
  c = candidate(),
  h = handoff(),
  p = permission(),
} = {}) {
  return buildEngine26PaperTradePlan({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    tf: "10m",
    permission: p,
    engine22WaveStrategy: {
      currentLifecycleState: {
        direction: "LONG",
        key: SETUP,
      },
    },
    engine25Context: {},
    confluence: {
      price: 7550,
      context: {
        reaction: {},
        volume: {},
      },
    },
    engine15Decision: {},
    engine26LocationCandidate: c,
    engine26GeometryHandoff: h,
    openPaperTrades: [],
    dailyBars: [],
  }).engine26ProposedGeometry;
}

test(
  "authorized V2 LONG Strategy 1 geometry",
  () => {
    const g = geometry();

    assert.equal(g.active, true);
    assert.equal(g.geometryReady, true);
    assert.equal(g.geometryFeasible, true);
    assert.equal(
      g.geometryContractVersion,
      "engine26b.strategy1.v2"
    );
    assert.equal(g.proposedEntryPrice, 7557.5);
    assert.equal(g.proposedStopPrice, 7540.5);
    assert.equal(g.target1Price, 7590.5);
    assert.equal(g.target2Price, 7601);
    assert.equal(
      g.availableRewardPoints,
      33
    );
    assert.equal(
      g.geometryObjectiveStatus,
      "GEOMETRY_EXCEPTIONAL"
    );
    assert.equal(
      g.targetApproachWarningLow,
      7583.5
    );
    assert.equal(
      g.targetApproachWarningHigh,
      7585.5
    );
    assert.equal(
      g.proposedTargets[2].price,
      null
    );
    assert.equal(
      g.officialPlanOwner,
      "ENGINE9"
    );
  }
);

test(
  "neutral observation zone waits without directional geometry",
  () => {
    const neutralCandidate = candidate({
      directionBias: "NEUTRAL",
      direction: "NEUTRAL",
      tradeDirectionBias: "NEUTRAL",
      directionState:
        "OBSERVING_PROMOTED_ZONE",
      targetZone: null,
      locationInvalidationBoundary: null,
    });

    const neutralHandoff = handoff({
      active: false,
      direction: "NEUTRAL",
      directionState:
        "OBSERVING_PROMOTED_ZONE",
      targetZone: null,
      locationInvalidationBoundary: null,
    });

    const g = geometry({
      c: neutralCandidate,
      h: neutralHandoff,
    });

    assert.equal(g.active, false);
    assert.equal(g.geometryReady, false);
    assert.equal(g.geometryFeasible, false);
    assert.equal(
      g.status,
      "WAITING_FOR_DIRECTIONAL_RESOLUTION"
    );
    assert.equal(g.proposedEntryPrice, null);
    assert.equal(g.proposedStopPrice, null);
    assert.equal(g.target1Price, null);
    assert.equal(g.target2Price, null);
    assert.equal(
      g.plannerProgressionAllowed,
      false
    );
  }
);

test(
  "geometry remains independent from Engine 6 permission",
  () => {
    const g = geometry({
      p: permission({
        decision: "PAPER_WATCH_FAST",
        allowed: false,
        planningAllowed: false,
      }),
    });

    assert.equal(g.geometryReady, true);
    assert.equal(g.permissionReady, false);
    assert.equal(
      g.plannerProgressionAllowed,
      false
    );
  }
);

test("identity mismatch waits safely", () => {
  const g = geometry({
    h: handoff({
      candidateId: "E26C-DIFFERENT",
    }),
  });

  assert.equal(g.active, false);
  assert.equal(g.status, "IDENTITY_MISMATCH");
});

test(
  "completed-close invalidation blocks geometry",
  () => {
    const g = geometry({
      c: candidate({
        active: false,
        status: "INVALIDATED",
        invalidationFacts: {
          completedCloseInvalidationConfirmed:
            true,
        },
      }),
    });

    assert.equal(
      g.status,
      "CANDIDATE_INVALIDATED"
    );

    assert.equal(
      g.geometryFeasible,
      false
    );

    assert.equal(
      g.rawGeometryMathematicallyAvailable,
      true
    );
  }
);

test("inputs are not mutated", () => {
  const c = candidate();
  const h = handoff();
  const p = permission();
  const before = JSON.stringify({ c, h, p });

  geometry({ c, h, p });

  assert.equal(
    JSON.stringify({ c, h, p }),
    before
  );
});
