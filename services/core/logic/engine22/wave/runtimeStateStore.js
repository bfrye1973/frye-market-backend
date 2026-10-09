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


const MICRO_DURABLE_STATES = new Set([
  "CONFIRMED",
  "LOCKED",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function microStateRank(value) {
  const state = String(value || "").trim().toUpperCase();

  return {
    DEVELOPING: 0,
    COMPLETION_CANDIDATE: 1,
    CONFIRMED: 2,
    LOCKED: 3,
  }[state] ?? -1;
}

function microHasDurableW1(sequence) {
  return (
    isObject(sequence) &&
    MICRO_DURABLE_STATES.has(
      String(sequence?.w1Completion?.state || "").trim().toUpperCase()
    ) &&
    Number.isFinite(Number(sequence?.confirmedW1High)) &&
    Number(sequence.confirmedW1High) > 0
  );
}

function microHasLockedW1(sequence) {
  return (
    isObject(sequence) &&
    String(sequence?.w1Completion?.state || "").trim().toUpperCase() === "LOCKED" &&
    Number.isFinite(Number(sequence?.confirmedW1High)) &&
    Number(sequence.confirmedW1High) > 0
  );
}

function defaultMicroRuntimeStatePath() {
  if (process.env.ENGINE22_MICRO_RUNTIME_STATE_PATH) {
    return process.env.ENGINE22_MICRO_RUNTIME_STATE_PATH;
  }

  if (fs.existsSync("/var/data/replay")) {
    return "/var/data/replay/engine22-micro-wave-runtime-state.json";
  }

  return path.resolve(
    MODULE_DIR,
    "../../../data/engine22-micro-wave-runtime-state.json"
  );
}

function defaultEsReplayRoot() {
  if (process.env.ENGINE22_MICRO_REPLAY_ROOT) {
    return process.env.ENGINE22_MICRO_REPLAY_ROOT;
  }

  const replayDataDir = String(
    process.env.REPLAY_DATA_DIR || ""
  ).trim();

  if (replayDataDir) {
    return path.join(replayDataDir, "replay", "es");
  }

  if (fs.existsSync("/var/data/replay/es")) {
    return "/var/data/replay/es";
  }

  return path.resolve(
    MODULE_DIR,
    "../../../data/replay/es"
  );
}

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


export function getEngine22MicroWaveRuntimeStatePath() {
  return defaultMicroRuntimeStatePath();
}

export function mergeEngine22MicroSequenceState({
  snapshotSequence = null,
  durableSequence = null,
} = {}) {
  const snapshot = isObject(snapshotSequence)
    ? { ...snapshotSequence }
    : null;

  const durable = isObject(durableSequence)
    ? { ...durableSequence }
    : null;

  if (!snapshot && !durable) return null;
  if (!durable) return snapshot;
  if (!snapshot) return durable;

  const merged = {
    ...durable,
    ...snapshot,
  };

  for (const waveKey of ["w1", "w2"]) {
    const completionKey = `${waveKey}Completion`;
    const durableCompletion = durable?.[completionKey];
    const snapshotCompletion = snapshot?.[completionKey];

    const durableRank = microStateRank(
      durableCompletion?.state
    );

    const snapshotRank = microStateRank(
      snapshotCompletion?.state
    );

    if (
      durableRank > snapshotRank ||
      (
        durableRank === 3 &&
        snapshotRank === 3
      )
    ) {
      merged[completionKey] = durableCompletion;
    }
  }

  const mergedW1Rank = microStateRank(
    merged?.w1Completion?.state
  );

  const durableW1Rank = microStateRank(
    durable?.w1Completion?.state
  );

  if (durableW1Rank >= 2 && durableW1Rank >= mergedW1Rank) {
    merged.confirmedW1High =
      durable.confirmedW1High ??
      durable?.w1Completion?.anchor ??
      merged.confirmedW1High ??
      null;

    if (durable.candidateW1High != null) {
      merged.candidateW1High = durable.candidateW1High;
    }
  }

  const mergedW2Rank = microStateRank(
    merged?.w2Completion?.state
  );

  const durableW2Rank = microStateRank(
    durable?.w2Completion?.state
  );

  if (durableW2Rank >= 2 && durableW2Rank >= mergedW2Rank) {
    merged.confirmedW2Low =
      durable.confirmedW2Low ??
      durable?.w2Completion?.anchor ??
      merged.confirmedW2Low ??
      null;

    if (durable.w2CandidateLow != null) {
      merged.w2CandidateLow = durable.w2CandidateLow;
    }
  }

  const w1State = String(
    merged?.w1Completion?.state || ""
  ).trim().toUpperCase();

  const w2State = String(
    merged?.w2Completion?.state || ""
  ).trim().toUpperCase();

  merged.activeWave =
    w1State !== "LOCKED"
      ? "W1"
      : w2State !== "LOCKED"
      ? "W2"
      : "W3_WATCH";

  merged.state =
    merged.activeWave === "W1"
      ? "MICRO_W1_HIGH_SEARCH"
      : merged.activeWave === "W2"
      ? "MICRO_W2_PULLBACK_WATCH"
      : "MICRO_W3_SETUP_WATCH";

  merged.confirmationStatus =
    !["CONFIRMED", "LOCKED"].includes(w1State)
      ? "W1_COMPLETION_NOT_CONFIRMED"
      : !["CONFIRMED", "LOCKED"].includes(w2State)
      ? "W1_CONFIRMED_W2_PENDING"
      : "W2_CONFIRMED_W3_PENDING";

  return merged;
}

export function readEngine22MicroWaveRuntimeState({
  symbol = "ES",
  filePath = null,
} = {}) {
  const record = readEngine22WaveRuntimeState({
    symbol,
    degree: "micro",
    filePath:
      filePath ||
      getEngine22MicroWaveRuntimeStatePath(),
  });

  return isObject(record?.microSequence)
    ? {
        ...record,
        microSequence: {
          ...record.microSequence,
        },
      }
    : null;
}

export function persistEngine22MicroWaveRuntimeState({
  symbol = "ES",
  microSequence = null,
  filePath = null,
} = {}) {
  if (!isObject(microSequence)) return false;

  const targetPath =
    filePath ||
    getEngine22MicroWaveRuntimeStatePath();

  const existing =
    readEngine22MicroWaveRuntimeState({
      symbol,
      filePath: targetPath,
    })?.microSequence ||
    null;

  const merged =
    mergeEngine22MicroSequenceState({
      snapshotSequence: microSequence,
      durableSequence: existing,
    });

  if (!microHasDurableW1(merged)) {
    return false;
  }

  return writeEngine22WaveRuntimeState({
    symbol,
    degree: "micro",
    filePath: targetPath,
    record: {
      microSequence: merged,
      source:
        "ENGINE22_DURABLE_MICRO_WAVE_STATE",
      reasonCodes: [
        "ENGINE22_MICRO_CONFIRMED_OR_LOCKED_STATE_PERSISTED",
        "LOCKED_MICRO_ANCHORS_MUST_NOT_REPAINT",
        "NO_EXECUTION",
        "NO_PERMISSION_CREATED",
      ],
    },
  });
}

export function recoverLatestLockedMicroSequenceFromReplay({
  symbol = "ES",
  replayRoot = null,
  maxFiles = 500,
} = {}) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  if (normalizedSymbol !== "ES") {
    return null;
  }

  const roots = replayRoot
    ? [replayRoot]
    : [
        defaultEsReplayRoot(),
        "/var/data/replay/es",
        "/var/data/replay/replay/es",
        path.resolve(
          MODULE_DIR,
          "../../../data/replay/es"
        ),
      ];

  const uniqueRoots =
    [...new Set(roots.filter(Boolean))];

  try {
    let inspected = 0;

    for (const root of uniqueRoots) {
      if (!fs.existsSync(root)) {
        continue;
      }

      const dateDirs =
        fs.readdirSync(root, {
          withFileTypes: true,
        })
          .filter(
            (entry) =>
              entry.isDirectory() &&
              /^\d{4}-\d{2}-\d{2}$/.test(
                entry.name
              )
          )
          .map((entry) => entry.name)
          .sort()
          .reverse();

      for (const dateDir of dateDirs) {
        const dirPath =
          path.join(root, dateDir);

        const files =
          fs.readdirSync(dirPath)
            .filter(
              (name) =>
                /^\d{4}\.json$/.test(
                  name
                )
            )
            .sort()
            .reverse();

        for (const name of files) {
          if (inspected >= maxFiles) {
            return null;
          }

          inspected += 1;

          try {
            const parsed =
              JSON.parse(
                fs.readFileSync(
                  path.join(
                    dirPath,
                    name
                  ),
                  "utf8"
                )
              );

            const sequence =
              parsed
                ?.strategies
                ?.[
                  "intraday_scalp@10m"
                ]
                ?.engine22WaveStrategy
                ?.currentWavelength
                ?.degrees
                ?.micro
                ?.microSequence ||
              null;

            if (
              microHasLockedW1(
                sequence
              )
            ) {
              return {
                ...sequence,
                recoveredFromReplay: true,
                recoveredReplayRoot:
                  root,
                recoveredReplayDate:
                  dateDir,
                recoveredReplayTime:
                  name.replace(
                    /\.json$/,
                    ""
                  ),
              };
            }
          } catch {
            // Ignore malformed/unrelated replay files and continue backward.
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.warn(
      "[Engine22 Micro RuntimeState] Failed Replay recovery:",
      error?.message || error
    );

    return null;
  }
}


export default {
  getEngine22WaveRuntimeStatePath,
  readEngine22WaveRuntimeState,
  writeEngine22WaveRuntimeState,
  persistConfirmedMinuteW4State,
  getEngine22MicroWaveRuntimeStatePath,
  mergeEngine22MicroSequenceState,
  readEngine22MicroWaveRuntimeState,
  persistEngine22MicroWaveRuntimeState,
  recoverLatestLockedMicroSequenceFromReplay,
};
