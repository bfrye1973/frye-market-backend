// services/core/tests/engine22WaveRuntimeStateStore.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readEngine22WaveRuntimeState,
  writeEngine22WaveRuntimeState,
  persistConfirmedMinuteW4State,
} from "../logic/engine22/wave/runtimeStateStore.js";

test("Engine 22 runtime store persists and restores confirmed Minute W4 state without touching manual wave state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine22-wave-state-"));
  const filePath = path.join(dir, "engine22-wave-runtime-state.json");

  try {
    const wrote = writeEngine22WaveRuntimeState({
      symbol: "ES",
      degree: "minute",
      filePath,
      record: {
        transitionState: "PARENT_W4_ACTIVE_CANDIDATE",
        activeParentWave: "W4",
        direction: "DOWN",
        confirmedW3High: 7820.25,
        w2Low: 7427.75,
        parentWaveComplete: true,
        parentTransitionPossible: true,
        source: "TEST_CONFIRMED_STRUCTURE",
      },
    });

    assert.equal(wrote, true);

    const restored = readEngine22WaveRuntimeState({
      symbol: "ES",
      degree: "minute",
      filePath,
    });

    assert.equal(restored.activeParentWave, "W4");
    assert.equal(restored.transitionState, "PARENT_W4_ACTIVE_CANDIDATE");
    assert.equal(restored.confirmedW3High, 7820.25);
    assert.equal(restored.w2Low, 7427.75);
    assert.equal(restored.noExecution, true);
    assert.equal(restored.noPermissionCreated, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("confirmed W4 model can be persisted as durable Engine 22 structural state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine22-wave-state-"));
  const filePath = path.join(dir, "engine22-wave-runtime-state.json");

  try {
    const persisted = persistConfirmedMinuteW4State({
      symbol: "ES",
      filePath,
      model: {
        state: "PARENT_W4_ACTIVE_CANDIDATE",
        w3HighCandidate: 7820.25,
        w3HighCandidateTimeSec: null,
        w4RetracementMap: {
          w2Low: 7427.75,
        },
        evidence: {
          structuralTransitionAuthority: "CANONICAL_10M_STRUCTURE",
        },
      },
    });

    assert.equal(persisted, true);

    const restored = readEngine22WaveRuntimeState({
      symbol: "ES",
      degree: "minute",
      filePath,
    });

    assert.equal(restored.confirmedW3High, 7820.25);
    assert.equal(restored.activeFibModelKey, "W4_RETRACEMENT_MAP");
    assert.equal(restored.parentWaveComplete, true);
    assert.equal(restored.parentTransitionPossible, true);
    assert.equal(restored.source, "ENGINE22_CONFIRMED_RUNTIME_TRANSITION");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
