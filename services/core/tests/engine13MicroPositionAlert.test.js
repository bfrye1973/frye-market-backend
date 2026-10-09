import test from "node:test";
import assert from "node:assert/strict";

import {
  decideMicroPositionAlerts,
} from "../jobs/alertMicroPositionConflict.js";

function context({
  severity = "HIGH",
  conflict = true,
  timing = "TRANSITION_CONFIRMING",
  qty = 2,
  fresh = true,
} = {}) {
  return {
    engine:
      "micro.positionAwareness.v1",
    sourceCountId:
      "COUNT-1",
    micro: {
      activeWave: "W3",
      tradeDirection: "LONG",
      microTimingState:
        timing,
    },
    positions: [
      {
        tradeId: "T1",
        accountMode: "REAL",
        journalAccount: "INTRADAY",
        direction: "SHORT",
        remainingQty: qty,
        averageEntry: 7840,
        conflict,
        conflictSeverity:
          severity,
        doNotAddAgainstImpulse:
          ["HIGH", "CRITICAL"].includes(
            severity
          ),
        positionTruthFreshness: {
          status:
            fresh
              ? "FRESH"
              : "STALE",
          reliableForAlerts:
            fresh,
        },
        alertPreview: {
          eligible:
            fresh &&
            ["MODERATE", "HIGH", "CRITICAL"].includes(
              severity
            ),
          severity,
          message:
            "I see you are SHORT while Micro is turning UP.",
        },
      },
    ],
  };
}

test("first HIGH conflict produces one alert event", () => {
  const out =
    decideMicroPositionAlerts({
      context:
        context(),
      ledger: {
        entries: {},
      },
      now:
        Date.parse(
          "2026-10-09T20:00:00Z"
        ),
      minIntervalSec: 60,
    });

  assert.equal(
    out.events.length,
    1
  );

  assert.equal(
    out.events[0].severity,
    "HIGH"
  );
});

test("same canonical conflict signature dedupes", () => {
  const ctx =
    context();

  const first =
    decideMicroPositionAlerts({
      context: ctx,
      ledger: {
        entries: {},
      },
      now:
        Date.parse(
          "2026-10-09T20:00:00Z"
        ),
      minIntervalSec: 0,
    });

  const event =
    first.events[0];

  const second =
    decideMicroPositionAlerts({
      context: ctx,
      ledger: {
        entries: {
          [event.key]: {
            lastSeverity:
              "HIGH",
            lastSignature:
              event.signature,
            lastSentAtUtc:
              "2026-10-09T20:00:00Z",
          },
        },
      },
      now:
        Date.parse(
          "2026-10-09T20:03:00Z"
        ),
      minIntervalSec: 0,
    });

  assert.equal(
    second.events.length,
    0
  );
});

test("severity upgrade bypasses rate limit", () => {
  const prior =
    decideMicroPositionAlerts({
      context:
        context({
          severity:
            "HIGH",
        }),
      ledger: {
        entries: {},
      },
      now:
        Date.parse(
          "2026-10-09T20:00:00Z"
        ),
      minIntervalSec: 60,
    }).events[0];

  const next =
    decideMicroPositionAlerts({
      context:
        context({
          severity:
            "CRITICAL",
          timing:
            "TIMING_READY",
        }),
      ledger: {
        entries: {
          [prior.key]: {
            lastSeverity:
              "HIGH",
            lastSignature:
              prior.signature,
            lastSentAtUtc:
              "2026-10-09T20:00:00Z",
          },
        },
      },
      now:
        Date.parse(
          "2026-10-09T20:00:10Z"
        ),
      minIntervalSec: 60,
    });

  assert.equal(
    next.events.length,
    1
  );

  assert.equal(
    next.events[0]
      .severityUpgrade,
    true
  );
});

test("stale REAL position truth cannot create an alert event", () => {
  const out =
    decideMicroPositionAlerts({
      context:
        context({
          fresh: false,
        }),
      ledger: {
        entries: {},
      },
      now:
        Date.parse(
          "2026-10-09T20:00:00Z"
        ),
    });

  assert.equal(
    out.events.length,
    0
  );
});

test("resolved conflict emits one resolution event after prior alert", () => {
  const active =
    decideMicroPositionAlerts({
      context:
        context(),
      ledger: {
        entries: {},
      },
      now:
        Date.parse(
          "2026-10-09T20:00:00Z"
        ),
      minIntervalSec: 0,
    }).events[0];

  const resolved =
    decideMicroPositionAlerts({
      context:
        context({
          severity: "NONE",
          conflict: false,
        }),
      ledger: {
        entries: {
          [active.key]: {
            lastSeverity:
              "HIGH",
            lastSignature:
              active.signature,
            lastSentAtUtc:
              "2026-10-09T20:00:00Z",
          },
        },
      },
      now:
        Date.parse(
          "2026-10-09T20:05:00Z"
        ),
      minIntervalSec: 0,
    });

  assert.equal(
    resolved.events.length,
    1
  );

  assert.equal(
    resolved.events[0]
      .eventType,
    "CONFLICT_RESOLVED"
  );
});
