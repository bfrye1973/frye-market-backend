// services/core/logic/trading/schwab/engine8RealFillStore.js
// Engine 8 — durable broker-observation/delivery ledger for REAL Schwab fills.
//
// State ownership:
// - broker fill dedupe/delivery records
// - explicit production bootstrap boundary
// - per-account restart/recovery watermarks
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
    records: {},
    updatedAt: null,
  };
}

function normalizeAccountWatermark(value = {}) {
  return {
    brokerAccountLabel: text(value?.brokerAccountLabel) || null,
    journalAccount: text(value?.journalAccount) || null,
    lastSuccessfulPollAt: validIso(value?.lastSuccessfulPollAt),
    lastBrokerFillTimeSeen: validIso(value?.lastBrokerFillTimeSeen),
    lastBrokerTransactionIdSeen:
      text(value?.lastBrokerTransactionIdSeen) || null,
    updatedAt: validIso(value?.updatedAt),
  };
}

function normalizeState(parsed) {
  const state = defaultState();

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return state;
  }

  const records =
    parsed.records &&
    typeof parsed.records === "object" &&
    !Array.isArray(parsed.records)
      ? parsed.records
      : {};

  const rawAccounts =
    parsed.accounts &&
    typeof parsed.accounts === "object" &&
    !Array.isArray(parsed.accounts)
      ? parsed.accounts
      : {};

  const accounts = {};

  for (const [key, value] of Object.entries(rawAccounts)) {
    accounts[key] = normalizeAccountWatermark(value);
  }

  return {
    ...state,
    ...parsed,
    engine: STATE_ENGINE,
    contractVersion: STATE_CONTRACT,
    bootstrapStartedAt: validIso(parsed.bootstrapStartedAt),
    accounts,
    records,
  };
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true,
    mode: 0o700,
  });
}

function writeAtomic(file, value) {
  ensureDir(file);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "w",
    });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export function readEngine8RealFillObserverState() {
  const file = stateFile();

  if (!fs.existsSync(file)) {
    return defaultState();
  }

  try {
    return normalizeState(
      JSON.parse(fs.readFileSync(file, "utf8"))
    );
  } catch {
    return defaultState();
  }
}

function writeState(state) {
  const next = normalizeState({
    ...state,
    updatedAt: nowIso(),
  });

  next.updatedAt = nowIso();
  writeAtomic(stateFile(), next);
  return next;
}

export function getEngine8RealFillBootstrapStartedAt() {
  return readEngine8RealFillObserverState().bootstrapStartedAt || null;
}

export function initializeEngine8RealFillBootstrap({
  bootstrapStartedAt,
  allowExistingSameValue = true,
} = {}) {
  const normalized = validIso(bootstrapStartedAt);

  if (!normalized) {
    throw new Error("ENGINE8_REAL_FILL_BOOTSTRAP_TIMESTAMP_INVALID");
  }

  const state = readEngine8RealFillObserverState();
  const existing = state.bootstrapStartedAt;

  if (existing) {
    if (allowExistingSameValue && existing === normalized) {
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

  state.bootstrapStartedAt = normalized;
  writeState(state);

  return {
    ok: true,
    initialized: true,
    alreadyInitialized: false,
    bootstrapStartedAt: normalized,
  };
}

export function getEngine8RealFillAccountWatermark(
  brokerAccountLabel
) {
  const label = text(brokerAccountLabel);
  if (!label) return null;

  const state = readEngine8RealFillObserverState();
  return state.accounts?.[label] || null;
}

export function updateEngine8RealFillAccountWatermark(
  brokerAccountLabel,
  patch = {}
) {
  const label = text(brokerAccountLabel);

  if (!label) {
    throw new Error("ENGINE8_REAL_FILL_ACCOUNT_LABEL_REQUIRED");
  }

  const state = readEngine8RealFillObserverState();
  const current = normalizeAccountWatermark(
    state.accounts?.[label] || {}
  );
  const timestamp = nowIso();

  const next = normalizeAccountWatermark({
    ...current,
    ...patch,
    brokerAccountLabel: label,
    updatedAt: timestamp,
  });

  state.accounts[label] = next;
  writeState(state);
  return next;
}

export function getEngine8RealFillRecord(dedupeKey) {
  const state = readEngine8RealFillObserverState();
  return state.records?.[dedupeKey] || null;
}

export function upsertEngine8RealFillRecord(dedupeKey, patch = {}) {
  const key = text(dedupeKey);

  if (!key) {
    throw new Error("ENGINE8_REAL_FILL_DEDUPE_KEY_REQUIRED");
  }

  const state = readEngine8RealFillObserverState();
  const current = state.records?.[key] || null;
  const timestamp = nowIso();

  const nextRecord = {
    ...(current || {}),
    ...patch,
    dedupeKey: key,
    firstObservedAt:
      current?.firstObservedAt ||
      patch.firstObservedAt ||
      timestamp,
    lastObservedAt: timestamp,
    updatedAt: timestamp,
  };

  state.records[key] = nextRecord;
  writeState(state);
  return nextRecord;
}

export function listEngine8RealFillRecords() {
  const state = readEngine8RealFillObserverState();
  return Object.values(state.records || {});
}

export default {
  readEngine8RealFillObserverState,
  getEngine8RealFillBootstrapStartedAt,
  initializeEngine8RealFillBootstrap,
  getEngine8RealFillAccountWatermark,
  updateEngine8RealFillAccountWatermark,
  getEngine8RealFillRecord,
  upsertEngine8RealFillRecord,
  listEngine8RealFillRecords,
};
