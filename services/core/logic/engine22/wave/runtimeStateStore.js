// services/core/logic/engine22/wave/runtimeStateStore.js
//
// Durable Engine 22 structural-transition memory.
//
// Purpose:
// - Persist confirmed parent-wave transitions that must survive snapshot rebuilds.
// - Keep runtime-derived structural state separate from the protected/manual
//   active-wave-state-es.json source.
// - Never create permission, sizing, tickets, execution, broker calls, or journal events.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = path.resolve(
  MODULE_DIR,
  "../../../data/engine22-wave-runtime-state.json"
);

export const ENGINE22_WAVE_RUNTIME_SCHEMA = "engine22-wave-runtime-state@v1";

function normalizeSymbol(symbol) {
  return String(symbol || "ES").trim().toUpperCase() || "ES";
}

function normalizeDegree(degree) {
  return String(degree || "minute").trim().toLowerCase() || "minute";
}

function recordKey(symbol, degree) {
  return `${normalizeSymbol(symbol)}:${normalizeDegree(degree)}`;
}

function emptyState() {
  return {
    schema: ENGINE22_WAVE_RUNTIME_SCHEMA,
    updatedAt: null,
    records: {},
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return emptyState();

  return {
    schema: ENGINE22_WAVE_RUNTIME_SCHEMA,
    updatedAt: raw.updatedAt || null,
    records:
      raw.records && typeof raw.records === "object"
        ? { ...raw.records }
        : {},
  };
}

export function getEngine22WaveRuntimeStatePath() {
  return (
    process.env.ENGINE22_WAVE_RUNTIME_STATE_PATH ||
    DEFAULT_STATE_PATH
  );
}

export function readEngine22WaveRuntimeState({
  symbol = "ES",
  degree = "minute",
  filePath = null,
} = {}) {
  const targetPath = filePath || getEngine22WaveRuntimeStatePath();

  try {
    if (!fs.existsSync(targetPath)) return null;

    const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    const state = normalizeState(parsed);
    const record = state.records?.[recordKey(symbol, degree)] || null;

    return record && typeof record === "object"
      ? { ...record }
      : null;
  } catch (error) {
    console.warn(
      "[Engine22 RuntimeState] Failed reading durable wave state:",
      error?.message || error
    );
    return null;
  }
}

export function writeEngine22WaveRuntimeState({
  symbol = "ES",
  degree = "minute",
  record = null,
  filePath = null,
} = {}) {
  if (!record || typeof record !== "object") return false;

  if (process.env.ENGINE22_WAVE_RUNTIME_STATE_DISABLE_WRITE === "1") {
    return false;
  }

  const targetPath = filePath || getEngine22WaveRuntimeStatePath();

  try {
    const current = fs.existsSync(targetPath)
      ? normalizeState(JSON.parse(fs.readFileSync(targetPath, "utf8")))
      : emptyState();

    const nowIso = new Date().toISOString();
    const key = recordKey(symbol, degree);

    const next = {
      ...current,
      schema: ENGINE22_WAVE_RUNTIME_SCHEMA,
      updatedAt: nowIso,
      records: {
        ...current.records,
        [key]: {
          ...current.records?.[key],
          ...record,
          symbol: normalizeSymbol(symbol),
          degree: normalizeDegree(degree),
          updatedAt: nowIso,
          noExecution: true,
          noPermissionCreated: true,
          watchOnly: true,
        },
      },
    };

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    const tempPath = `${targetPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, targetPath);

    return true;
  } catch (error) {
    console.warn(
      "[Engine22 RuntimeState] Failed writing durable wave state:",
      error?.message || error
    );
    return false;
  }
}

export function persistConfirmedMinuteW4State({
  symbol = "ES",
  model = null,
  filePath = null,
} = {}) {
  if (!model || model.state !== "PARENT_W4_ACTIVE_CANDIDATE") {
    return false;
  }

  const confirmedW3High = Number(model.w3HighCandidate);
  const w2Low = Number(model.w4RetracementMap?.w2Low);

  if (!Number.isFinite(confirmedW3High) || !Number.isFinite(w2Low)) {
    return false;
  }

  return writeEngine22WaveRuntimeState({
    symbol,
    degree: "minute",
    filePath,
    record: {
      transitionState: "PARENT_W4_ACTIVE_CANDIDATE",
      activeParentWave: "W4",
      direction: "DOWN",
      confirmedW3High,
      confirmedW3HighTimeSec: model.w3HighCandidateTimeSec ?? null,
      confirmedW3HighStatus: "CONFIRMED",
      w2Low,
      parentWaveComplete: true,
      parentTransitionPossible: true,
      activeFibModelKey: "W4_RETRACEMENT_MAP",
      structuralTransitionAuthority:
        model.evidence?.structuralTransitionAuthority ||
        "CANONICAL_10M_STRUCTURE",
      confirmedAt:
        model.confirmedAt ||
        new Date().toISOString(),
      source: "ENGINE22_CONFIRMED_RUNTIME_TRANSITION",
      reasonCodes: [
        "ENGINE22_DURABLE_PARENT_W4_STATE",
        "CONFIRMED_W3_HIGH_PERSISTED",
        "NO_EXECUTION",
        "NO_PERMISSION_CREATED",
      ],
    },
  });
}

export default {
  getEngine22WaveRuntimeStatePath,
  readEngine22WaveRuntimeState,
  writeEngine22WaveRuntimeState,
  persistConfirmedMinuteW4State,
};
