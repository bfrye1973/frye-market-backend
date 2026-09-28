// services/core/logic/engine22/wave/buildEngine22Display.js
// Engine 22B — Canonical Human Display Contract
//
// Purpose:
// - Project canonical Engine 22 degreeStates into one display-ready packet.
// - Keep all human-facing Engine 22 structural wording/levels backend-owned.
// - Give frontend consumers a stable contract that requires no wave interpretation.
//
// IMPORTANT:
// - degreeStates is the machine contract and remains canonical structural truth.
// - This file does NOT count waves.
// - This file does NOT calculate Fibonacci levels.
// - This file does NOT read candles, runtime state, active-wave-state files, or permissions.
// - This file does NOT create execution or trading permission.
// - Frontend consumers render this packet only.

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function humanizeStatus(value) {
  const raw = upper(value);
  if (!raw) return null;

  return raw
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCurrentWave(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  return raw.replace(/^Minute-/, "Minute ");
}

function stripTrailingFromPrice(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  return raw.replace(/\s+from\s+-?\d+(?:\.\d+)?\s*$/i, "").trim();
}

function buildParentLabel(minor = {}) {
  const activeWave = upper(minor?.activeWave);
  if (!activeWave) {
    return String(minor?.headline || "").trim() || null;
  }

  const markStatus = humanizeStatus(minor?.marks?.[activeWave]?.status);

  return ["Minor", activeWave, markStatus]
    .filter(Boolean)
    .join(" ");
}

function buildParentStatus({ minor = {}, minute = {} } = {}) {
  const minorWave3Status = humanizeStatus(minor?.targetModel?.wave3Status);

  if (minorWave3Status) {
    return `Minute W3 ${minorWave3Status}`;
  }

  const minuteW3Status = humanizeStatus(minute?.marks?.W3?.status);
  if (minuteW3Status) {
    return `Minute W3 ${minuteW3Status}`;
  }

  const minuteRead = upper(minute?.currentRead);
  const minorRead = upper(minor?.currentRead);

  if (
    minuteRead.includes("MINUTE_W3_NOT_CONFIRMED") ||
    minorRead.includes("MINUTE_W3_NOT_CONFIRMED")
  ) {
    return "Minute W3 not confirmed";
  }

  return null;
}

function buildTacticalLabel(minute = {}) {
  const targetModel = minute?.targetModel || {};
  const activeWave = upper(minute?.activeWave);
  const structure = upper(targetModel?.minuteW2Structure);
  const pullbackActive = targetModel?.minuteW2PullbackActive === true;

  const parts = [];

  if (activeWave) parts.push(`Minute ${activeWave}`);
  else parts.push("Minute structure");

  if (structure) parts.push(structure);
  if (pullbackActive) parts.push("pullback active");

  return parts.join(" ");
}

function buildDisplayLevels(targetModel = {}) {
  if (!Array.isArray(targetModel?.displayLevels)) return [];

  return targetModel.displayLevels
    .map((level) => ({
      label: String(level?.label || "").trim() || null,
      price: finiteNumber(level?.price),
    }))
    .filter((level) => level.label && level.price !== null);
}

function formatRulePrice(value) {
  const n = finiteNumber(value);
  if (n === null) return null;

  return Number.isInteger(n) ? String(n) : String(n);
}

function buildRules({
  parentLabel,
  reclaim,
  confirmation,
  invalidation,
  review,
  largerInvalidation,
} = {}) {
  const rules = [];

  if (reclaim !== null || confirmation !== null) {
    const reclaimText =
      reclaim !== null ? Number(reclaim).toFixed(2) : "published reclaim";
    const confirmationText =
      confirmation !== null
        ? Number(confirmation).toFixed(2)
        : "published confirmation";

    rules.push(
      `Minute W3 is not confirmed until ${reclaimText} / ${confirmationText} reclaim.`
    );
  }

  if (invalidation !== null || review !== null) {
    const invalidationText =
      formatRulePrice(invalidation) || "published W2 low";
    const reviewText =
      formatRulePrice(review) || "published Minute reference";

    rules.push(
      `Lose ${invalidationText} / ${reviewText} pressures the W2 low.`
    );
  }

  if (largerInvalidation !== null) {
    const largerText = formatRulePrice(largerInvalidation);
    const label = parentLabel || "Minor active structure";

    rules.push(`Lose ${largerText} invalidates ${label}.`);
  }

  return rules;
}

/**
 * Build the canonical Engine 22 human display packet.
 *
 * Contract:
 *   degreeStates      = machine-readable Engine 22 structure
 *   engine22Display   = human-facing Engine 22 display contract
 *
 * The builder is intentionally a pure projection of degreeStates.
 */
export function buildEngine22Display({ degreeStates } = {}) {
  const minor = degreeStates?.minor || null;
  const minute = degreeStates?.minute || null;

  if (!minor || !minute || minor?.active !== true || minute?.active !== true) {
    return null;
  }

  const targetModel =
    minute?.targetModel && typeof minute.targetModel === "object"
      ? minute.targetModel
      : {};

  const parentLabel = buildParentLabel(minor);
  const parentStatus = buildParentStatus({ minor, minute });

  const invalidation = finiteNumber(targetModel?.invalidationLevel);
  const review = finiteNumber(targetModel?.wave3SetupReference);
  const largerInvalidation = finiteNumber(targetModel?.largerInvalidationLevel);
  const reclaim = finiteNumber(targetModel?.reclaimForW3Watch);
  const confirmation = finiteNumber(targetModel?.majorConfirmation);

  return {
    version: "engine22Display.v1",

    headline:
      stripTrailingFromPrice(minute?.headline) ||
      "Engine 22 structure published",

    parent: {
      label: parentLabel,
      status: parentStatus,
      invalidation: largerInvalidation,
    },

    tactical: {
      label: buildTacticalLabel(minute),
      currentWave: normalizeCurrentWave(targetModel?.currentInternalWave),
      direction: upper(minute?.direction) || null,
      review,
      invalidation,
      largerInvalidation,
      reclaim,
      confirmation,
    },

    levels: buildDisplayLevels(targetModel),

    rules: buildRules({
      parentLabel,
      reclaim,
      confirmation,
      invalidation,
      review,
      largerInvalidation,
    }),

    flags: {
      noExecution:
        targetModel?.noExecution === true || minute?.noExecution === true,
      noPermissionCreated:
        targetModel?.noPermissionCreated === true ||
        minute?.noPermissionCreated === true,
      watchOnly:
        targetModel?.watchOnly === true || minute?.watchOnly === true,
    },
  };
}

export default buildEngine22Display;
