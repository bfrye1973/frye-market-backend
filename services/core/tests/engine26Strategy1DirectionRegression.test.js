// services/core/tests/engine26Strategy1DirectionRegression.test.js

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

const SETUP = "NEGOTIATED_ZONE_ROTATION";

const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "engine26-direction-regression-memory-")
);
const TEST_MEMORY_PATH = path.join(
  TEST_MEMORY_DIR,
  "negotiated-zone-memory.json"
);

after(() => {
  fs.rmSync(TEST_MEMORY_DIR, {
    recursive: true,
    force: true,
  });
});

function minuteDownContext() {
  return {
    currentLifecycleState: {
      key: "MINUTE_ROTATION_WATCH",
      direction: "DOWN",
    },
    waveOpportunity: {
      setupType: "MINUTE_ROTATION_WATCH",
      direction: "DOWN",
    },
    degreeStates: {
      minute: {
        stage: "C_COMPLETION_WATCH",
        direction: "DOWN",
      },
      subminute: {
        stage: "TACTICAL_ROTATION_WATCH",
        direction: "NEUTRAL",
      },
    },
  };
}

test(
  "lower-zone reclaim plus bullish EMA10 resolves provisional LONG without inheriting Minute DOWN",
  () => {
    const result = buildEngine26A({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      timeframe: "10m",
      currentPrice: 7445.75,
      snapshotTime: "2026-07-28T15:15:00.000Z",
      engine22WaveStrategy: minuteDownContext(),
      ema10Posture: {
        posture: "BULLISH",
        ema10: 7440,
        currentPrice: 7445.75,
      },
      bars10m: [
        {
          time: "2026-07-28T14:40:00.000Z",
          open: 7440,
          high: 7452,
          low: 7431,
          close: 7450.5,
          completed: true,
        },
        {
          time: "2026-07-28T14:50:00.000Z",
          open: 7450.5,
          high: 7452,
          low: 7437.5,
          close: 7444,
          completed: true,
        },
      ],
      memoryFilePath: TEST_MEMORY_PATH,
      persistMemory: false,
    });

    const candidate = result.engine26LocationCandidate;

    assert.equal(candidate.setupClass, SETUP);
    assert.equal(candidate.directionBias, "LONG");
    assert.equal(
      candidate.directionState,
      "LONG_REVERSAL_DEVELOPING"
    );
    assert.equal(candidate.ema10Posture.posture, "BULLISH");
    assert.equal(
      candidate.invalidationFacts
        .completedCloseInvalidationConfirmed,
      false
    );
    assert.equal(
      candidate.structuralContext.minuteStage,
      "C_COMPLETION_WATCH"
    );
    assert.ok(
      candidate.reasonCodes.includes(
        "ENGINE22_INTERNAL_LEG_DIRECTION_NOT_USED_WITHOUT_EXPLICIT_TRAVEL_CONTRACT"
     )
   );
  }
);

test(
  "upper-zone rejection plus bearish EMA10 resolves provisional SHORT without inheriting Minute DOWN",
  () => {
    const result = buildEngine26A({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      timeframe: "10m",
      currentPrice: 7502,
      snapshotTime: "2026-07-28T18:10:00.000Z",
      engine22WaveStrategy: minuteDownContext(),
      ema10Posture: {
        posture: "BEARISH",
        ema10: 7508,
        currentPrice: 7502,
      },
      bars10m: [
        {
          time: "2026-07-28T17:30:00.000Z",
          open: 7502,
          high: 7520,
          low: 7501,
          close: 7510,
          completed: true,
        },
        {
          time: "2026-07-28T17:40:00.000Z",
          open: 7510,
          high: 7512,
          low: 7498,
          close: 7502,
          completed: true,
        },
        {
          time: "2026-07-28T17:50:00.000Z",
          open: 7502,
          high: 7505,
          low: 7494,
          close: 7498,
          completed: true,
        },
      ],
      memoryFilePath: TEST_MEMORY_PATH,
      persistMemory: false,
    });

    const candidate = result.engine26LocationCandidate;

    assert.equal(candidate.setupClass, SETUP);
    assert.equal(candidate.directionBias, "SHORT");
    assert.equal(
      candidate.directionState,
      "SHORT_REVERSAL_DEVELOPING"
    );
    assert.equal(candidate.ema10Posture.posture, "BEARISH");
  }
);

test(
  "conflicting zone evidence and EMA10 posture remains NEUTRAL",
  () => {
    const result = buildEngine26A({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      timeframe: "10m",
      currentPrice: 7502,
      snapshotTime: "2026-07-28T18:20:00.000Z",
      engine22WaveStrategy: minuteDownContext(),
      ema10Posture: {
        posture: "BULLISH",
        ema10: 7498,
        currentPrice: 7502,
      },
      bars10m: [
        {
          time: "2026-07-28T17:30:00.000Z",
          open: 7502,
          high: 7520,
          low: 7501,
          close: 7510,
          completed: true,
        },
        {
          time: "2026-07-28T17:40:00.000Z",
          open: 7510,
          high: 7512,
          low: 7498,
          close: 7502,
          completed: true,
        },
        {
          time: "2026-07-28T17:50:00.000Z",
          open: 7502,
          high: 7505,
          low: 7494,
          close: 7498,
          completed: true,
        },
      ],
      memoryFilePath: TEST_MEMORY_PATH,
      persistMemory: false,
    });

    const candidate = result.engine26LocationCandidate;

    assert.equal(candidate.directionBias, "NEUTRAL");
    assert.equal(
      candidate.directionState,
      "NEUTRAL_NO_DIRECTIONAL_EDGE"
    );
    assert.equal(
      candidate.directionalEvidence.directionalConflict,
      true
    );
  }
);
