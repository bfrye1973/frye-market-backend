// services/core/logic/trading/schwab/engine8RealFillStore.js
// Engine 8 — durable broker-observation/delivery ledger for REAL Schwab fills.
//
// State ownership:
// - broker fill dedupe/delivery observations
// - explicit production bootstrap boundary
// - per-account restart/recovery watermarks
//
// Backward compatibility:
// - v1 persisted state used: records
// - v2 persisted state uses: observations
// - v1 records are migrated by shape only; broker meaning is never changed
//
// This store contains no Schwab account hash, OAuth token, broker credential,
// tradeId authority, contractId authority, or FIFO contract lifecycle.

import fs from "fs";
import path from "path";
import { getSchwabConfig } from "./schwabConfig.js";

const STATE_ENGINE = "engine8.schwabRealFillObserverState.v2";
const STATE_CONTRACT = "engine8.schwabRealFillObserverState.v2";

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function validIso(value) {
  const normalized = text(value);

  return normalized && Number.isFinite(Date.parse(normalized))
    ? new Date(normalized).toISOString()
    : null;
}

function objectOrEmpty(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : {};
}

function stateFile() {
  const config = getSchwabConfig();

  return path.resolve(
    config.privateDataDir,
    "engine8-real-fill-observer-state.json"
  );
}

function defaultState() {
  return {
    engine: STATE_ENGINE,
    contractVersion: STATE_CONTRACT,
    bootstrapStartedAt: null,
    accounts: {},
    observations: {},
    updatedAt: null,
  };
}

function normalizeAccountWatermark(value = {}) {
  return {
    brokerAccountLabel:
      text(value?.brokerAccountLabel) || null,

    journalAccount:
      text(value?.journalAccount) || null,

    lastSuccessfulPollAt:
      validIso(value?.lastSuccessfulPollAt),

    lastBrokerFillTimeSeen:
      validIso(value?.lastBrokerFillTimeSeen),

    lastBrokerTransactionIdSeen:
      text(value?.lastBrokerTransactionIdSeen) || null,

    updatedAt:
      validIso(value?.updatedAt),
  };
}

/**
 * IMPORTANT:
 *
 * v1 stored broker observations under:
 *   state.records
 *
 * v2 stores the same broker observations under:
 *   state.observations
 *
 * Migration is shape-only:
 * - dedupe keys are preserved
 * - record objects are preserved
 * - normalizedFill is preserved
 * - delivered is preserved exactly
 * - deliveryStatus is preserved exactly
 * - no broker transaction is reinterpreted
 * - no tradeId/contractId is created
 */
function normalizeState(parsed) {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return defaultState();
  }

  const rawObservations =
    Object.keys(objectOrEmpty(parsed.observations)).length > 0
      ? objectOrEmpty(parsed.observations)
      : objectOrEmpty(parsed.records);

  const rawAccounts =
    objectOrEmpty(parsed.accounts);

  const accounts = {};

  for (
    const [key, value]
    of Object.entries(rawAccounts)
  ) {
    accounts[key] =
      normalizeAccountWatermark(value);
  }

  return {
    engine: STATE_ENGINE,
    contractVersion: STATE_CONTRACT,

    bootstrapStartedAt:
      validIso(parsed.bootstrapStartedAt),

    accounts,

    // Preserve the existing broker observation objects exactly.
    // We copy only the outer map so the persisted v2 shape is canonical.
    observations: {
      ...rawObservations,
    },

    updatedAt:
      validIso(parsed.updatedAt),
  };
}

function ensureDir(file) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true,
      mode: 0o700,
    }
  );
}

