// services/core/tests/engine26Engine3AuthorizationClock.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveEngine3AuthorizationClock,
  DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH,
} from "../logic/engine26/engine3AuthorizationClock.js";

import {
  buildEngine26ReactionHandoff,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

function candidate(overrides = {}) {
  return {
    active: true,
    candidateId: "C1",
    zoneId: "Z1",
    laneId: "minute",
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    timeframe: "10m",
    snapshotTime: "2026-11-18T13:00:00.000Z",
    status: "LOCATION_DETECTED",
    directionBias: "NEUTRAL",
    directionState: "NEUTRAL",
    contactState: null,
    chainArmed: false,
    strategyEligibility: {
      eligible: true,
    },
    zoneMemorySummary: {
      lifecycleStatus: "ACTIVE",
    },
    location: {
      distancePoints: 0,
    },
    activationRangePoints: 4,
    expectedReactions: [],
    sourceRefs: [],
    ...overrides,
  };
}

function makeClockPath() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "engine26-engine3-auth-")
  );
  return {
    dir,
    filePath: path.join(dir, "clock.json"),
  };
}

function resolveFromCandidate({
  locationCandidate,
  sourceAsOf,
  filePath,
}) {
  const handoff = buildEngine26ReactionHandoff({
    locationCandidate: {
      ...locationCandidate,
      snapshotTime: sourceAsOf,
    },
    snapshotTime: sourceAsOf,
  });

  const clock = resolveEngine3AuthorizationClock({
    symbol: locationCandidate.symbol,
    strategyId: locationCandidate.strategyId,
    candidateId: locationCandidate.candidateId,
    zoneId: locationCandidate.zoneId,
    authorized:
      handoff.authorizeEngine3Evaluation === true,
    sourceAsOf,
    filePath,
    persist: true,
  });

  return {
    handoff,
    clock,
  };
}

