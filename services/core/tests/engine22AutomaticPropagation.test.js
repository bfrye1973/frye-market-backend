import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine22DegreeWaveContext,
} from "../logic/engine3/engine22DegreeWaveContext.js";
import {
  deriveEngine22StructuralPlaybook,
} from "../logic/engine26/deriveEngine22StructuralPlaybook.js";
import {
  buildWaveIntelligence,
} from "../logic/engine27/wave/buildWaveIntelligence.js";

function buildMinuteFixture({
  currentInternalWave,
  nextExpectedInternalWave,
  parentWaveComplete = false,
  parentTransitionPossible = false,
} = {}) {
  return {
    activeWave: "W3",
    stage: "EXTENSION_MATURITY_WATCH",
    currentRead: "CANONICAL_MINUTE_W3",
    direction: "LONG",
    targetModel: {
      levels: {
        e100: 7594,
        e1272: 7639.25,
        e1618: 7696.75,
        e200: 7760.25,
        e2618: 7863,
      },
      nextTarget: 7863,
    },
    internalStructure: {
      parentDegree: "minute",
      parentWave: "W3",
      parentWaveDirection: "LONG",
      currentInternalWave,
      nextExpectedInternalWave,
      classification: "FAST_IMPULSE_EXTENSION",
      parentWaveStillValid: true,
      parentWaveComplete,
      parentTransitionPossible,
      transitionRisk: "LOW_TO_MODERATE",
      supportLevel: 7696.75,
      invalidationLevel: 7427.75,
    },
  };
}

function buildEngine22Fixture(minute) {
  return {
    activeTradingDegree: "minute",
    degreeStates: {
      minute,
      subminute: null,
      minor: null,
      intermediate: null,
      primary: null,
    },
    // Deliberately stale compatibility mirrors. Canonical degreeStates must win.
    currentLifecycleState: {
      key: "MINUTE_W4_PULLBACK_WAIT",
      direction: "SHORT",
    },
    waveOpportunity: {
      setupType: "ABC_DOWN_B_BOUNCE_C_DOWN_WATCH",
      direction: "SHORT",
    },
    tradeDecision: {
      direction: "SHORT",
      entryAllowed: true,
    },
  };
}

function buildPlaybook(minute) {
  return deriveEngine22StructuralPlaybook({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    tf: "10m",
    currentPrice: 7779.5,
    activeImbalance: null,
    engine22WaveStrategy: buildEngine22Fixture(minute),
  });
}

function serialized(value) {
  return JSON.stringify(value);
}

test("canonical internal iii propagates as internal iv next without parent W4", () => {
  const minute = buildMinuteFixture({
    currentInternalWave: "iii",
    nextExpectedInternalWave: "iv",
  });
  const engine22 = buildEngine22Fixture(minute);
  const playbook = buildPlaybook(minute);
  const engine3 = buildEngine22DegreeWaveContext({
    engine22WaveStrategy: engine22,
    reactionDirection: "LONG",
    reactionState: "RECLAIMED_LEVEL",
  });
  const engine27 = buildWaveIntelligence({
    degreeStates: engine22.degreeStates,
  });

  assert.equal(playbook.template, "W3_EXTENSION_MATURITY_INTERNAL_IV_WATCH");
  assert.equal(playbook.currentInternalWave, "iii");
  assert.equal(playbook.nextExpectedInternalWave, "iv");
  assert.equal(engine3.minute.currentInternalWave, "iii");
  assert.equal(engine3.minute.nextExpectedInternalWave, "iv");
  assert.equal(engine27.minute.internalWave, "iii");
  assert.equal(engine27.minute.nextExpectedInternalWave, "iv");
  assert.equal(engine27.minute.parentWaveComplete, false);
  assert.doesNotMatch(serialized(playbook), /ABC_DOWN|C_DOWN|PARENT_W4|MINUTE_W4/);
});

test("canonical internal iv propagates as internal v next without parent W4", () => {
  const minute = buildMinuteFixture({
    currentInternalWave: "iv",
    nextExpectedInternalWave: "v",
  });
  const playbook = buildPlaybook(minute);
  const engine27 = buildWaveIntelligence({
    degreeStates: buildEngine22Fixture(minute).degreeStates,
  });

  assert.equal(playbook.template, "W3_INTERNAL_IV_PULLBACK_OR_RECLAIM_WATCH");
  assert.equal(playbook.currentInternalWave, "iv");
  assert.equal(playbook.nextExpectedInternalWave, "v");
  assert.equal(playbook.parentWaveComplete, false);
  assert.equal(playbook.parentTransitionPossible, false);
  assert.equal(engine27.minute.currentWave, "W3");
  assert.equal(engine27.minute.internalWave, "iv");
  assert.equal(engine27.minute.nextExpectedInternalWave, "v");
  assert.notEqual(
    playbook.template,
    "MINUTE_W3_COMPLETE_PARENT_W4_TRANSITION_POSSIBLE"
  );
});

test("canonical internal v remains parent W3 until completion flags permit W4", () => {
  const minute = buildMinuteFixture({
    currentInternalWave: "v",
    nextExpectedInternalWave: null,
  });
  const playbook = buildPlaybook(minute);
  const engine27 = buildWaveIntelligence({
    degreeStates: buildEngine22Fixture(minute).degreeStates,
  });

  assert.equal(playbook.template, "W3_INTERNAL_V_CONTINUATION_OR_MATURITY_WATCH");
  assert.equal(playbook.currentInternalWave, "v");
  assert.equal(playbook.parentWaveComplete, false);
  assert.equal(playbook.parentTransitionPossible, false);
  assert.equal(engine27.minute.currentWave, "W3");
  assert.equal(engine27.minute.internalWave, "v");
  assert.notEqual(
    playbook.template,
    "MINUTE_W3_COMPLETE_PARENT_W4_TRANSITION_POSSIBLE"
  );
});

test("parent W4 appears only after canonical completion or transition flag", () => {
  const minute = buildMinuteFixture({
    currentInternalWave: "v",
    nextExpectedInternalWave: null,
    parentWaveComplete: true,
    parentTransitionPossible: true,
  });
  const playbook = buildPlaybook(minute);

  assert.equal(
    playbook.template,
    "MINUTE_W3_COMPLETE_PARENT_W4_TRANSITION_POSSIBLE"
  );
  assert.equal(playbook.parentWaveComplete, true);
  assert.equal(playbook.parentTransitionPossible, true);
  assert.equal(playbook.nextPossibleParentWave, "W4");
});

test("missing canonical degree state returns UNKNOWN and invents no historical structure", () => {
  const engine22WaveStrategy = {
    degreeStates: null,
    currentLifecycleState: { key: "MINUTE_W4" },
    waveOpportunity: { setupType: "ABC_DOWN" },
    tradeDecision: { direction: "SHORT", entryAllowed: true },
  };

  const playbook = deriveEngine22StructuralPlaybook({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    tf: "10m",
    currentPrice: 7779.5,
    activeImbalance: null,
    engine22WaveStrategy,
  });

  assert.equal(playbook.template, "UNKNOWN_ENGINE22_STRUCTURE");
  assert.equal(playbook.preferredDirection, "NONE");
  assert.equal(playbook.noExecution, true);
  assert.equal(playbook.noPermissionCreated, true);
  assert.doesNotMatch(serialized(playbook), /ABC_DOWN|C_DOWN|MINUTE_W4|W5/);
});
