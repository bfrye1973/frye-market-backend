// Engine 22 Micro Lifecycle V2 — durable canonical count store.
//
// Persists canonical Micro counts and append-only transition/recount history.
// This module does not compute wave structure and has no trading authority.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateCanonicalMicroState,
} from "./canonicalMicroState.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ENGINE22_MICRO_V2_STORE_SCHEMA =
  "engine22.microCanonicalStore.v2";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function getEngine22MicroV2StoreRoot() {
  if (process.env.ENGINE22_MICRO_V2_STATE_DIR) {
    return process.env.ENGINE22_MICRO_V2_STATE_DIR;
  }

  if (fs.existsSync("/var/data/replay")) {
    return "/var/data/replay/engine22-micro-v2";
  }

  return path.resolve(
    MODULE_DIR,
    "../../../data/engine22-micro-v2"
  );
}

function pathsFor(rootDir) {
  return {
    rootDir,
    activeFile:
      path.join(rootDir, "active-count.json"),
    countsDir:
      path.join(rootDir, "counts"),
    transitionsFile:
      path.join(rootDir, "transitions.jsonl"),
    recountsFile:
      path.join(rootDir, "recounts.jsonl"),
  };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(
    tempPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );

  fs.renameSync(tempPath, filePath);
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  fs.appendFileSync(
    filePath,
    `${JSON.stringify(value)}\n`,
    "utf8"
  );
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readJsonlSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];

    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function countFilePath(rootDir, countId) {
  return path.join(
    rootDir,
    "counts",
    `${sanitizeFilePart(countId)}.json`
  );
}

export function readActiveCanonicalMicroCount({
  rootDir = null,
} = {}) {
  const root =
    rootDir ||
    getEngine22MicroV2StoreRoot();

  const active =
    readJsonSafe(
      pathsFor(root).activeFile
    );

  if (!active) return null;

  const validation =
    validateCanonicalMicroState(active);

  return validation.ok
    ? active
    : null;
}

export function readCanonicalMicroCount({
  countId,
  rootDir = null,
} = {}) {
  const root =
    rootDir ||
    getEngine22MicroV2StoreRoot();

  return readJsonSafe(
    countFilePath(root, countId)
  );
}

export function readCanonicalMicroTransitionHistory({
  rootDir = null,
} = {}) {
  const root =
    rootDir ||
    getEngine22MicroV2StoreRoot();

  return readJsonlSafe(
    pathsFor(root).transitionsFile
  );
}

export function readCanonicalMicroRecountHistory({
  rootDir = null,
} = {}) {
  const root =
    rootDir ||
    getEngine22MicroV2StoreRoot();

  return readJsonlSafe(
    pathsFor(root).recountsFile
  );
}

export function persistCanonicalMicroState({
  state,
  rootDir = null,
  setActive = true,
} = {}) {
  const validation =
    validateCanonicalMicroState(state);

  if (!validation.ok) {
    return {
      ok: false,
      reasonCodes: [
        "INVALID_CANONICAL_MICRO_STATE",
        ...validation.errors,
      ],
    };
  }

  const root =
    rootDir ||
    getEngine22MicroV2StoreRoot();

  const files =
    pathsFor(root);

  fs.mkdirSync(files.countsDir, {
    recursive: true,
  });

  atomicWriteJson(
    countFilePath(root, state.countId),
    state
  );

  if (
    setActive === true &&
    state.countStatus !== "HISTORICAL"
  ) {
    atomicWriteJson(
      files.activeFile,
      state
    );
  }

  return {
    ok: true,
    reasonCodes: [
      "CANONICAL_MICRO_STATE_PERSISTED",
    ],
  };
}

