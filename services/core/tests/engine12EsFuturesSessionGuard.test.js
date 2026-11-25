// services/core/tests/engine12EsFuturesSessionGuard.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  evaluateEsFuturesSession,
  runReplayArchive,
} from "../jobs/archiveEsReplaySnapshot.js";

function utc(value) {
  return new Date(value);
}

function makeSource({
  markerActive = false,
} = {}) {
  return {
    ok: true,
    schema: "strategy.snapshot.test.v1",
    generatedAtUtc: "2026-07-27T20:00:00.000Z",
    snapshotTime: "2026-07-27T20:00:00.000Z",
    symbol: "ES",
    strategies: {
      "intraday_scalp@10m": {
        strategyId: "intraday_scalp@10m",
        analytics: {
          engine5: {
            duplicated: true,
          },
        },
        confluence: {
          preserved: true,
        },
        permission: {
          paper: {
            decision: "PAPER_STAND_DOWN",
            allowed: false,
          },
        },
        engine22Scalp: {
          preserved: true,
        },
        engine22WaveStrategy: {
          preserved: true,
        },
        engine26PaperTradePlan: {
          preserved: true,
        },
        engine26ReplayMarker:
          markerActive
            ? {
                active: true,
                symbol: "ES",
                strategyId: "intraday_scalp@10m",
                dateYmd: "2026-07-27",
                timeHHMM: "1318",
                markerType: "TEST_MARKER",
                status: "TEST",
                dedupeKey: "TEST|MARKER",
              }
            : null,
        strategyTimeline: {
          preserved: true,
        },
      },
      "subminute_scalp@10m": {
        laneId: "subminute",
        strategyId: "subminute_scalp@10m",
        engine15Required: false,
        engine15Bypassed: true,
      },
    },
  };
}

function makeTempFixture(
  sourceOptions = {}
) {
  const tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine12-session-"
      )
    );

  const sourceFile =
    path.join(
      tempRoot,
      "strategy-snapshot-es.json"
    );

  const replayRoot =
    path.join(
      tempRoot,
      "replay",
      "es"
    );

  const markerIndexFile =
    path.join(
      replayRoot,
      "markers",
      "engine26-replay-markers.jsonl"
    );

  fs.writeFileSync(
    sourceFile,
    JSON.stringify(
      makeSource(
        sourceOptions
      ),
      null,
      2
    ),
    "utf8"
  );

  return {
    tempRoot,
    sourceFile,
    replayRoot,
    markerIndexFile,
  };
}

const cases = [
  // Central Daylight Time (Arizona = Chicago - 2 hours)
  ["CDT Sunday 2:59:59 PM AZ closed", "2026-07-26T21:59:59.000Z", false],
  ["CDT Sunday 3:00:00 PM AZ open", "2026-07-26T22:00:00.000Z", true],

  ["CDT Monday 1:59:59 PM AZ open", "2026-07-27T20:59:59.000Z", true],
  ["CDT Monday 2:00:00 PM AZ closed", "2026-07-27T21:00:00.000Z", false],
  ["CDT Monday 2:59:59 PM AZ closed", "2026-07-27T21:59:59.000Z", false],
  ["CDT Monday 3:00:00 PM AZ open", "2026-07-27T22:00:00.000Z", true],

  ["CDT Friday 1:59:59 PM AZ open", "2026-07-31T20:59:59.000Z", true],
  ["CDT Friday 2:00:00 PM AZ closed", "2026-07-31T21:00:00.000Z", false],

  ["CDT Saturday noon AZ closed", "2026-08-01T19:00:00.000Z", false],

  // Central Standard Time (Arizona = Chicago - 1 hour)
  ["CST Sunday 3:59:59 PM AZ closed", "2026-11-08T22:59:59.000Z", false],
  ["CST Sunday 4:00:00 PM AZ open", "2026-11-08T23:00:00.000Z", true],

  ["CST Monday 2:59:59 PM AZ open", "2026-11-09T21:59:59.000Z", true],
  ["CST Monday 3:00:00 PM AZ closed", "2026-11-09T22:00:00.000Z", false],
  ["CST Monday 3:59:59 PM AZ closed", "2026-11-09T22:59:59.000Z", false],
  ["CST Monday 4:00:00 PM AZ open", "2026-11-09T23:00:00.000Z", true],

  ["CST Friday 2:59:59 PM AZ open", "2026-11-13T21:59:59.000Z", true],
  ["CST Friday 3:00:00 PM AZ closed", "2026-11-13T22:00:00.000Z", false],
];