test(
  "Engine26 authorization clock preserves the earliest as-of for one uninterrupted authorized identity across restart",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      const first = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      assert.equal(
        first.handoff.authorizeEngine3Evaluation,
        true
      );
      assert.equal(
        first.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:00:00.000Z"
      );
      assert.equal(
        first.clock.engine3AuthorizationContinuous,
        false
      );
      assert.equal(
        first.clock.engine3AuthorizationSourceReady,
        true
      );
      assert.equal(
        first.clock.engine3AuthorizationStorageStatus,
        "BOOTSTRAP_WRITE_VERIFIED"
      );
      assert.equal(
        first.clock.engine3AuthorizationPersisted,
        true
      );

      const second = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        second.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:00:00.000Z"
      );
      assert.equal(
        second.clock.engine3AuthorizationContinuous,
        true
      );

      // A fresh function call re-reads persisted state, simulating process restart.
      const afterRestart = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:02:00.000Z",
        filePath,
      });

      assert.equal(
        afterRestart.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:00:00.000Z"
      );
      assert.equal(
        afterRestart.clock.engine3AuthorizationSourceAsOf,
        "2026-11-18T13:02:00.000Z"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 resets authorization continuity on ineligible interruption and reauthorization",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      const interrupted = resolveFromCandidate({
        locationCandidate: candidate({
          strategyEligibility: {
            eligible: false,
          },
        }),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        interrupted.handoff.authorizeEngine3Evaluation,
        false
      );
      assert.equal(
        interrupted.clock.engine3AuthorizationStartedAt,
        null
      );
      assert.equal(
        interrupted.clock.engine3AuthorizationActive,
        false
      );

      const reauthorized = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:02:00.000Z",
        filePath,
      });

      assert.equal(
        reauthorized.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:02:00.000Z"
      );
      assert.equal(
        reauthorized.clock.engine3AuthorizationContinuous,
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 resets authorization continuity on candidate or zone identity change",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      const candidateChanged = resolveFromCandidate({
        locationCandidate: candidate({
          candidateId: "C2",
        }),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        candidateChanged.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:01:00.000Z"
      );

      const zoneChanged = resolveFromCandidate({
        locationCandidate: candidate({
          candidateId: "C2",
          zoneId: "Z2",
        }),
        sourceAsOf: "2026-11-18T13:02:00.000Z",
        filePath,
      });

      assert.equal(
        zoneChanged.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:02:00.000Z"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 terminal lifecycle ends authorization and requires a fresh run after terminal clears",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      const terminal = resolveFromCandidate({
        locationCandidate: candidate({
          zoneMemorySummary: {
            lifecycleStatus: "COMPLETED",
          },
        }),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        terminal.handoff.terminalLifecycle,
        true
      );
      assert.equal(
        terminal.handoff.authorizeEngine3Evaluation,
        false
      );
      assert.equal(
        terminal.clock.engine3AuthorizationStartedAt,
        null
      );

      const fresh = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:02:00.000Z",
        filePath,
      });

      assert.equal(
        fresh.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:02:00.000Z"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 authorization continuity is independent of direction and negotiated-line contact",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate({
          directionBias: "SHORT",
          directionState:
            "SHORT_DIRECTIONAL_CHILD_ACTIVE",
        }),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      const neutralContact = resolveFromCandidate({
        locationCandidate: candidate({
          directionBias: "NEUTRAL",
          directionState: "NEUTRAL",
          contactState:
            "NEGOTIATED_LINE_CONTACT",
          chainArmed: true,
        }),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        neutralContact.handoff.authorizeEngine3Evaluation,
        true
      );
      assert.equal(
        neutralContact.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:00:00.000Z"
      );
      assert.equal(
        neutralContact.clock.engine3AuthorizationContinuous,
        true
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 authorization clock never uses a future persisted record to backdate an older as-of evaluation",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T14:00:00.000Z",
        filePath,
      });

      const historicalAsOf = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:30:00.000Z",
        filePath,
      });

      assert.equal(
        historicalAsOf.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:30:00.000Z"
      );
      assert.equal(
        historicalAsOf.clock.engine3AuthorizationSourceAsOf,
        "2026-11-18T13:30:00.000Z"
      );
      assert.equal(
        historicalAsOf.clock.engine3AuthorizationContinuous,
        false
      );
      assert.equal(
        historicalAsOf.clock.engine3AuthorizationPersistenceMode,
        "READ_ONLY_HISTORICAL"
      );
      assert.equal(
        historicalAsOf.clock.engine3AuthorizationPersisted,
        false
      );
      assert.equal(
        historicalAsOf.clock.engine3AuthorizationSourceReady,
        false
      );

      const durable = JSON.parse(
        fs.readFileSync(filePath, "utf8")
      );
      const durableRecord =
        durable.records["ES::intraday_scalp@10m"];
      assert.equal(
        durableRecord.sourceAsOf,
        "2026-11-18T14:00:00.000Z"
      );
      assert.equal(
        durableRecord.engine3AuthorizationStartedAt,
        "2026-11-18T14:00:00.000Z"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 reaction handoff publishes source-owned authorization timestamp and identity without substituting candidate lifecycle time",
  () => {
    const handoff = buildEngine26ReactionHandoff({
      locationCandidate: candidate({
        candidateLifecycleStartTime:
          "2026-11-18T12:00:00.000Z",
        engine3AuthorizationStartedAt:
          "2026-11-18T13:00:00.000Z",
        engine3AuthorizationSourceAsOf:
          "2026-11-18T13:05:00.000Z",
        engine3AuthorizationIdentity: {
          candidateId: "C1",
          zoneId: "Z1",
        },
        engine3AuthorizationContinuous: true,
        engine3AuthorizationActive: true,
      }),
      snapshotTime:
        "2026-11-18T13:05:00.000Z",
    });

    assert.equal(
      handoff.authorizeEngine3Evaluation,
      true
    );
    assert.equal(
      handoff.candidateLifecycleStartTime,
      "2026-11-18T12:00:00.000Z"
    );
    assert.equal(
      handoff.engine3AuthorizationStartedAt,
      "2026-11-18T13:00:00.000Z"
    );
    assert.equal(
      handoff.engine3AuthorizationSourceAsOf,
      "2026-11-18T13:05:00.000Z"
    );
    assert.deepEqual(
      handoff.engine3AuthorizationIdentity,
      {
        candidateId: "C1",
        zoneId: "Z1",
      }
    );
  }
);


