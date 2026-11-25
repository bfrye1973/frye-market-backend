// services/core/tests/engine22MinuteW3DownstreamAlignment.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublishedDegreeTargetModel,
} from "../logic/engine22/wave/buildEngine22WaveStrategy.js";
import {
  buildEngine22DegreeWaveContext,
} from "../logic/engine3/engine22DegreeWaveContext.js";
import {
  deriveEngine22StructuralPlaybook,
} from "../logic/engine26/deriveEngine22StructuralPlaybook.js";
import {
  buildWaveIntelligence,
} from "../logic/engine27/wave/buildWaveIntelligence.js";

function minuteFixture() {
  return {
    activeWave: "W3",
    stage: "EXTENSION_MATURITY_WATCH",
    currentRead:
      "MINUTE_W3_ACTIVE_FROM_7427_75_EXTENSION_MATURITY_WATCH",
    targetModel: {
      modelType: "EXTENSION_LADDER",
      projectionMethod: "W1_RANGE_PROJECTED_FROM_W2",
      impulseStart: 7352,
      impulseEnd: 7518.25,
      projectionBase: 7427.75,
      range: 166.25,
      levels: {
        e100: 7594,
        e1272: 7639.22,
        e1618: 7696.74,
        e200: 7760.25,
        e2618: 7862.99,
      },
      nextTarget: 7696.74,
    },
    internalStructure: {
      active: true,
      parentDegree: "minute",
      parentWave: "W3",
      previousInternalWave: "ii",
      currentInternalWave: "iii",
      nextExpectedInternalWave: "iv",
      internalLegDirection: "UP",
      parentWaveDirection: "LONG",
      classification: "FAST_IMPULSE_EXTENSION",
      parentWaveStillValid: true,
      parentWaveComplete: false,
      parentTransitionPossible: false,
      transitionRisk: "LOW_TO_MODERATE",
      invalidationLevel: 7427.75,
      supportLevel: 7696.74,
    },
  };
}

function degreeStatesFixture() {
  return {
    subminute: {
      activeWave: "C",
      currentRead: "SUBMINUTE_TACTICAL_TIMING_CONTEXT",
    },
    minute: minuteFixture(),
    minor: {
      activeWave: "W2",
      currentRead: "MINOR_PARENT_CONTEXT",
    },
    intermediate: {
      activeWave: "W3",
      currentRead: "INTERMEDIATE_CONTEXT",
    },
    primary: {
      activeWave: "W3",
      currentRead: "PRIMARY_CONTEXT",
    },
  };
}

test("publishes the ES tick-normalized ladder without mutating raw source values", () => {
  const minute = minuteFixture();
  const rawBefore = structuredClone(minute.targetModel);
  const published = buildPublishedDegreeTargetModel({
    symbol: "ES",
    targetModel: minute.targetModel,
    currentPrice: 7747.25,
  });

  assert.deepEqual(published.publishedLevels, {
    e100: 7594,
    e1272: 7639.25,
    e1618: 7696.75,
    e200: 7760.25,
    e2618: 7863,
  });
  assert.equal(published.nextTarget, 7760.25);
  assert.equal(published.nextTargetKey, "e200");
  assert.equal(published.tickSize, 0.25);
  assert.equal(published.normalization, "ES_TICK_ROUNDED");
  assert.deepEqual(minute.targetModel, rawBefore);
});

test("selects the next strictly unpassed ES target", () => {
  const targetModel = minuteFixture().targetModel;
  const cases = [
    [7696.5, 7696.75, "e1618"],
    [7696.75, 7760.25, "e200"],
    [7760.25, 7863, "e2618"],
    [7863.25, null, null],
  ];

  for (const [currentPrice, nextTarget, nextTargetKey] of cases) {
    const published = buildPublishedDegreeTargetModel({
      symbol: "ES",
      targetModel,
      currentPrice,
    });
    assert.equal(published.nextTarget, nextTarget);
    assert.equal(published.nextTargetKey, nextTargetKey);
  }
});

test("Engine 3 consumes Minute internal iii to iv structure instead of stale ABC-down text", () => {
  const degreeStates = degreeStatesFixture();
  const context = buildEngine22DegreeWaveContext({
    engine22WaveStrategy: {
      degreeStates,
      currentLifecycleState: {
        targetContext: {
          nextTarget: 7760.25,
        },
      },
    },
    reactionDirection: "LONG",
    reactionState: "RECLAIMED_LEVEL",
  });

  assert.equal(context.minute.currentInternalWave, "iii");
  assert.equal(context.minute.nextExpectedInternalWave, "iv");
  assert.equal(context.minute.classification, "FAST_IMPULSE_EXTENSION");
  assert.equal(context.minute.supportLevel, 7696.74);
  assert.equal(context.minute.invalidationLevel, 7427.75);
  assert.equal(context.minute.nextTarget, 7760.25);
  assert.equal(context.reactionVsStructure, "INTERNAL_IV_RECLAIM_SUPPORT");
  assert.doesNotMatch(context.interpretation, /ABC_DOWN|C-down|tactical C/i);
  assert.equal(context.noPermissionCreated, true);
  assert.equal(context.noExecution, true);
});

test("Engine 26 prioritizes W3 extension maturity and internal iv over stale correction fallbacks", () => {
  const degreeStates = degreeStatesFixture();
  degreeStates.minute.correctionModel = {
    preferredModel: {
      type: "ABC_DOWN",
    },
  };
  degreeStates.minute.nestedCorrectionContext = {
    currentChildLeg: "C_DOWN",
  };

  const playbook = deriveEngine22StructuralPlaybook({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    tf: "10m",
    currentPrice: 7747.25,
    activeImbalance: null,
    engine22WaveStrategy: {
      degreeStates,
    },
  });

  assert.equal(playbook.template, "W3_EXTENSION_MATURITY_INTERNAL_IV_WATCH");
  assert.equal(playbook.currentInternalWave, "iii");
  assert.equal(playbook.nextExpectedInternalWave, "iv");
  assert.equal(playbook.parentWaveComplete, false);
  assert.equal(playbook.parentTransitionPossible, false);
  assert.equal(playbook.noPermissionCreated, true);
  assert.equal(playbook.noExecution, true);
  assert.ok(!playbook.confirmationNeeds.includes("ENGINE15_READINESS"));
  assert.equal(
    playbook.parserDebug.isW3ExtensionMaturityInternalIvWatch,
    true
  );
});

test("Engine 27 preserves internal iii to iv as the immediate event while parent W3 remains active", () => {
  const intelligence = buildWaveIntelligence({
    degreeStates: degreeStatesFixture(),
  });

  assert.equal(intelligence.minute.currentWave, "W3");
  assert.equal(intelligence.minute.internalWave, "iii");
  assert.equal(intelligence.minute.nextExpectedInternalWave, "iv");
  assert.equal(intelligence.minute.parentWaveComplete, false);
  assert.equal(intelligence.minute.parentTransitionPossible, false);
});
