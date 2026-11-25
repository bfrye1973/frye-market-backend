import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  mergeEngine22MicroSequenceState,
  persistEngine22MicroWaveRuntimeState,
  readEngine22MicroWaveRuntimeState,
  recoverLatestLockedMicroSequenceFromReplay,
  resetEngine22MicroW2ToActive,
} from "../logic/engine22/wave/runtimeStateStore.js";

import {
  buildCurrentWavelength,
} from "../logic/engine22/wave/buildCurrentWavelength.js";

function lockedW1Sequence(high = 7854) {
  return {
    version: "engine22.microWaveSequence.v1",
    role: "TIMING_ONLY",
    origin: 7782.75,
    invalidation: 7782.75,
    activeWave: "W2",
    state: "MICRO_W2_PULLBACK_WATCH",
    confirmationStatus: "W1_CONFIRMED_W2_PENDING",
    candidateW1High: high,
    confirmedW1High: high,
    w1Completion: {
      state: "LOCKED",
      anchor: high,
      evidence: {
        timeframe: "5m",
        immutable: true,
        sourceTimestamp: "2026-10-09T12:55:00Z",
      },
      reasonCodes: [
        "ANCHOR_LOCKED_NO_REPAINT",
      ],
    },
    w2Completion: {
      state: "DEVELOPING",
      anchor: null,
      evidence: {
        timeframe: "UNVERIFIED",
        sourceTimestamp: null,
      },
      reasonCodes: [
        "AWAIT_FIVE_MIN_STRUCTURAL_EVIDENCE",
      ],
    },
    w2CandidateLow: null,
    confirmedW2Low: null,
  };
}

test("locked W1 outranks a regressed developing snapshot", () => {
  const durable = lockedW1Sequence(7854);

  const regressed = {
    activeWave: "W1",
    state: "MICRO_W1_HIGH_SEARCH",
    confirmationStatus: "W1_COMPLETION_NOT_CONFIRMED",
    candidateW1High: 7854,
    confirmedW1High: null,
    w1Completion: {
      state: "DEVELOPING",
      anchor: 7854,
    },
    w2Completion: {
      state: "DEVELOPING",
    },
  };

  const merged =
    mergeEngine22MicroSequenceState({
      snapshotSequence: regressed,
      durableSequence: durable,
    });

  assert.equal(
    merged.w1Completion.state,
    "LOCKED"
  );

  assert.equal(
    merged.confirmedW1High,
    7854
  );

  assert.equal(
    merged.activeWave,
    "W2"
  );

  assert.equal(
    merged.confirmationStatus,
    "W1_CONFIRMED_W2_PENDING"
  );
});

test("durable locked W1 survives a simulated restart with no previous snapshot", () => {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine22-micro-runtime-"
      )
    );

  const stateFile =
    path.join(
      root,
      "micro-runtime.json"
    );

  try {
    const locked =
      lockedW1Sequence(7854);

    assert.equal(
      persistEngine22MicroWaveRuntimeState({
        symbol: "ES",
        microSequence: locked,
        filePath: stateFile,
      }),
      true
    );

    const afterRestart =
      readEngine22MicroWaveRuntimeState({
        symbol: "ES",
        filePath: stateFile,
      });

    assert.equal(
      afterRestart
        .microSequence
        .w1Completion
        .state,
      "LOCKED"
    );

    assert.equal(
      afterRestart
        .microSequence
        .confirmedW1High,
      7854
    );

    const wavelength =
      buildCurrentWavelength({
        symbol: "ES",
        currentPrice: 7832.75,
        microBars5m: [],
        evaluationTimeMs:
          Date.parse(
            "2026-10-09T13:30:00Z"
          ),
        previousMicroSequence:
          afterRestart.microSequence,
      });

    const micro =
      wavelength
        .degrees
        .micro
        .microSequence;

    assert.equal(
      micro.w1Completion.state,
      "LOCKED"
    );

    assert.equal(
      micro.activeWave,
      "W2"
    );

    assert.equal(
      micro.confirmedW1High,
      7854
    );

    assert.equal(
      micro.w2TargetsAvailable,
      true
    );

    assert.ok(
      micro.projectedW2.length > 0
    );

    assert.equal(
      micro.projectedW2
        .find(
          (level) =>
            level.label ===
            "0.500"
        )
        .price,
      7818.5
    );
  } finally {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});

