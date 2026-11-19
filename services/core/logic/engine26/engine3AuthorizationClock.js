// services/core/logic/engine26/engine3AuthorizationClock.js
// Engine 26-owned continuity clock for Engine 3 evaluation authorization.
//
// Production-safety contract:
// - Uses an Engine26-owned persistent-volume namespace by default.
// - engine3AuthorizationStartedAt is the first source as-of timestamp of the
//   current uninterrupted authorized run for the same (candidateId, zoneId).
// - It is independent of direction/contact and MUST NOT reuse
//   candidateLifecycleStartTime.
// - Any unauthorized/ineligible/terminal tick ends the run.
// - Candidate/zone identity change starts a new run.
// - State is atomically persisted and read back before source readiness is true.
// - Corrupt/unreadable state fails closed for continuity verification.
// - Historical/out-of-order evaluation is read-only and cannot rewind live state.

import fs from "node:fs";
import path from "node:path";

export const ENGINE26_PERSISTENT_STATE_ROOT =
  process.env.ENGINE26_PERSISTENT_STATE_ROOT ||
  "/var/data/engine26";

export const DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH =
  process.env.ENGINE26_ENGINE3_AUTHORIZATION_CLOCK_PATH ||
  path.join(
    ENGINE26_PERSISTENT_STATE_ROOT,
    "engine3-authorization-clock.json"
  );

const VERSION = "engine26.engine3AuthorizationClock.v2";

function normalizeIso(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function streamKey({ symbol, strategyId }) {
  return [
    String(symbol || "").toUpperCase(),
    String(strategyId || ""),
  ].join("::");
}

function emptyStore() {
  return {
    version: VERSION,
    records: {},
  };
}

function diagnostic(code, details = {}) {
  return {
    code,
    ...details,
  };
}

function readStore(filePath, fsOps = fs) {
  try {
    if (!fsOps.existsSync(filePath)) {
      return {
        ok: true,
        exists: false,
        bootstrap: true,
        status: "MISSING_BOOTSTRAP",
        store: emptyStore(),
        warnings: [
          diagnostic(
            "ENGINE26_ENGINE3_AUTH_CLOCK_BOOTSTRAP_NEW_STORE",
            { filePath }
          ),
        ],
      };
    }

    const raw = fsOps.readFileSync(filePath, "utf8");
    if (!String(raw || "").trim()) {
      return {
        ok: false,
        exists: true,
        bootstrap: false,
        status: "CORRUPT_EMPTY_STATE",
        store: null,
        warnings: [
          diagnostic(
            "ENGINE26_ENGINE3_AUTH_CLOCK_STATE_EMPTY",
            { filePath }
          ),
        ],
      };
    }

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !parsed.records ||
      typeof parsed.records !== "object" ||
      Array.isArray(parsed.records)
    ) {
      return {
        ok: false,
        exists: true,
        bootstrap: false,
        status: "CORRUPT_INVALID_STATE",
        store: null,
        warnings: [
          diagnostic(
            "ENGINE26_ENGINE3_AUTH_CLOCK_STATE_INVALID",
            { filePath }
          ),
        ],
      };
    }

    return {
      ok: true,
      exists: true,
      bootstrap: false,
      status: "READ_OK",
      store: {
        ...parsed,
        version: parsed.version || VERSION,
        records: { ...parsed.records },
      },
      warnings: [],
    };
  } catch (error) {
    return {
      ok: false,
      exists: true,
      bootstrap: false,
      status: "READ_FAILED",
      store: null,
      warnings: [
        diagnostic(
          "ENGINE26_ENGINE3_AUTH_CLOCK_READ_FAILED",
          {
            filePath,
            errorCode: error?.code || null,
            message:
              error instanceof Error
                ? error.message
                : String(error),
          }
        ),
      ],
    };
  }
}

function makeInjectedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function writeStoreAtomic({
  filePath,
  store,
  streamKeyValue = null,
  proposedRecord = null,
  fsOps = fs,
  faultInjection = null,
} = {}) {
  const directory = path.dirname(filePath);
  const lockPath = `${filePath}.lock`;
  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let lockFd = null;
  let lockOwned = false;
  let lockInode = null;

  try {
    fsOps.mkdirSync(directory, { recursive: true });

    if (faultInjection === "LOCK_HELD") {
      throw makeInjectedError(
        "EEXIST",
        "simulated concurrent writer lock"
      );
    }

    lockFd = fsOps.openSync(lockPath, "wx");
    lockOwned = true;

    try {
      const lockStat = fsOps.fstatSync(lockFd);
      lockInode = lockStat?.ino ?? null;
    } catch {}

    fsOps.writeFileSync(
      lockFd,
      JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }),
      "utf8"
    );

    /*
     * Re-read the durable head while holding the lock. The earlier read used
     * by resolveEngine3AuthorizationClock is only an observation. This locked
     * read is authoritative for deciding whether the proposed write is stale.
     */
    const lockedRead = readStore(filePath, fsOps);
    if (!lockedRead.ok) {
      throw makeInjectedError(
        "EREADBACK",
        `locked durable-head read failed: ${lockedRead.status}`
      );
    }

    if (streamKeyValue && proposedRecord) {
      const durableRecord =
        lockedRead.store?.records?.[streamKeyValue] || null;
      const durableAsOf =
        normalizeIso(durableRecord?.sourceAsOf);
      const proposedAsOf =
        normalizeIso(proposedRecord?.sourceAsOf);

      if (
        durableAsOf !== null &&
        proposedAsOf !== null &&
        durableAsOf > proposedAsOf
      ) {
        return {
          ok: false,
          status: "STALE_WRITE_BLOCKED",
          warnings: [
            diagnostic(
              "ENGINE26_ENGINE3_AUTH_CLOCK_STALE_WRITE_BLOCKED",
              {
                durableSourceAsOf: durableAsOf,
                proposedSourceAsOf: proposedAsOf,
              }
            ),
          ],
          durableStore:
            lockedRead.store,
        };
      }

      store = {
        ...lockedRead.store,
        version: VERSION,
        records: {
          ...(lockedRead.store?.records || {}),
          [streamKeyValue]: proposedRecord,
        },
      };
    }

    if (faultInjection === "EACCES_BEFORE_WRITE") {
      throw makeInjectedError(
        "EACCES",
        "simulated permission denied"
      );
    }

    if (faultInjection === "ENOSPC_BEFORE_WRITE") {
      throw makeInjectedError(
        "ENOSPC",
        "simulated disk full"
      );
    }

    fsOps.writeFileSync(
      temporaryPath,
      `${JSON.stringify(store, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
      }
    );

    if (faultInjection === "CRASH_AFTER_TEMP_WRITE") {
      throw makeInjectedError(
        "ECRASH",
        "simulated interruption after temp write"
      );
    }

    const tempFd = fsOps.openSync(temporaryPath, "r");
    try {
      if (typeof fsOps.fsyncSync === "function") {
        fsOps.fsyncSync(tempFd);
      }
    } finally {
      fsOps.closeSync(tempFd);
    }

    fsOps.renameSync(temporaryPath, filePath);

    if (faultInjection === "READBACK_CORRUPT") {
      throw makeInjectedError(
        "EREADBACK",
        "simulated independent readback failure"
      );
    }

    const readback = readStore(filePath, fsOps);
    if (!readback.ok) {
      throw makeInjectedError(
        "EREADBACK",
        `readback failed: ${readback.status}`
      );
    }

    const expected =
      JSON.stringify(store);
    const observed =
      JSON.stringify(readback.store);

    if (expected !== observed) {
      throw makeInjectedError(
        "EREADBACK",
        "readback verification mismatch"
      );
    }

    return {
      ok: true,
      status: "WRITE_READBACK_VERIFIED",
      warnings: [],
    };
  } catch (error) {
    return {
      ok: false,
      status:
        error?.code === "EEXIST"
          ? "CONCURRENT_WRITER_BLOCKED"
          : error?.code === "ENOSPC"
          ? "DISK_FULL"
          : error?.code === "EACCES"
          ? "PERMISSION_DENIED"
          : error?.code === "EREADBACK"
          ? "READBACK_FAILED"
          : error?.code === "ECRASH"
          ? "INTERRUPTED_WRITE"
          : "WRITE_FAILED",
      warnings: [
        diagnostic(
          "ENGINE26_ENGINE3_AUTH_CLOCK_WRITE_FAILED",
          {
            filePath,
            errorCode: error?.code || null,
            message:
              error instanceof Error
                ? error.message
                : String(error),
          }
        ),
      ],
    };
  } finally {
    try {
      if (
        temporaryPath &&
        fsOps.existsSync(temporaryPath)
      ) {
        fsOps.unlinkSync(temporaryPath);
      }
    } catch {}

    try {
      if (lockFd !== null) {
        fsOps.closeSync(lockFd);
      }
    } catch {}

    try {
      if (
        lockOwned === true &&
        fsOps.existsSync(lockPath)
      ) {
        let stillOwnsPath = true;

        if (lockInode !== null) {
          try {
            stillOwnsPath =
              fsOps.statSync(lockPath)?.ino ===
              lockInode;
          } catch {
            stillOwnsPath = false;
          }
        }

        if (stillOwnsPath) {
          fsOps.unlinkSync(lockPath);
        }
      }
    } catch {}
  }
}

export function resolveEngine3AuthorizationClock({
  symbol,
  strategyId,
  candidateId = null,
  zoneId = null,
  authorized = false,
  sourceAsOf,
  filePath = DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH,
  persist = true,
  fsOps = fs,
  faultInjection = null,
} = {}) {
  const normalizedAsOf = normalizeIso(sourceAsOf);
  const key = streamKey({ symbol, strategyId });
  const read = readStore(filePath, fsOps);

  if (!read.ok) {
    return {
      engine3AuthorizationStartedAt: null,
      engine3AuthorizationSourceAsOf: normalizedAsOf,
      engine3AuthorizationIdentity: {
        candidateId: candidateId || null,
        zoneId: zoneId || null,
      },
      engine3AuthorizationContinuous: false,
      engine3AuthorizationActive: authorized === true,
      engine3AuthorizationSourceReady: false,
      engine3AuthorizationStorageHealthy: false,
      engine3AuthorizationStorageStatus: read.status,
      engine3AuthorizationPersistenceMode:
        "FAIL_CLOSED_UNTRUSTED_STORAGE",
      engine3AuthorizationPersisted: false,
      engine3AuthorizationWarnings:
        read.warnings || [],
      record: null,
      store: null,
    };
  }

  const store = read.store || emptyStore();
  const previous = store.records?.[key] || null;

  const identityValid =
    Boolean(candidateId) &&
    Boolean(zoneId) &&
    Boolean(key) &&
    normalizedAsOf !== null;

  const runAuthorized =
    authorized === true && identityValid;

  const previousSourceAsOf =
    normalizeIso(previous?.sourceAsOf);
  const previousStartedAt =
    normalizeIso(previous?.engine3AuthorizationStartedAt);

  const historicalEvaluation =
    previousSourceAsOf !== null &&
    normalizedAsOf !== null &&
    previousSourceAsOf > normalizedAsOf;

  const sameUninterruptedRun =
    runAuthorized &&
    !historicalEvaluation &&
    previous?.active === true &&
    previous?.candidateId === candidateId &&
    previous?.zoneId === zoneId &&
    previousStartedAt !== null;

  const proposedStartedAt =
    runAuthorized
      ? (
          sameUninterruptedRun
            ? previousStartedAt
            : normalizedAsOf
        )
      : null;

  const record = {
    symbol: String(symbol || "").toUpperCase(),
    strategyId: String(strategyId || ""),
    candidateId: candidateId || null,
    zoneId: zoneId || null,
    active: runAuthorized,
    engine3AuthorizationStartedAt:
      proposedStartedAt,
    sourceAsOf: normalizedAsOf,
    lastAuthorizedAsOf:
      runAuthorized
        ? normalizedAsOf
        : previous?.lastAuthorizedAsOf || null,
    endedAt:
      runAuthorized
        ? null
        : normalizedAsOf,
  };

  const nextStore = {
    ...store,
    version: VERSION,
    records: {
      ...(store.records || {}),
      [key]: record,
    },
  };

  /*
   * Historical/replay evaluations are intentionally read-only when the
   * durable head is newer. This is the monotonic fence that prevents replay
   * from rewinding live continuity storage.
   */
  if (historicalEvaluation) {
    return {
      engine3AuthorizationStartedAt:
        proposedStartedAt,
      engine3AuthorizationSourceAsOf:
        normalizedAsOf,
      engine3AuthorizationIdentity: {
        candidateId: candidateId || null,
        zoneId: zoneId || null,
      },
      engine3AuthorizationContinuous: false,
      engine3AuthorizationActive: runAuthorized,
      engine3AuthorizationSourceReady: false,
      engine3AuthorizationStorageHealthy: true,
      engine3AuthorizationStorageStatus:
        "HISTORICAL_READ_ONLY",
      engine3AuthorizationPersistenceMode:
        "READ_ONLY_HISTORICAL",
      engine3AuthorizationPersisted: false,
      engine3AuthorizationWarnings: [
        diagnostic(
          "ENGINE26_ENGINE3_AUTH_CLOCK_MONOTONIC_WRITE_FENCE",
          {
            durableSourceAsOf:
              previousSourceAsOf,
            evaluationSourceAsOf:
              normalizedAsOf,
          }
        ),
      ],
      record,
      store,
    };
  }

  if (!persist) {
    return {
      engine3AuthorizationStartedAt:
        proposedStartedAt,
      engine3AuthorizationSourceAsOf:
        normalizedAsOf,
      engine3AuthorizationIdentity: {
        candidateId: candidateId || null,
        zoneId: zoneId || null,
      },
      engine3AuthorizationContinuous:
        sameUninterruptedRun,
      engine3AuthorizationActive: runAuthorized,
      engine3AuthorizationSourceReady: false,
      engine3AuthorizationStorageHealthy: true,
      engine3AuthorizationStorageStatus:
        "READ_ONLY_NOT_PERSISTED",
      engine3AuthorizationPersistenceMode:
        "READ_ONLY",
      engine3AuthorizationPersisted: false,
      engine3AuthorizationWarnings:
        read.warnings || [],
      record,
      store,
    };
  }

  const write = writeStoreAtomic({
    filePath,
    store: nextStore,
    streamKeyValue: key,
    proposedRecord: record,
    fsOps,
    faultInjection,
  });

  if (!write.ok) {
    return {
      engine3AuthorizationStartedAt: null,
      engine3AuthorizationSourceAsOf:
        normalizedAsOf,
      engine3AuthorizationIdentity: {
        candidateId: candidateId || null,
        zoneId: zoneId || null,
      },
      engine3AuthorizationContinuous: false,
      engine3AuthorizationActive: runAuthorized,
      engine3AuthorizationSourceReady: false,
      engine3AuthorizationStorageHealthy: false,
      engine3AuthorizationStorageStatus:
        write.status,
      engine3AuthorizationPersistenceMode:
        write.status === "STALE_WRITE_BLOCKED"
          ? "READ_ONLY_STALE_WRITER"
          : "FAIL_CLOSED_WRITE_FAILURE",
      engine3AuthorizationPersisted: false,
      engine3AuthorizationWarnings: [
        ...(read.warnings || []),
        ...(write.warnings || []),
      ],
      record: null,
      store,
    };
  }

  return {
    engine3AuthorizationStartedAt:
      proposedStartedAt,
    engine3AuthorizationSourceAsOf:
      normalizedAsOf,
    engine3AuthorizationIdentity: {
      candidateId: candidateId || null,
      zoneId: zoneId || null,
    },
    engine3AuthorizationContinuous:
      sameUninterruptedRun,
    engine3AuthorizationActive: runAuthorized,
    engine3AuthorizationSourceReady: true,
    engine3AuthorizationStorageHealthy: true,
    engine3AuthorizationStorageStatus:
      read.bootstrap
        ? "BOOTSTRAP_WRITE_VERIFIED"
        : "WRITE_READBACK_VERIFIED",
    engine3AuthorizationPersistenceMode:
      "PERSISTENT_MONOTONIC",
    engine3AuthorizationPersisted: true,
    engine3AuthorizationWarnings:
      read.warnings || [],
    record,
    store: nextStore,
  };
}

export default resolveEngine3AuthorizationClock;
