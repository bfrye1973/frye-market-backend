// services/core/logic/engine3/v5/state/engine3CanonicalStateStore.js
//
// Engine 3 v5 — persistent canonical state store.
//
// PURPOSE
// -------
// Preserve the last canonical Engine 3 v5 state across:
// - normal snapshot rebuilds
// - process restarts
// - Render deploys / container replacement
//
// STORAGE
// -------
// Uses Render persistent disk:
//   /var/data/engine3/engine3-v5-canonical-es.json
//
// IMPORTANT
// ---------
// This file does NOT:
// - create direction
// - change LONG / SHORT / NEUTRAL
// - create permission
// - create execution
//
// It only saves and restores the canonical state already produced by
// Engine 3 v5.
//
// Engine 3 state-machine ownership remains unchanged.

import fs from "node:fs";
import path from "node:path";

const DEFAULT_DIR =
  process.env.ENGINE3_V5_STATE_DIR ||
  "/opt/render/project/src/services/core/data/engine3";

const DEFAULT_FILE =
  process.env.ENGINE3_V5_STATE_FILE ||
  path.join(
    DEFAULT_DIR,
    "engine3-v5-canonical-es.json"
  );

function nowIso() {
  return new Date().toISOString();
}

function normalizeDirection(value) {
  const direction =
    String(value || "")
      .trim()
      .toUpperCase();

  if (direction === "LONG") return "LONG";
  if (direction === "SHORT") return "SHORT";

  return "NEUTRAL";
}