for (
  const [
    name,
    iso,
    expectedOpen,
  ] of cases
) {
  test(
    name,
    () => {
      const result =
        evaluateEsFuturesSession(
          utc(iso)
        );

      assert.equal(
        result.open,
        expectedOpen
      );

      assert.equal(
        result.exchangeTimezone,
        "America/Chicago"
      );

      assert.equal(
        result.arizonaTimezone,
        "America/Phoenix"
      );

      assert.equal(
        result.sessionContract,
        "STANDARD_WEEKLY_SESSION_ONLY"
      );

      assert.equal(
        result.holidayOverrideStatus,
        "CME_HOLIDAY_OVERRIDES_NOT_IMPLEMENTED"
      );
    }
  );
}

test(
  "closed session is a non-error skip and creates no Replay artifacts",
  () => {
    const fixture =
      makeTempFixture({
        markerActive: true,
      });

    try {
      const result =
        runReplayArchive({
          now:
            utc(
              "2026-07-27T21:30:00.000Z"
            ),
          sourceFile:
            fixture.sourceFile,
          replayRoot:
            fixture.replayRoot,
          markerIndexFile:
            fixture.markerIndexFile,
        });

      assert.equal(
        result.ok,
        true
      );

      assert.equal(
        result.replayWritten,
        false
      );

      assert.equal(
        result.skipped,
        true
      );

      assert.equal(
        result.reason,
        "ES_FUTURES_SESSION_CLOSED"
      );

      assert.equal(
        result.sessionState,
        "MAINTENANCE_BREAK"
      );

      assert.equal(
        fs.existsSync(
          fixture.replayRoot
        ),
        false
      );

      assert.equal(
        fs.existsSync(
          fixture.markerIndexFile
        ),
        false
      );

      const temporaryFiles =
        fs.existsSync(
          fixture.tempRoot
        )
          ? fs
              .readdirSync(
                fixture.tempRoot,
                {
                  recursive: true,
                }
              )
              .filter(
                (name) =>
                  String(name)
                    .includes(
                      ".tmp."
                    )
              )
          : [];

      assert.deepEqual(
        temporaryFiles,
        []
      );
    } finally {
      fs.rmSync(
        fixture.tempRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "open session writes compact Replay and removes only analytics.engine5",
  () => {
    const fixture =
      makeTempFixture();

    try {
      const now =
        utc(
          "2026-07-27T20:18:00.000Z"
        );

      const result =
        runReplayArchive({
          now,
          sourceFile:
            fixture.sourceFile,
          replayRoot:
            fixture.replayRoot,
          markerIndexFile:
            fixture.markerIndexFile,
        });

      assert.equal(
        result.ok,
        true
      );

      assert.equal(
        result.replayWritten,
        true
      );

      const text =
        fs.readFileSync(
          result.file,
          "utf8"
        );

      const replay =
        JSON.parse(
          text
        );

      assert.equal(
        text,
        JSON.stringify(
          replay
        )
      );

      const strategy =
        replay
          .strategies
          ["intraday_scalp@10m"];

      assert.equal(
        strategy.analytics,
        undefined
      );

      assert.deepEqual(
        strategy.confluence,
        {
          preserved: true,
        }
      );

      assert.deepEqual(
        strategy.engine22Scalp,
        {
          preserved: true,
        }
      );

      assert.deepEqual(
        strategy.engine22WaveStrategy,
        {
          preserved: true,
        }
      );

      assert.deepEqual(
        strategy.engine26PaperTradePlan,
        {
          preserved: true,
        }
      );

      assert.deepEqual(
        strategy.strategyTimeline,
        {
          preserved: true,
        }
      );

      const duplicate =
        runReplayArchive({
          now,
          sourceFile:
            fixture.sourceFile,
          replayRoot:
            fixture.replayRoot,
          markerIndexFile:
            fixture.markerIndexFile,
        });

      assert.equal(
        duplicate.replayWritten,
        false
      );

      assert.equal(
        duplicate.reason,
        "DUPLICATE_REPLAY_BLOCKED"
      );

      assert.equal(
        duplicate.existingFilePreserved,
        true
      );
    } finally {
      fs.rmSync(
        fixture.tempRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