export function persistCanonicalMicroTransition({
  beforeState,
  afterState,
  rootDir = null,
} = {}) {
  const beforeValidation =
    validateCanonicalMicroState(beforeState);

  const afterValidation =
    validateCanonicalMicroState(afterState);

  if (
    !beforeValidation.ok ||
    !afterValidation.ok
  ) {
    return {
      ok: false,
      reasonCodes: [
        "INVALID_CANONICAL_MICRO_TRANSITION_STATE",
      ],
    };
  }

  if (
    beforeState.countId !==
    afterState.countId
  ) {
    return {
      ok: false,
      reasonCodes: [
        "COUNT_BOUNDARY_REQUIRES_AUTHORIZED_RECOUNT_PERSISTENCE",
      ],
    };
  }

  const beforeRevision =
    Number(beforeState.revision || 0);

  const newRecords =
    (Array.isArray(afterState.history)
      ? afterState.history
      : []
    ).filter(
      (record) =>
        Number(record?.revision) >
        beforeRevision
    );

  const root =
    rootDir ||
    getEngine22MicroV2StoreRoot();

  const transitionFile =
    pathsFor(root).transitionsFile;

  for (const record of newRecords) {
    appendJsonLine(
      transitionFile,
      {
        storeSchema:
          ENGINE22_MICRO_V2_STORE_SCHEMA,
        ...clone(record),
      }
    );
  }

  const persisted =
    persistCanonicalMicroState({
      state: afterState,
      rootDir: root,
      setActive: true,
    });

  return {
    ok: persisted.ok,
    appendedTransitions:
      newRecords.length,
    reasonCodes:
      persisted.ok
        ? [
            "CANONICAL_MICRO_TRANSITION_PERSISTED",
          ]
        : persisted.reasonCodes,
  };
}

export function persistAuthorizedMicroRecount({
  previousCount,
  newCount,
  recountRecord,
  rootDir = null,
} = {}) {
  const previousValidation =
    validateCanonicalMicroState(previousCount);

  const nextValidation =
    validateCanonicalMicroState(newCount);

  if (
    !previousValidation.ok ||
    !nextValidation.ok
  ) {
    return {
      ok: false,
      reasonCodes: [
        "INVALID_AUTHORIZED_RECOUNT_STATE",
      ],
    };
  }

  if (
    previousCount.countStatus !==
    "HISTORICAL"
  ) {
    return {
      ok: false,
      reasonCodes: [
        "PREVIOUS_COUNT_MUST_BE_HISTORICAL",
      ],
    };
  }

  if (
    previousCount.countId ===
    newCount.countId
  ) {
    return {
      ok: false,
      reasonCodes: [
        "AUTHORIZED_RECOUNT_REQUIRES_NEW_COUNT_ID",
      ],
    };
  }

  const root =
    rootDir ||
    getEngine22MicroV2StoreRoot();

  persistCanonicalMicroState({
    state: previousCount,
    rootDir: root,
    setActive: false,
  });

  persistCanonicalMicroState({
    state: newCount,
    rootDir: root,
    setActive: true,
  });

  appendJsonLine(
    pathsFor(root).recountsFile,
    {
      storeSchema:
        ENGINE22_MICRO_V2_STORE_SCHEMA,
      ...clone(recountRecord),
    }
  );

  for (const record of newCount.history || []) {
    appendJsonLine(
      pathsFor(root).transitionsFile,
      {
        storeSchema:
          ENGINE22_MICRO_V2_STORE_SCHEMA,
        ...clone(record),
      }
    );
  }

  return {
    ok: true,
    reasonCodes: [
      "AUTHORIZED_MICRO_RECOUNT_PERSISTED",
      "OLD_COUNT_HISTORY_PRESERVED",
      "NEW_COUNT_SET_ACTIVE",
    ],
  };
}

export default {
  ENGINE22_MICRO_V2_STORE_SCHEMA,
  getEngine22MicroV2StoreRoot,
  readActiveCanonicalMicroCount,
  readCanonicalMicroCount,
  readCanonicalMicroTransitionHistory,
  readCanonicalMicroRecountHistory,
  persistCanonicalMicroState,
  persistCanonicalMicroTransition,
  persistAuthorizedMicroRecount,
};
