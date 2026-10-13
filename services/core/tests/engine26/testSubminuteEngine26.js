// services/core/tests/engine26/testSubminuteEngine26.js

import { buildSubminuteEngine26 } from "../../logic/engine26/subminute/buildSubminuteEngine26.js";

const engine22WaveStrategy = {
  degreeStates: {
    subminute: {
      direction: "LONG",
      stage: "SUBMINUTE_W3_TRIGGER_WATCH",
      activeWave: "W3",
      nestedCorrectionContext: {
        currentRead: "SUBMINUTE_PULLBACK_COMPLETE",
      },
    },
    minute: {
      direction: "LONG",
      stage: "MINUTE_W3",
      activeWave: "W3",
    },
  },
};

const engine1Context = {
  active: {
    shelf: {
      id: "TEST_SUBMINUTE_SHELF",
      zoneType: "SHELF",
      timeframe: "10m",
      lo: 7500,
      hi: 7504,
      side: "LONG",
      active: true,
    },
  },
  nearest: {
    shelf: null,
  },
  render: {
    shelves: [
      {
        id: "TEST_SUBMINUTE_TARGET",
        zoneType: "SHELF",
        timeframe: "10m",
        lo: 7510,
        hi: 7514,
        side: "LONG",
        active: true,
      },
    ],
  },
};

const result = buildSubminuteEngine26({
  symbol: "ES",
  currentPrice: 7502,
  snapshotTime: "2026-07-21T12:00:00.000Z",
  engine22WaveStrategy,
  engine1Context,
});

const candidate = result?.engine26LocationCandidate || null;
const identity = result?.engine26PipelineIdentity || null;
const location = result?.engine26LocationContext || null;
const controlMap = result?.engine26ControlMap || null;
const geometry = result?.engine26ProposedGeometry || null;

const checks = {
  laneCorrect:
    candidate?.laneId === "subminute" &&
    candidate?.strategyId === "subminute_scalp@10m",

  candidateExists:
    Boolean(candidate?.candidateId),

  zoneExists:
    Boolean(candidate?.zoneId),

  identityComplete:
    identity?.complete === true,

  identityMatches:
    candidate?.candidateId === identity?.candidateId &&
    candidate?.zoneId === identity?.zoneId,

  locationMatches:
    location?.candidateId === candidate?.candidateId &&
    location?.zoneId === candidate?.zoneId,

  controlMapMatches:
    controlMap?.candidateId === candidate?.candidateId &&
    controlMap?.zoneId === candidate?.zoneId,

  geometryMatches:
    geometry?.candidateId === candidate?.candidateId &&
    geometry?.zoneId === candidate?.zoneId,

  geometryActive:
    geometry?.active === true,

  identityPreserved:
    geometry?.candidateIdentityPreserved === true,

  nonExecutable:
    geometry?.nonExecutable === true &&
    geometry?.noPermissionCreated === true &&
    geometry?.noOrderCreated === true &&
    geometry?.noExecution === true,
};

console.log("\n=== SUBMINUTE ENGINE 26 TEST ===");
console.dir(
  {
    checks,
    candidate: {
      laneId: candidate?.laneId,
      strategyId: candidate?.strategyId,
      candidateId: candidate?.candidateId,
      zoneId: candidate?.zoneId,
      active: candidate?.active,
      status: candidate?.status,
      direction: candidate?.direction,
      setupType: candidate?.setupType,
    },
    geometry: {
      active: geometry?.active,
      lifecycleStatus: geometry?.lifecycleStatus,
      proposedEntryPrice: geometry?.proposedEntryPrice,
      proposedStopPrice: geometry?.proposedStopPrice,
      proposedStopDistancePoints: geometry?.proposedStopDistancePoints,
      proposedTargets: geometry?.proposedTargets,
      candidateIdentityPreserved:
        geometry?.candidateIdentityPreserved,
    },
  },
  { depth: 6 }
);

const failed = Object.entries(checks)
  .filter(([, passed]) => passed !== true)
  .map(([name]) => name);

if (failed.length) {
  console.error("\nFAILED:", failed.join(", "));
  process.exit(1);
}

console.log("\nSUBMINUTE ENGINE 26 FOCUSED TEST PASSED");