test(
  "Engine26 authorization clock defaults to the Engine26 persistent-volume namespace",
  () => {
    assert.equal(
      DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH,
      process.env.ENGINE26_ENGINE3_AUTHORIZATION_CLOCK_PATH ||
        path.join(
          process.env.ENGINE26_PERSISTENT_STATE_ROOT ||
            "/var/data/engine26",
          "engine3-authorization-clock.json"
        )
    );
    assert.match(
      DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH,
      /^\/var\/data\/engine26\//
    );
    assert.doesNotMatch(
      DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH,
      /\/replay\//
    );
  }
);

test(
  "Engine26 corrupt authorization state fails closed and is not silently overwritten",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      fs.writeFileSync(
        filePath,
        "{not-json",
        "utf8"
      );

      const result = resolveEngine3AuthorizationClock({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        candidateId: "C1",
        zoneId: "Z1",
        authorized: true,
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
        persist: true,
      });

      assert.equal(
        result.engine3AuthorizationStartedAt,
        null
      );
      assert.equal(
        result.engine3AuthorizationSourceReady,
        false
      );
      assert.equal(
        result.engine3AuthorizationStorageHealthy,
        false
      );
      assert.equal(
        result.engine3AuthorizationPersistenceMode,
        "FAIL_CLOSED_UNTRUSTED_STORAGE"
      );
      assert.equal(
        fs.readFileSync(filePath, "utf8"),
        "{not-json"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

for (const faultCase of [
  ["ENOSPC_BEFORE_WRITE", "DISK_FULL"],
  ["EACCES_BEFORE_WRITE", "PERMISSION_DENIED"],
  ["CRASH_AFTER_TEMP_WRITE", "INTERRUPTED_WRITE"],
  ["LOCK_HELD", "CONCURRENT_WRITER_BLOCKED"],
  ["READBACK_CORRUPT", "READBACK_FAILED"],
]) {
  test(
    `Engine26 authorization persistence fails closed for ${faultCase[0]}`,
    () => {
      const { dir, filePath } = makeClockPath();
      try {
        const result = resolveEngine3AuthorizationClock({
          symbol: "ES",
          strategyId: "intraday_scalp@10m",
          candidateId: "C1",
          zoneId: "Z1",
          authorized: true,
          sourceAsOf: "2026-11-18T13:00:00.000Z",
          filePath,
          persist: true,
          faultInjection: faultCase[0],
        });

        assert.equal(
          result.engine3AuthorizationStartedAt,
          null
        );
        assert.equal(
          result.engine3AuthorizationSourceReady,
          false
        );
        assert.equal(
          result.engine3AuthorizationStorageHealthy,
          false
        );
        assert.equal(
          result.engine3AuthorizationStorageStatus,
          faultCase[1]
        );
        assert.equal(
          result.engine3AuthorizationPersisted,
          false
        );

        const leftovers = fs
          .readdirSync(dir)
          .filter(
            (name) =>
              name.endsWith(".tmp") ||
              name.endsWith(".lock")
          );
        assert.deepEqual(leftovers, []);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );
}

test(
  "Engine26 handoff exposes consumer-readable storage health metadata",
  () => {
    const handoff = buildEngine26ReactionHandoff({
      locationCandidate: candidate({
        engine3AuthorizationStartedAt:
          "2026-11-18T13:00:00.000Z",
        engine3AuthorizationSourceAsOf:
          "2026-11-18T13:05:00.000Z",
        engine3AuthorizationIdentity: {
          candidateId: "C1",
          zoneId: "Z1",
        },
        engine3AuthorizationContinuous: true,
        engine3AuthorizationActive: true,
        engine3AuthorizationSourceReady: true,
        engine3AuthorizationStorageHealthy: true,
        engine3AuthorizationStorageStatus:
          "WRITE_READBACK_VERIFIED",
        engine3AuthorizationPersistenceMode:
          "PERSISTENT_MONOTONIC",
        engine3AuthorizationPersisted: true,
        engine3AuthorizationWarnings: [],
      }),
      snapshotTime:
        "2026-11-18T13:05:00.000Z",
    });

    assert.equal(
      handoff.engine3AuthorizationSourceReady,
      true
    );
    assert.equal(
      handoff.engine3AuthorizationStorageHealthy,
      true
    );
    assert.equal(
      handoff.engine3AuthorizationStorageStatus,
      "WRITE_READBACK_VERIFIED"
    );
    assert.equal(
      handoff.engine3AuthorizationPersistenceMode,
      "PERSISTENT_MONOTONIC"
    );
    assert.equal(
      handoff.engine3AuthorizationPersisted,
      true
    );
  }
);


test(
  "Engine26 blocked writer never removes a real lock owned by another process",
  () => {
    const { dir, filePath } = makeClockPath();
    const lockPath = `${filePath}.lock`;
    try {
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: 999999,
          owner: "OTHER_PROCESS",
        }),
        "utf8"
      );
      const originalLock =
        fs.readFileSync(lockPath, "utf8");

      const result = resolveEngine3AuthorizationClock({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        candidateId: "C1",
        zoneId: "Z1",
        authorized: true,
        sourceAsOf:
          "2026-11-18T13:00:00.000Z",
        filePath,
        persist: true,
      });

      assert.equal(
        result.engine3AuthorizationSourceReady,
        false
      );
      assert.equal(
        result.engine3AuthorizationStorageStatus,
        "CONCURRENT_WRITER_BLOCKED"
      );
      assert.equal(
        fs.existsSync(lockPath),
        true
      );
      assert.equal(
        fs.readFileSync(lockPath, "utf8"),
        originalLock
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 rechecks durable head under its lock and blocks a stale writer race",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveEngine3AuthorizationClock({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        candidateId: "C1",
        zoneId: "Z1",
        authorized: true,
        sourceAsOf:
          "2026-11-18T13:00:00.000Z",
        filePath,
        persist: true,
      });

      let injected = false;
      const fsOps = {
        existsSync: (...args) =>
          fs.existsSync(...args),
        readFileSync: (...args) =>
          fs.readFileSync(...args),
        mkdirSync: (...args) =>
          fs.mkdirSync(...args),
        writeFileSync: (...args) =>
          fs.writeFileSync(...args),
        fsyncSync: (...args) =>
          fs.fsyncSync(...args),
        closeSync: (...args) =>
          fs.closeSync(...args),
        renameSync: (...args) =>
          fs.renameSync(...args),
        unlinkSync: (...args) =>
          fs.unlinkSync(...args),
        statSync: (...args) =>
          fs.statSync(...args),
        fstatSync: (...args) =>
          fs.fstatSync(...args),
        openSync: (target, flags, ...rest) => {
          if (
            !injected &&
            target === `${filePath}.lock` &&
            flags === "wx"
          ) {
            injected = true;
            const durable = JSON.parse(
              fs.readFileSync(filePath, "utf8")
            );
            const key =
              "ES::intraday_scalp@10m";
            durable.records[key] = {
              ...durable.records[key],
              engine3AuthorizationStartedAt:
                "2026-11-18T14:00:00.000Z",
              sourceAsOf:
                "2026-11-18T14:00:00.000Z",
              lastAuthorizedAsOf:
                "2026-11-18T14:00:00.000Z",
            };
            fs.writeFileSync(
              filePath,
              `${JSON.stringify(
                durable,
                null,
                2
              )}\n`,
              "utf8"
            );
          }
          return fs.openSync(
            target,
            flags,
            ...rest
          );
        },
      };

      const stale = resolveEngine3AuthorizationClock({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        candidateId: "C1",
        zoneId: "Z1",
        authorized: true,
        sourceAsOf:
          "2026-11-18T13:30:00.000Z",
        filePath,
        persist: true,
        fsOps,
      });

      assert.equal(
        stale.engine3AuthorizationSourceReady,
        false
      );
      assert.equal(
        stale.engine3AuthorizationStorageStatus,
        "STALE_WRITE_BLOCKED"
      );
      assert.equal(
        stale.engine3AuthorizationPersistenceMode,
        "READ_ONLY_STALE_WRITER"
      );

      const durable = JSON.parse(
        fs.readFileSync(filePath, "utf8")
      );
      const record =
        durable.records["ES::intraday_scalp@10m"];

      assert.equal(
        record.sourceAsOf,
        "2026-11-18T14:00:00.000Z"
      );
      assert.equal(
        record.engine3AuthorizationStartedAt,
        "2026-11-18T14:00:00.000Z"
      );
      assert.equal(
        fs.existsSync(`${filePath}.lock`),
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
