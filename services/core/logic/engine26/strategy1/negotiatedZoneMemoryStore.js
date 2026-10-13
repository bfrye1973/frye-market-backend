// services/core/logic/engine26/strategy1/negotiatedZoneMemoryStore.js
// Engine 26 Strategy 1 — negotiated-zone memory persistence only.
//
// Ownership:
//   - default memory file path
//   - safe JSON reads
//   - malformed-file recovery
//   - atomic JSON writes
//
// This module does not:
//   - select zones
//   - calculate Strategy 1 facts
//   - update lifecycle records
//   - retire candidates
//   - create permission, sizing, management, or execution

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MEMORY_PATH =
  process.env.ENGINE26_NEGOTIATED_ZONE_MEMORY_PATH ||
  "/opt/render/project/src/services/core/data/engine26/negotiated-zone-memory.json";

const STORE_VERSION =
  "engine26.negotiatedZoneMemory.v1";

function emptyStore() {
  return {
    version: STORE_VERSION,
    records: {},
  };
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function normalizeStore(value) {
  if (!isPlainObject(value)) {
    return emptyStore();
  }

  const records = isPlainObject(value.records)
    ? { ...value.records }
    : {};

  return {
    ...value,
    version:
      typeof value.version === "string" &&
      value.version.trim()
        ? value.version
        : STORE_VERSION,
    records,
  };
}

function normalizeFilePath(filePath) {
  if (
    typeof filePath === "string" &&
    filePath.trim()
  ) {
    return filePath.trim();
  }

  return DEFAULT_MEMORY_PATH;
}

function warning(code, details = {}) {
  return {
    code,
    ...details,
  };
}

export function readNegotiatedZoneMemory({
  filePath = DEFAULT_MEMORY_PATH,
} = {}) {
  const resolvedPath =
    normalizeFilePath(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      filePath: resolvedPath,
      store: emptyStore(),
      exists: false,
      malformed: false,
      warnings: [],
    };
  }

  try {
    const raw = fs.readFileSync(
      resolvedPath,
      "utf8"
    );

    if (!raw.trim()) {
      return {
        filePath: resolvedPath,
        store: emptyStore(),
        exists: true,
        malformed: true,
        warnings: [
          warning(
            "ENGINE26_NEGOTIATED_ZONE_MEMORY_EMPTY_FILE",
            { filePath: resolvedPath }
          ),
        ],
      };
    }

    const parsed = JSON.parse(raw);

    if (!isPlainObject(parsed)) {
      return {
        filePath: resolvedPath,
        store: emptyStore(),
        exists: true,
        malformed: true,
        warnings: [
          warning(
            "ENGINE26_NEGOTIATED_ZONE_MEMORY_INVALID_ROOT",
            { filePath: resolvedPath }
          ),
        ],
      };
    }

    const normalized = normalizeStore(parsed);
    const malformed =
      !isPlainObject(parsed.records);

    return {
      filePath: resolvedPath,
      store: normalized,
      exists: true,
      malformed,
      warnings: malformed
        ? [
            warning(
              "ENGINE26_NEGOTIATED_ZONE_MEMORY_RECORDS_RECOVERED",
              { filePath: resolvedPath }
            ),
          ]
        : [],
    };
  } catch (error) {
    return {
      filePath: resolvedPath,
      store: emptyStore(),
      exists: true,
      malformed: true,
      warnings: [
        warning(
          "ENGINE26_NEGOTIATED_ZONE_MEMORY_READ_FAILED",
          {
            filePath: resolvedPath,
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

export function writeNegotiatedZoneMemory({
  filePath = DEFAULT_MEMORY_PATH,
  store,
  malformedSource = false,
} = {}) {
  const resolvedPath =
    normalizeFilePath(filePath);

  const warnings = [];

  try {
    const directory =
      path.dirname(resolvedPath);

    fs.mkdirSync(directory, {
      recursive: true,
    });

    const normalizedStore =
      normalizeStore(store);

    const temporaryPath =
      `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(
        normalizedStore,
        null,
        2
      )}\n`,
      "utf8"
    );

    fs.renameSync(
      temporaryPath,
      resolvedPath
    );

    if (malformedSource) {
      warnings.push(
        warning(
          "ENGINE26_NEGOTIATED_ZONE_MEMORY_MALFORMED_SOURCE_REPLACED",
          { filePath: resolvedPath }
        )
      );
    }

    return {
      filePath: resolvedPath,
      store: normalizedStore,
      written: true,
      warnings,
    };
  } catch (error) {
    warnings.push(
      warning(
        "ENGINE26_NEGOTIATED_ZONE_MEMORY_WRITE_FAILED",
        {
          filePath: resolvedPath,
          message:
            error instanceof Error
              ? error.message
              : String(error),
        }
      )
    );

    return {
      filePath: resolvedPath,
      store: normalizeStore(store),
      written: false,
      warnings,
    };
  }
}
