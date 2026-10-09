import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalMicroState,
} from "../logic/engine22/microV2/canonicalMicroState.js";

import {
  reduceCanonicalMicroState,
} from "../logic/engine22/microV2/reduceCanonicalMicroState.js";

import {
  applyCanonicalMicroIntrabarFibObservation,
} from "../logic/engine22/microV2/applyCanonicalMicroIntrabarFibObservation.js";

import {
  buildMicroExecutionContext,
} from "../logic/engine22/microV2/buildMicroExecutionContext.js";

function state() {
  return createCanonicalMicroState({
    countId: "COUNT-X",
    sequenceId: "SEQ-X",
    sequenceDirection: "UP",
    origin: {
      price: 7782.75,
      source: "TEST",
    },
    parentDegree: "SUBMINUTE",
    parentWave: "W3",
    parentDirection: "UP",
    sourceTimestamp: "2026-10-09T14:00:00Z",
  });
}

test("machine contract projects canonical identity and never claims authority", () => {
  const canonical = state();

  const context =
    buildMicroExecutionContext({
      canonicalState: canonical,
    });

  assert.equal(context.available, true);
  assert.equal(context.sourceCountId, "COUNT-X");
  assert.equal(context.sequenceId, "SEQ-X");
  assert.equal(context.degree, "MICRO");
  assert.equal(context.activeWave, "W1");
  assert.equal(context.waveDirection, "UP");
  assert.equal(context.microTimingState, "OBSERVE");

  assert.equal(context.noPermissionCreated, true);
  assert.equal(context.noExecution, true);
  assert.equal(context.noSizing, true);
  assert.equal(context.noManagement, true);
  assert.equal(context.noJournalMutation, true);
});

test("candidate lifecycle maps to REVERSAL_WINDOW", () => {
  let canonical = state();

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "UPDATE_DEVELOPING_ANCHOR",
        wave: "W1",
        anchor: 7854,
        sourceTimestamp: "2026-10-09T14:05:00Z",
      }
    ).state;

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "MARK_COMPLETION_CANDIDATE",
        wave: "W1",
        anchor: 7854,
        evidence: {
          timeframe: "5m",
          closed: true,
          sourceTimestamp: "2026-10-09T14:10:00Z",
          reasonCodes: [
            "ANCHOR_REJECTION",
            "FIVE_MIN_SWING_BREAK",
          ],
        },
      }
    ).state;

  const context =
    buildMicroExecutionContext({
      canonicalState: canonical,
    });

  assert.equal(
    context.microTimingState,
    "REVERSAL_WINDOW"
  );

  assert.equal(
    context.lifecycle,
    "COMPLETION_CANDIDATE"
  );
});

test("confirmed lifecycle maps to TRANSITION_CONFIRMING", () => {
  let canonical = state();

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "UPDATE_DEVELOPING_ANCHOR",
        wave: "W1",
        anchor: 7854,
        sourceTimestamp: "2026-10-09T14:05:00Z",
      }
    ).state;

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "MARK_COMPLETION_CANDIDATE",
        wave: "W1",
        anchor: 7854,
        evidence: {
          timeframe: "5m",
          closed: true,
          sourceTimestamp: "2026-10-09T14:10:00Z",
          reasonCodes: [
            "ANCHOR_REJECTION",
            "FIVE_MIN_SWING_BREAK",
          ],
        },
      }
    ).state;

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "CONFIRM_COMPLETION",
        wave: "W1",
        evidence: {
          timeframe: "5m",
          closed: true,
          sourceTimestamp: "2026-10-09T14:15:00Z",
          reasonCodes: [
            "FIVE_MIN_SWING_BREAK",
            "FIVE_MIN_DISPLACEMENT",
          ],
        },
      }
    ).state;

  const context =
    buildMicroExecutionContext({
      canonicalState: canonical,
    });

  assert.equal(
    context.microTimingState,
    "TRANSITION_CONFIRMING"
  );

  assert.equal(context.lifecycle, "CONFIRMED");
});

test("lock transition produces TIMING_READY and projects the frozen prior-wave anchor", () => {
  let canonical = state();

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "UPDATE_DEVELOPING_ANCHOR",
        wave: "W1",
        anchor: 7854,
        sourceTimestamp: "2026-10-09T14:05:00Z",
      }
    ).state;

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "MARK_COMPLETION_CANDIDATE",
        wave: "W1",
        anchor: 7854,
        evidence: {
          timeframe: "5m",
          closed: true,
          sourceTimestamp: "2026-10-09T14:10:00Z",
          reasonCodes: [
            "ANCHOR_REJECTION",
            "FIVE_MIN_SWING_BREAK",
          ],
        },
      }
    ).state;

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "CONFIRM_COMPLETION",
        wave: "W1",
        evidence: {
          timeframe: "5m",
          closed: true,
          sourceTimestamp: "2026-10-09T14:15:00Z",
          reasonCodes: [
            "FIVE_MIN_SWING_BREAK",
            "FIVE_MIN_DISPLACEMENT",
          ],
        },
      }
    ).state;

  canonical =
    reduceCanonicalMicroState(
      canonical,
      {
        type: "LOCK_WAVE",
        wave: "W1",
        countId: canonical.countId,
        sourceTimestamp: "2026-10-09T14:15:01Z",
        nextWaveContextCreated: true,
      }
    ).state;

  const context =
    buildMicroExecutionContext({
      canonicalState: canonical,
    });

  assert.equal(context.activeWave, "W2");
  assert.equal(context.waveDirection, "DOWN");
  assert.equal(context.microTimingState, "TIMING_READY");
  assert.equal(context.lockedWaveAnchor.wave, "W1");
  assert.equal(context.lockedWaveAnchor.price, 7854);
});

test("Fib touch projection is visible but does not alter timing lifecycle", () => {
  let canonical = state();

  canonical.waves.W1.lifecycle = "LOCKED";
  canonical.waves.W1.lockedAnchor = 7843;
  canonical.waves.W1.confirmedAnchor = 7843;
  canonical.activeWave = "W2";

  canonical =
    applyCanonicalMicroIntrabarFibObservation(
      canonical,
      {
        sourceTimestamp: "2026-10-09T14:05:00Z",
        rawLow: 7827,
        levels: [
          {
            key: "r236",
            label: "0.236",
            price: 7828.75,
          },
          {
            key: "r382",
            label: "0.382",
            price: 7820,
          },
        ],
      }
    ).state;

  const context =
    buildMicroExecutionContext({
      canonicalState: canonical,
    });

  assert.equal(context.activeWave, "W2");
  assert.equal(context.lifecycle, "DEVELOPING");
  assert.equal(context.lastTouchedFib.key, "r236");
  assert.equal(context.nextFib.key, "r382");
});

test("invalid canonical state fails closed", () => {
  const canonical = state();
  canonical.noExecution = false;

  const context =
    buildMicroExecutionContext({
      canonicalState: canonical,
    });

  assert.equal(context.available, false);

  assert.ok(
    context.reasonCodes.includes(
      "CANONICAL_MICRO_STATE_INVALID"
    )
  );

  assert.equal(context.noExecution, true);
});
