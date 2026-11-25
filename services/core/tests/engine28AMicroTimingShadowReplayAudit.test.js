import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeMicroTimingShadowSnapshots,
} from "../logic/engine28a/summarizeMicroTimingShadowSnapshots.js";

function snap({
  revision,
  ts,
  timing = "SETUP_DEVELOPING",
  wave = "W2",
  lifecycle = "DEVELOPING",
  shadowStatus = "WAIT_ENGINE22_MICRO",
  ready = false,
  producer = false,
  activation = false,
} = {}) {
  return {
    strategies: {
      "intraday_scalp@10m": {
        engine22WaveStrategy: {
          microExecutionContext: {
            sourceCountId:
              "COUNT-A",
            revision,
            sourceTimestamp:
              ts,
            microTimingState:
              timing,
            activeWave:
              wave,
            lifecycle,
          },
        },

        engine28AMicroTimingAutomationShadow: {
          shadowStatus,
          firstWaitingStage:
            shadowStatus ===
              "WAIT_ENGINE22_MICRO"
              ? "engine22Micro"
              : null,
          hypotheticalPaperTimingReady:
            ready,
          producerAutomationEligible:
            producer,
          productionActivationEligible:
            activation,
          microDirectionAligned:
            true,
          candidateDirectionAligned:
            true,
        },
      },
    },
  };
}

test("repeated snapshots of one canonical observation count once", () => {
  const duplicate =
    snap({
      revision: 5,
      ts:
        "2026-10-09T20:00:00Z",
    });

  const out =
    summarizeMicroTimingShadowSnapshots([
      duplicate,
      structuredClone(duplicate),
      structuredClone(duplicate),
    ]);

  assert.equal(
    out.rawSnapshotCount,
    3
  );

  assert.equal(
    out.uniqueCanonicalObservationCount,
    1
  );

  assert.equal(
    out.duplicateSnapshotCount,
    2
  );

  assert.equal(
    out.byMicroTimingState
      .SETUP_DEVELOPING,
    1
  );
});

test("distinct revisions count as distinct canonical observations", () => {
  const out =
    summarizeMicroTimingShadowSnapshots([
      snap({
        revision: 1,
        ts:
          "2026-10-09T20:00:00Z",
      }),
      snap({
        revision: 2,
        ts:
          "2026-10-09T20:05:00Z",
        timing:
          "TIMING_READY",
        shadowStatus:
          "WOULD_BE_PAPER_TIMING_READY_PRODUCER_BLOCKED",
        ready: true,
      }),
    ]);

  assert.equal(
    out.uniqueCanonicalObservationCount,
    2
  );

  assert.equal(
    out.hypotheticalPaperTimingReadyCount,
    1
  );

  assert.equal(
    out.productionActivationEligibleCount,
    0
  );

  assert.equal(
    out.rates
      .hypotheticalPaperTimingReadyPct,
    50
  );
});

test("analyzer never invents win-rate analytics", () => {
  const out =
    summarizeMicroTimingShadowSnapshots([
      snap({
        revision: 1,
        ts:
          "2026-10-09T20:00:00Z",
      }),
    ]);

  assert.equal(
    Object.hasOwn(
      out,
      "winRate"
    ),
    false
  );

  assert.ok(
    out.reasonCodes.includes(
      "NO_WIN_RATE_CLAIM"
    )
  );
});
