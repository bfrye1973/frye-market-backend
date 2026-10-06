import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine28APipelineDoctor,
} from "../logic/engine28a/buildPipelineDoctor.js";

function baseStrategy() {
  return {
    engine26LocationCandidate: {
      status: "OBSERVING_ZONE_REACTION",
      direction: "NEUTRAL",
      candidateId: "C1",
      zoneId: "Z1",
      currentPrice: 7800,
      snapshotTime: "2026-10-06T20:00:00.000Z",
    },

    confluence: {
      context: {
        reaction: {
          paperScalpReaction: {
            state: "PUSHING_LOWER",
            direction: "SHORT",
            quality: "STRONG",
            allowed: true,
            engine3Strategy1QualifiedForEngine6: true,
            blockers: [],
            reasonCodes: [],
          },
        },

        volume: {
          engine4AuthorizedReactionParticipation: {
            participationState: "PARTICIPATION_CONFIRMED",
            direction: "SHORT",
            participationQuality: "STRONG",
            participationConfirmed: true,
            allowed: true,
            hardBlocked: false,
            blockers: [],
            reasonCodes: [],
          },
        },
      },
    },

    permission: {
      paper: {
        decision: "FAST_INTRADAY_PAPER_ALLOW",
        direction: "SHORT",
        allowed: true,
        paperAllowed: true,
        locked: true,
        candidateId: "C1",
        zoneId: "Z1",
        realExecutionAllowed: false,
        brokerExecutionAllowed: false,
        schwabExecutionAllowed: false,
        blockers: [],
        reasonCodes: [],
      },
    },

    engine26ProposedGeometry: {
      status: "GEOMETRY_EXCEPTIONAL",
      direction: "SHORT",
      geometryReady: true,
      candidateId: "C1",
      zoneId: "Z1",
      proposedEntryPrice: 7800,
      proposedStopPrice: 7810,
      proposedTargets: [
        { price: 7780 },
        { price: 7770 },
        { price: 7770 },
      ],
    },

    engine7PositionSizing: {
      status: "FINAL_SIZE_READY",
      direction: "SHORT",
      allowed: true,
      executableSizing: true,
      paperOrderSizingReady: true,
      finalContracts: 3,
      blockers: [],
      reasonCodes: [],
    },

    engine9OfficialManagementPlan: {
      planStatus: "OFFICIAL_PLAN_READY",
      direction: "SHORT",
      managementReady: true,
      official: true,
      planId: "P1",
      blockers: [],
      waitingFor: [],
    },

    engine8PaperOrder: {
      status: "READY_TO_CREATE_PAPER_ORDER",
      direction: "SHORT",
      executable: true,
      finalContracts: 3,
      realExecutionAllowed: false,
      brokerExecutionAllowed: false,
      schwabExecutionAllowed: false,
      blockers: [],
      reasonCodes: [],
    },
  };
}

test("Engine 28A reports ORDER_READY when the current pipeline fully passes", () => {
  const out =
    buildEngine28APipelineDoctor(
      baseStrategy()
    );

  assert.equal(
    out.pipelineStatus,
    "ORDER_READY"
  );

  assert.equal(
    out.firstFailingEngine,
    null
  );

  assert.deepEqual(
    out.stages.map(
      (item) => item.engine
    ),
    [
      "engine26A",
      "engine3",
      "engine4",
      "engine6",
      "engine26B",
      "engine7",
      "engine9",
      "engine8",
    ]
  );

  assert.equal(
    out.safety.safe,
    true
  );
});

test("Engine 28A stops at Engine 3 when market reaction is not qualified", () => {
  const input =
    baseStrategy();

  input.confluence.context.reaction.paperScalpReaction = {
    state:
      "WAITING_FOR_NEGOTIATED_ZONE_REACTION",
    direction: "NEUTRAL",
    quality: "WEAK",
    allowed: false,
    engine3Strategy1QualifiedForEngine6: false,
    blockers: [
      "ENGINE3_REACTION_NOT_CONFIRMED",
    ],
  };

  const out =
    buildEngine28APipelineDoctor(
      input
    );

  assert.equal(
    out.pipelineStatus,
    "WAITING"
  );

  assert.equal(
    out.firstFailingEngine,
    "engine3"
  );

  assert.equal(
    out.failureType,
    "WAITING_FOR_MARKET"
  );

  assert.ok(
    out.engineInstructions.downstreamMustWait.includes(
      "engine8"
    )
  );
});

test("Engine 28A rejects a live execution safety violation", () => {
  const input =
    baseStrategy();

  input.engine8PaperOrder.realExecutionAllowed =
    true;

  const out =
    buildEngine28APipelineDoctor(
      input
    );

  assert.equal(
    out.pipelineStatus,
    "ERROR"
  );

  assert.equal(
    out.firstFailingEngine,
    "engine8"
  );

  assert.equal(
    out.failureType,
    "SAFETY_REJECTION"
  );
});

test("Engine 28A has no current Engine 7B owner", () => {
  const out =
    buildEngine28APipelineDoctor(
      baseStrategy()
    );

  assert.equal(
    JSON.stringify(out).includes(
      "engine7B"
    ),
    false
  );
});