test("Replay recovery restores the latest locked Micro W1 after runtime state loss", () => {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine22-micro-replay-"
      )
    );

  const dateDir =
    path.join(
      root,
      "2026-10-09"
    );

  fs.mkdirSync(
    dateDir,
    {
      recursive: true,
    }
  );

  const replay = {
    symbol: "ES",
    strategies: {
      "intraday_scalp@10m": {
        engine22WaveStrategy: {
          currentWavelength: {
            degrees: {
              micro: {
                microSequence:
                  lockedW1Sequence(
                    7854
                  ),
              },
            },
          },
        },
      },
    },
  };

  fs.writeFileSync(
    path.join(
      dateDir,
      "0620.json"
    ),
    JSON.stringify(replay),
    "utf8"
  );

  try {
    const recovered =
      recoverLatestLockedMicroSequenceFromReplay({
        symbol: "ES",
        replayRoot: root,
      });

    assert.ok(recovered);

    assert.equal(
      recovered
        .w1Completion
        .state,
      "LOCKED"
    );

    assert.equal(
      recovered
        .confirmedW1High,
      7854
    );

    assert.equal(
      recovered.activeWave,
      "W2"
    );

    assert.equal(
      recovered
        .recoveredFromReplay,
      true
    );

    assert.equal(
      recovered
        .recoveredReplayDate,
      "2026-10-09"
    );

    assert.equal(
      recovered
        .recoveredReplayTime,
      "0620"
    );
  } finally {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});

test("developing Micro state never overwrites an existing locked W1", () => {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine22-micro-no-regress-"
      )
    );

  const stateFile =
    path.join(
      root,
      "micro-runtime.json"
    );

  try {
    assert.equal(
      persistEngine22MicroWaveRuntimeState({
        symbol: "ES",
        microSequence:
          lockedW1Sequence(7854),
        filePath: stateFile,
      }),
      true
    );

    const regressed = {
      activeWave: "W1",
      confirmedW1High: null,
      w1Completion: {
        state: "DEVELOPING",
        anchor: 7854,
      },
      w2Completion: {
        state: "DEVELOPING",
      },
    };

    assert.equal(
      persistEngine22MicroWaveRuntimeState({
        symbol: "ES",
        microSequence: regressed,
        filePath: stateFile,
      }),
      true
    );

    const stored =
      readEngine22MicroWaveRuntimeState({
        symbol: "ES",
        filePath: stateFile,
      });

    assert.equal(
      stored
        .microSequence
        .w1Completion
        .state,
      "LOCKED"
    );

    assert.equal(
      stored
        .microSequence
        .confirmedW1High,
      7854
    );

    assert.equal(
      stored
        .microSequence
        .activeWave,
      "W2"
    );
  } finally {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});


test("confirmed W2 does not auto-lock without a new completed 5m confirmation", () => {
  const previous = lockedW1Sequence(7854);

  previous.w2Completion = {
    state: "CONFIRMED",
    anchor: 7828.5,
    evidence: {
      timeframe: "5m",
      sourceTimestamp: "2026-10-09T13:15:00Z",
    },
    reasonCodes: [
      "FIVE_MIN_SWING_BREAK",
      "FIVE_MIN_DISPLACEMENT",
    ],
  };

  previous.w2CandidateLow = 7828.5;
  previous.confirmedW2Low = 7828.5;
  previous.w2LastObservedBarTime = 1791542100;

  const result =
    buildCurrentWavelength({
      symbol: "ES",
      currentPrice: 7839.25,
      previousMicroSequence: previous,
      microBars5m: [],
      evaluationTimeMs:
        Date.parse(
          "2026-10-09T13:25:00Z"
        ),
    });

  const micro =
    result
      .degrees
      .micro
      .microSequence;

  assert.equal(
    micro.w2Completion.state,
    "CONFIRMED"
  );

  assert.equal(
    micro.activeWave,
    "W2"
  );

  assert.equal(
    micro.confirmedW1High,
    7854
  );

  assert.ok(
    micro.projectedW2.length > 0
  );
});

test("manager reset restores active W2 while preserving locked W1", () => {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine22-micro-w2-reset-"
      )
    );

  const stateFile =
    path.join(
      root,
      "micro-runtime.json"
    );

  try {
    const locked =
      lockedW1Sequence(7854);

    locked.w2Completion = {
      state: "LOCKED",
      anchor: 7828.5,
      evidence: {
        timeframe: "5m",
        immutable: true,
      },
      reasonCodes: [
        "ANCHOR_LOCKED_NO_REPAINT",
      ],
    };

    locked.w2CandidateLow = 7828.5;
    locked.confirmedW2Low = 7828.5;
    locked.activeWave = "W3_WATCH";
    locked.state = "MICRO_W3_SETUP_WATCH";
    locked.confirmationStatus = "W2_CONFIRMED_W3_PENDING";

    assert.equal(
      persistEngine22MicroWaveRuntimeState({
        symbol: "ES",
        microSequence: locked,
        filePath: stateFile,
      }),
      true
    );

    assert.equal(
      resetEngine22MicroW2ToActive({
        symbol: "ES",
        filePath: stateFile,
      }),
      true
    );

    const stored =
      readEngine22MicroWaveRuntimeState({
        symbol: "ES",
        filePath: stateFile,
      });

    assert.equal(
      stored.microSequence.w1Completion.state,
      "LOCKED"
    );

    assert.equal(
      stored.microSequence.confirmedW1High,
      7854
    );

    assert.equal(
      stored.microSequence.w2Completion.state,
      "DEVELOPING"
    );

    assert.equal(
      stored.microSequence.activeWave,
      "W2"
    );

    assert.equal(
      stored.microSequence.confirmedW2Low,
      null
    );
  } finally {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
});
