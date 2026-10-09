import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMicroPositionContext,
} from "../logic/engine22/microV2/buildMicroPositionContext.js";

function micro(overrides = {}) {
  return {
    microExecutionContext: {
      available: true,
      sourceCountId: "COUNT-1",
      canonicalStateVersion: 2,
      activeWave: "W3",
      waveDirection: "UP",
      lifecycle: "DEVELOPING",
      microTimingState: "TRANSITION_CONFIRMING",
      countStatus: "ACTIVE",
      sourceTimestamp: "2026-10-09T20:00:00Z",
      ...overrides,
    },
  };
}

function shortTrade({
  accountMode = "REAL",
  qty = 2,
} = {}) {
  return {
    tradeId: "T-SHORT-1",
    source:
      accountMode === "REAL"
        ? "SCHWAB_BROKER_FILL"
        : "ENGINE8_PAPER_FILL",
    accountMode,
    journalAccount: "INTRADAY",
    symbol:
      accountMode === "REAL"
        ? "MES"
        : "ES",
    normalizedInstrumentRoot:
      accountMode === "REAL"
        ? "MES"
        : "ES",
    status: "OPEN",
    direction: "SHORT",
    qty: {
      remainingQty: qty,
    },
    entry: {
      price: 7840,
      time: "2026-10-09T18:00:00Z",
    },
  };
}

test("open SHORT against W3 UP creates HIGH conflict and do-not-add guidance", () => {
  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro(),
      openTrades: [
        shortTrade(),
      ],
      currentPrice:
        7862,
    });

  assert.equal(
    out.positionPresent,
    true
  );

  assert.equal(
    out.positionConflict,
    true
  );

  assert.equal(
    out.conflictSeverity,
    "HIGH"
  );

  assert.equal(
    out.doNotAddAgainstImpulse,
    true
  );

  assert.ok(
    out.positions[0]
      .guidance.includes(
        "DO_NOT_ADD_SHORTS"
      )
  );

  assert.equal(
    out.alertsPreview.length,
    1
  );
});

test("TIMING_READY plus aligned Engine3 and Engine4 upgrades conflict to CRITICAL", () => {
  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro({
          microTimingState:
            "TIMING_READY",
        }),

      engine3Reaction: {
        allowed: true,
        reactionConfirmed: true,
        direction: "LONG",
      },

      engine4Participation: {
        allowed: true,
        participationConfirmed: true,
        direction: "LONG",
      },

      openTrades: [
        shortTrade(),
      ],
    });

  assert.equal(
    out.conflictSeverity,
    "CRITICAL"
  );

  assert.equal(
    out.confirmation.engine3Aligned,
    true
  );

  assert.equal(
    out.confirmation.engine4Aligned,
    true
  );
});

test("LONG aligned with W3 UP is not a conflict", () => {
  const trade =
    shortTrade();

  trade.tradeId = "T-LONG-1";
  trade.direction = "LONG";

  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro(),
      openTrades: [trade],
    });

  assert.equal(
    out.positionConflict,
    false
  );

  assert.equal(
    out.conflictSeverity,
    "NONE"
  );

  assert.equal(
    out.tradePosture,
    "LONG_FAVORING"
  );
});

test("MES real positions are treated as ES-family exposure", () => {
  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro(),
      openTrades: [
        shortTrade({
          accountMode: "REAL",
          qty: 3,
        }),
      ],
    });

  assert.equal(
    out.positions.length,
    1
  );

  assert.equal(
    out.positions[0].normalizedRoot,
    "ES"
  );

  assert.equal(
    out.positions[0].remainingQty,
    3
  );
});

test("non-ES-family trades are ignored", () => {
  const trade =
    shortTrade();

  trade.symbol = "NQ";
  trade.normalizedInstrumentRoot = "NQ";

  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro(),
      openTrades: [trade],
    });

  assert.equal(
    out.positionPresent,
    false
  );

  assert.equal(
    out.positions.length,
    0
  );
});

test("module is read-only and never mutates Engine10 trade objects", () => {
  const trade =
    shortTrade();

  const before =
    structuredClone(trade);

  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro(),
      openTrades: [trade],
    });

  assert.equal(
    out.noPositionMutation,
    true
  );

  assert.equal(
    out.noPermissionCreated,
    true
  );

  assert.equal(
    out.noJournalMutation,
    true
  );

  assert.deepEqual(
    trade,
    before
  );
});


test("REAL alert is suppressed when broker observer freshness is stale", () => {
  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro({
          microTimingState:
            "TIMING_READY",
        }),
      openTrades: [
        shortTrade({
          accountMode: "REAL",
        }),
      ],
      realFillObserverState: {
        accounts: {
          SCHWAB_6380: {
            journalAccount:
              "INTRADAY",
            lastSuccessfulPollAt:
              "2026-10-09T19:00:00Z",
          },
        },
      },
      evaluationTimeMs:
        Date.parse(
          "2026-10-09T20:00:00Z"
        ),
      realMaxStalenessSec:
        120,
    });

  assert.equal(
    out.positions[0]
      .positionTruthFreshness
      .status,
    "STALE"
  );

  assert.equal(
    out.alertsPreview.length,
    0
  );

  assert.equal(
    out.alertsSuppressed.length,
    1
  );

  assert.equal(
    out.alertsSuppressed[0].reason,
    "REAL_POSITION_TRUTH_NOT_FRESH"
  );
});

test("REAL alert becomes eligible only with fresh matching account watermark", () => {
  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro({
          microTimingState:
            "TIMING_READY",
        }),
      openTrades: [
        shortTrade({
          accountMode: "REAL",
        }),
      ],
      realFillObserverState: {
        accounts: {
          SCHWAB_6380: {
            journalAccount:
              "INTRADAY",
            lastSuccessfulPollAt:
              "2026-10-09T19:59:30Z",
          },
        },
      },
      evaluationTimeMs:
        Date.parse(
          "2026-10-09T20:00:00Z"
        ),
      realMaxStalenessSec:
        120,
    });

  assert.equal(
    out.positions[0]
      .positionTruthFreshness
      .status,
    "FRESH"
  );

  assert.equal(
    out.alertsPreview.length,
    1
  );
});

test("PAPER position alert freshness does not depend on Schwab observer", () => {
  const out =
    buildMicroPositionContext({
      engine22WaveStrategy:
        micro({
          microTimingState:
            "TIMING_READY",
        }),
      openTrades: [
        shortTrade({
          accountMode: "PAPER",
        }),
      ],
      realFillObserverState: null,
    });

  assert.equal(
    out.positions[0]
      .positionTruthFreshness
      .status,
    "NOT_REQUIRED"
  );

  assert.equal(
    out.alertsPreview.length,
    1
  );
});