function writeAtomic(file, value) {
  ensureDir(file);

  const temp =
    `${file}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(
      temp,
      JSON.stringify(value, null, 2),
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "w",
      }
    );

    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try {
      if (fs.existsSync(temp)) {
        fs.unlinkSync(temp);
      }
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function readRawStateFile() {
  const file = stateFile();

  if (!fs.existsSync(file)) {
    return {
      file,
      exists: false,
      parsed: null,
    };
  }

  try {
    return {
      file,
      exists: true,
      parsed: JSON.parse(
        fs.readFileSync(file, "utf8")
      ),
    };
  } catch {
    return {
      file,
      exists: true,
      parsed: null,
    };
  }
}

function writeState(state) {
  const timestamp = nowIso();

  const next = normalizeState({
    ...state,
    updatedAt: timestamp,
  });

  next.updatedAt = timestamp;

  writeAtomic(
    stateFile(),
    next
  );

  return next;
}

function deliveredCounts(observations = {}) {
  const values =
    Object.values(
      objectOrEmpty(observations)
    );

  return {
    total: values.length,

    deliveredTrue:
      values.filter(
        record =>
          record?.delivered === true
      ).length,

    deliveredFalse:
      values.filter(
        record =>
          record?.delivered !== true
      ).length,
  };
}

/**
 * Read state in a backward-compatible way.
 *
 * NOTE:
 * Reading a v1 file does NOT rewrite it.
 * This allows us to prove all 55 records are visible before
 * performing the explicit migration write.
 */
export function readEngine8RealFillObserverState() {
  const raw = readRawStateFile();

  if (!raw.exists) {
    return defaultState();
  }

  if (!raw.parsed) {
    return defaultState();
  }

  return normalizeState(raw.parsed);
}

/**
 * Explicit one-time safe migration from v1 records -> v2 observations.
 *
 * Hard rules:
 * - does not initialize bootstrapStartedAt
 * - does not initialize account watermarks
 * - does not redeliver anything
 * - does not modify delivered flags
 * - does not modify dedupe keys
 * - does not modify normalizedFill
 * - does not create tradeId or contractId
 *
 * A timestamped backup of the pre-migration file is created first.
 */
export function migrateEngine8RealFillObserverStateV1ToV2() {
  const raw = readRawStateFile();

  if (!raw.exists) {
    return {
      ok: true,
      migrated: false,
      reason: "STATE_FILE_NOT_FOUND",
      file: raw.file,
      backupFile: null,
      before: {
        schema: "NONE",
        ...deliveredCounts({}),
      },
      after: {
        schema: "V2",
        ...deliveredCounts({}),
      },
    };
  }

  if (!raw.parsed) {
    throw new Error(
      "ENGINE8_REAL_FILL_STATE_UNREADABLE"
    );
  }

  const parsed = raw.parsed;

  const legacyRecords =
    objectOrEmpty(parsed.records);

  const existingObservations =
    objectOrEmpty(parsed.observations);

  const alreadyV2 =
    Object.keys(existingObservations).length > 0 ||
    (
      text(parsed.contractVersion) ===
        STATE_CONTRACT &&
      !Object.prototype.hasOwnProperty.call(
        parsed,
        "records"
      )
    );

  const beforeObservations =
    alreadyV2
      ? existingObservations
      : legacyRecords;

  const beforeCounts =
    deliveredCounts(beforeObservations);

  if (alreadyV2) {
    const normalized =
      normalizeState(parsed);

    const afterCounts =
      deliveredCounts(
        normalized.observations
      );

    return {
      ok: true,
      migrated: false,
      reason: "ALREADY_V2",
      file: raw.file,
      backupFile: null,
      before: {
        schema: "V2",
        ...beforeCounts,
      },
      after: {
        schema: "V2",
        ...afterCounts,
      },
    };
  }

  const migrationTimestamp =
    nowIso()
      .replaceAll(":", "-");

  const backupFile =
    `${raw.file}.v1-backup.${migrationTimestamp}`;

  fs.copyFileSync(
    raw.file,
    backupFile
  );

  fs.chmodSync(
    backupFile,
    0o600
  );

  const migrated = normalizeState({
    engine: STATE_ENGINE,
    contractVersion: STATE_CONTRACT,

    // Intentionally remain unset until separate bootstrap approval.
    bootstrapStartedAt: null,

    // Intentionally empty until bootstrap/watermark initialization.
    accounts: {},

    // Shape-only relocation of the old record map.
    observations: {
      ...legacyRecords,
    },

    updatedAt:
      parsed.updatedAt || nowIso(),
  });

  writeAtomic(
    raw.file,
    migrated
  );

  const reread =
    readEngine8RealFillObserverState();

  const afterCounts =
    deliveredCounts(
      reread.observations
    );

  if (
    beforeCounts.total !==
      afterCounts.total ||
    beforeCounts.deliveredTrue !==
      afterCounts.deliveredTrue ||
    beforeCounts.deliveredFalse !==
      afterCounts.deliveredFalse
  ) {
    throw new Error(
      "ENGINE8_REAL_FILL_STATE_MIGRATION_COUNT_MISMATCH"
    );
  }

  const beforeKeys =
    Object.keys(legacyRecords)
      .sort();

  const afterKeys =
    Object.keys(
      reread.observations || {}
    ).sort();

  if (
    JSON.stringify(beforeKeys) !==
    JSON.stringify(afterKeys)
  ) {
    throw new Error(
      "ENGINE8_REAL_FILL_STATE_MIGRATION_KEY_MISMATCH"
    );
  }

  return {
    ok: true,
    migrated: true,
    reason:
      "V1_RECORDS_MIGRATED_TO_V2_OBSERVATIONS",

    file:
      raw.file,

    backupFile,

    before: {
      schema: "V1_RECORDS",
      ...beforeCounts,
    },

    after: {
      schema: "V2_OBSERVATIONS",
      ...afterCounts,
    },

    bootstrapStartedAt:
      reread.bootstrapStartedAt,

    accountWatermarkCount:
      Object.keys(
        reread.accounts || {}
      ).length,
  };
}

export function getEngine8RealFillBootstrapStartedAt() {
  return (
    readEngine8RealFillObserverState()
      .bootstrapStartedAt ||
    null
  );
}

export function initializeEngine8RealFillBootstrap({
  bootstrapStartedAt,
  allowExistingSameValue = true,
} = {}) {
  const normalized =
    validIso(bootstrapStartedAt);

  if (!normalized) {
    throw new Error(
      "ENGINE8_REAL_FILL_BOOTSTRAP_TIMESTAMP_INVALID"
    );
  }

  const state =
    readEngine8RealFillObserverState();

  const existing =
    state.bootstrapStartedAt;

  if (existing) {
    if (
      allowExistingSameValue &&
      existing === normalized
    ) {
      return {
        ok: true,
        initialized: false,
        alreadyInitialized: true,
        bootstrapStartedAt: existing,
      };
    }

    throw new Error(
      `ENGINE8_REAL_FILL_BOOTSTRAP_ALREADY_INITIALIZED:${existing}`
    );
  }

  state.bootstrapStartedAt =
    normalized;

  writeState(state);

  return {
    ok: true,
    initialized: true,
    alreadyInitialized: false,
    bootstrapStartedAt:
      normalized,
  };
}

export function getEngine8RealFillAccountWatermark(
  brokerAccountLabel
) {
  const label =
    text(brokerAccountLabel);

  if (!label) {
    return null;
  }

  const state =
    readEngine8RealFillObserverState();

  return (
    state.accounts?.[label] ||
    null
  );
}

export function updateEngine8RealFillAccountWatermark(
  brokerAccountLabel,
  patch = {}
) {
  const label =
    text(brokerAccountLabel);

  if (!label) {
    throw new Error(
      "ENGINE8_REAL_FILL_ACCOUNT_LABEL_REQUIRED"
    );
  }

  const state =
    readEngine8RealFillObserverState();

  const current =
    normalizeAccountWatermark(
      state.accounts?.[label] || {}
    );

  const timestamp =
    nowIso();

  const next =
    normalizeAccountWatermark({
      ...current,
      ...patch,
      brokerAccountLabel:
        label,
      updatedAt:
        timestamp,
    });

  state.accounts[label] =
    next;

  writeState(state);

  return next;
}

export function getEngine8RealFillRecord(
  dedupeKey
) {
  const key =
    text(dedupeKey);

  if (!key) {
    return null;
  }

  const state =
    readEngine8RealFillObserverState();

  return (
    state.observations?.[key] ||
    null
  );
}

export function upsertEngine8RealFillRecord(
  dedupeKey,
  patch = {}
) {
  const key =
    text(dedupeKey);

  if (!key) {
    throw new Error(
      "ENGINE8_REAL_FILL_DEDUPE_KEY_REQUIRED"
    );
  }

  const state =
    readEngine8RealFillObserverState();

  const current =
    state.observations?.[key] ||
    null;

  const timestamp =
    nowIso();

  const nextRecord = {
    ...(current || {}),
    ...patch,

    dedupeKey:
      key,

    firstObservedAt:
      current?.firstObservedAt ||
      patch.firstObservedAt ||
      timestamp,

    lastObservedAt:
      timestamp,

    updatedAt:
      timestamp,
  };

  state.observations[key] =
    nextRecord;

  writeState(state);

  return nextRecord;
}

export function listEngine8RealFillRecords() {
  const state =
    readEngine8RealFillObserverState();

  return Object.values(
    state.observations || {}
  );
}

export default {
  readEngine8RealFillObserverState,
  migrateEngine8RealFillObserverStateV1ToV2,
  getEngine8RealFillBootstrapStartedAt,
  initializeEngine8RealFillBootstrap,
  getEngine8RealFillAccountWatermark,
  updateEngine8RealFillAccountWatermark,
  getEngine8RealFillRecord,
  upsertEngine8RealFillRecord,
  listEngine8RealFillRecords,
};