function safeJsonClone(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function ensureDirectory(filePath = DEFAULT_FILE) {
  const dir =
    path.dirname(filePath);

  fs.mkdirSync(
    dir,
    {
      recursive: true,
    }
  );
}

function buildDefaultCanonicalState({
  symbol = "ES",
  strategyId = "intraday_scalp@10m",
  laneId = "minute",
  reason = "NO_PERSISTED_ENGINE3_STATE",
} = {}) {
  return {
    direction: "NEUTRAL",

    candidateId: null,
    zoneId: null,

    laneId,
    strategyId,
    symbol,

    travelModeActive: false,
    travelDirection: "NEUTRAL",

    quality: "MIXED",

    reactionConfirmed: false,

    mode: "PRICE_ACTION_CONTROL",

    stateTransition: "NEUTRAL_HELD",

    canonicalSource:
      "NO_PERSISTED_ENGINE3_STATE",

    establishedNow: false,
    reversedNow: false,
    resetNow: false,
    heldNow: true,

    persisted: false,

    persistedAt: null,

    persistenceReason:
      reason,
  };
}

function normalizeCanonicalState(
  canonical,
  {
    symbol = "ES",
    strategyId = "intraday_scalp@10m",
    laneId = "minute",
  } = {}
) {
  if (
    !canonical ||
    typeof canonical !== "object"
  ) {
    return buildDefaultCanonicalState({
      symbol,
      strategyId,
      laneId,
      reason: "CANONICAL_STATE_MISSING",
    });
  }

  const direction =
    normalizeDirection(
      canonical.direction
    );

  const travelDirection =
    normalizeDirection(
      canonical.travelDirection
    );

  return {
    ...safeJsonClone(canonical),

    direction,

    candidateId:
      canonical.candidateId ??
      null,

    zoneId:
      canonical.zoneId ??
      null,

    laneId:
      canonical.laneId ||
      laneId,

    strategyId:
      canonical.strategyId ||
      strategyId,

    symbol:
      canonical.symbol ||
      symbol,

    travelModeActive:
      canonical.travelModeActive === true,

    travelDirection:
      canonical.travelModeActive === true
        ? travelDirection
        : "NEUTRAL",

    reactionConfirmed:
      canonical.reactionConfirmed === true,

    establishedNow:
      canonical.establishedNow === true,

    reversedNow:
      canonical.reversedNow === true,

    resetNow:
      canonical.resetNow === true,

    heldNow:
      canonical.heldNow === true,

    persisted:
      canonical.persisted === true,

    persistedAt:
      canonical.persistedAt ??
      null,
  };
}

/**
 * Load the last persisted Engine 3 v5 canonical state.
 *
 * Safe behavior:
 * - Missing file -> NEUTRAL fallback
 * - Invalid JSON -> NEUTRAL fallback
 * - Invalid payload -> NEUTRAL fallback
 *
 * Never throws to the snapshot builder.
 */
export function loadEngine3V5CanonicalState({
  symbol = "ES",
  strategyId = "intraday_scalp@10m",
  laneId = "minute",
  filePath = DEFAULT_FILE,
} = {}) {
  try {
    if (
      !fs.existsSync(filePath)
    ) {
      return {
        ok: true,
        found: false,

        source:
          "ENGINE3_V5_PERSISTENT_STATE_STORE",

        filePath,

        canonical:
          buildDefaultCanonicalState({
            symbol,
            strategyId,
            laneId,
            reason:
              "ENGINE3_V5_STATE_FILE_NOT_FOUND",
          }),

        reasonCodes: [
          "ENGINE3_V5_PERSISTENT_STATE_NOT_FOUND",
          "ENGINE3_V5_DEFAULT_NEUTRAL_RETURNED",
        ],
      };
    }

    const raw =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    const parsed =
      JSON.parse(raw);

    const storedCanonical =
      parsed?.canonical &&
      typeof parsed.canonical === "object"
        ? parsed.canonical
        : parsed;

    const canonical =
      normalizeCanonicalState(
        storedCanonical,
        {
          symbol,
          strategyId,
          laneId,
        }
      );

    return {
      ok: true,
      found: true,

      source:
        "ENGINE3_V5_PERSISTENT_STATE_STORE",

      filePath,

      savedAt:
        parsed?.savedAt ??
        canonical?.persistedAt ??
        null,

      canonical,

      reasonCodes: [
        "ENGINE3_V5_PERSISTENT_STATE_LOADED",
        `ENGINE3_V5_PERSISTED_DIRECTION_${canonical.direction}`,
      ],
    };
  } catch (err) {
    return {
      ok: false,
      found: false,

      source:
        "ENGINE3_V5_PERSISTENT_STATE_STORE",

      filePath,

      canonical:
        buildDefaultCanonicalState({
          symbol,
          strategyId,
          laneId,
          reason:
            "ENGINE3_V5_STATE_LOAD_FAILED",
        }),

      error:
        String(
          err?.message ||
          err
        ),

      reasonCodes: [
        "ENGINE3_V5_PERSISTENT_STATE_LOAD_FAILED",
        "ENGINE3_V5_DEFAULT_NEUTRAL_RETURNED",
      ],
    };
  }
}

/**
 * Save the latest Engine 3 v5 canonical state.
 *
 * Atomic write:
 * - write temporary file
 * - rename over canonical file
 *
 * This reduces risk of a partially-written JSON file if the process stops
 * during a snapshot build.
 */
export function saveEngine3V5CanonicalState({
  canonical,
  symbol = "ES",
  strategyId = "intraday_scalp@10m",
  laneId = "minute",
  filePath = DEFAULT_FILE,
} = {}) {
  try {
    if (
      !canonical ||
      typeof canonical !== "object"
    ) {
      return {
        ok: false,
        saved: false,

        source:
          "ENGINE3_V5_PERSISTENT_STATE_STORE",

        filePath,

        error:
          "ENGINE3_V5_CANONICAL_STATE_MISSING",

        reasonCodes: [
          "ENGINE3_V5_PERSISTENT_STATE_SAVE_SKIPPED",
          "ENGINE3_V5_CANONICAL_STATE_MISSING",
        ],
      };
    }

    const normalized =
      normalizeCanonicalState(
        canonical,
        {
          symbol,
          strategyId,
          laneId,
        }
      );

    const savedAt =
      nowIso();

    const persistedCanonical = {
      ...normalized,

      /*
       * Transition-only flags describe the build where they occurred.
       * They should not be replayed as fresh events after restart.
       */
      establishedNow: false,
      reversedNow: false,
      resetNow: false,

      /*
       * Direction itself is what must persist.
       */
      heldNow:
        ["LONG", "SHORT"].includes(
          normalized.direction
        )
          ? true
          : normalized.heldNow === true,

      persisted: true,
      persistedAt:
        savedAt,
    };

    const payload = {
      ok: true,

      engine:
        "engine3.v5.canonicalStateStore.v1",

      source:
        "ENGINE3_V5_PERSISTENT_STATE_STORE",

      symbol:
        persistedCanonical.symbol ||
        symbol,

      strategyId:
        persistedCanonical.strategyId ||
        strategyId,

      laneId:
        persistedCanonical.laneId ||
        laneId,

      savedAt,

      canonical:
        persistedCanonical,

      reasonCodes: [
        "ENGINE3_V5_PERSISTENT_STATE_SAVED",
        `ENGINE3_V5_PERSISTED_DIRECTION_${persistedCanonical.direction}`,
      ],
    };

    ensureDirectory(
      filePath
    );

    const tempFile =
      `${filePath}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(
        payload,
        null,
        2
      ),
      "utf8"
    );

    fs.renameSync(
      tempFile,
      filePath
    );

    return {
      ok: true,
      saved: true,

      source:
        "ENGINE3_V5_PERSISTENT_STATE_STORE",

      filePath,
      savedAt,

      canonical:
        persistedCanonical,

      reasonCodes:
        payload.reasonCodes,
    };
  } catch (err) {
    return {
      ok: false,
      saved: false,

      source:
        "ENGINE3_V5_PERSISTENT_STATE_STORE",

      filePath,

      error:
        String(
          err?.message ||
          err
        ),

      reasonCodes: [
        "ENGINE3_V5_PERSISTENT_STATE_SAVE_FAILED",
      ],
    };
  }
}

/**
 * Optional helper for diagnostics/tests.
 *
 * Does not run automatically.
 */
export function clearEngine3V5CanonicalState({
  filePath = DEFAULT_FILE,
} = {}) {
  try {
    if (
      fs.existsSync(filePath)
    ) {
      fs.unlinkSync(
        filePath
      );
    }

    return {
      ok: true,
      cleared: true,
      filePath,

      reasonCodes: [
        "ENGINE3_V5_PERSISTENT_STATE_CLEARED",
      ],
    };
  } catch (err) {
    return {
      ok: false,
      cleared: false,
      filePath,

      error:
        String(
          err?.message ||
          err
        ),

      reasonCodes: [
        "ENGINE3_V5_PERSISTENT_STATE_CLEAR_FAILED",
      ],
    };
  }
}

export const ENGINE3_V5_STATE_STORE = {
  directory:
    DEFAULT_DIR,

  file:
    DEFAULT_FILE,
};

export default {
  loadEngine3V5CanonicalState,
  saveEngine3V5CanonicalState,
  clearEngine3V5CanonicalState,
  ENGINE3_V5_STATE_STORE,
};
