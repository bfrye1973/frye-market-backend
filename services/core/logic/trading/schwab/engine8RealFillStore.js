// services/core/logic/trading/schwab/engine8RealFillStore.js
// Engine 8 — durable broker-observation/delivery ledger for REAL Schwab fills.
//
// This store contains no Schwab account hash, OAuth token, or broker credential.

import fs from "fs";
import path from "path";
import { getSchwabConfig } from "./schwabConfig.js";

function nowIso() {
  return new Date().toISOString();
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
    engine: "engine8.schwabRealFillObserverState.v1",
    contractVersion: "engine8.schwabRealFillObserverState.v1",
    records: {},
    updatedAt: null,
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
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const records =
      parsed &&
      typeof parsed.records === "object" &&
      parsed.records !== null &&
      !Array.isArray(parsed.records)
        ? parsed.records
        : {};

    return {
      ...defaultState(),
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      records,
    };
  } catch {
    return defaultState();
  }
}

function writeState(state) {
  const next = {
    ...state,
    updatedAt: nowIso(),
  };
  writeAtomic(stateFile(), next);
  return next;
}

export function getEngine8RealFillRecord(dedupeKey) {
  const state = readEngine8RealFillObserverState();
  return state.records?.[dedupeKey] || null;
}

export function upsertEngine8RealFillRecord(dedupeKey, patch = {}) {
  const state = readEngine8RealFillObserverState();
  const current = state.records?.[dedupeKey] || null;
  const timestamp = nowIso();

  const nextRecord = {
    ...(current || {}),
    ...patch,
    dedupeKey,
    firstObservedAt: current?.firstObservedAt || patch.firstObservedAt || timestamp,
    lastObservedAt: timestamp,
    updatedAt: timestamp,
  };

  state.records[dedupeKey] = nextRecord;
  writeState(state);
  return nextRecord;
}

export function listEngine8RealFillRecords() {
  const state = readEngine8RealFillObserverState();
  return Object.values(state.records || {});
}

export default {
  readEngine8RealFillObserverState,
  getEngine8RealFillRecord,
  upsertEngine8RealFillRecord,
  listEngine8RealFillRecords,
};
