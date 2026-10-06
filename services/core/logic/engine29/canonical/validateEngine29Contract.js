// services/core/logic/engine29/canonical/validateEngine29Contract.js

import {
  ENGINE29_GROUP_ORDER,
  ENGINE29_OVERALL_STATES,
  ENGINE29_TIMEFRAMES,
  ENGINE29_VERSION,
} from "../constants.js";

function valuesOf(object) {
  return new Set(Object.values(object));
}

const OVERALL_STATES = valuesOf(ENGINE29_OVERALL_STATES);

export function validateEngine29Contract(value) {
  const errors = [];
  const warnings = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      errors: ["Engine 29 contract must be an object"],
      warnings,
    };
  }

  if (value.version !== ENGINE29_VERSION) {
    errors.push(`version must equal ${ENGINE29_VERSION}`);
  }

  if (value.structuralTimeframe !== ENGINE29_TIMEFRAMES.STRUCTURAL) {
    errors.push(`structuralTimeframe must equal ${ENGINE29_TIMEFRAMES.STRUCTURAL}`);
  }

  if (value.tacticalTimeframe !== ENGINE29_TIMEFRAMES.TACTICAL) {
    errors.push(`tacticalTimeframe must equal ${ENGINE29_TIMEFRAMES.TACTICAL}`);
  }

  if (!OVERALL_STATES.has(value.overallState)) {
    errors.push(`Unknown overallState: ${value.overallState}`);
  }

  if (!OVERALL_STATES.has(value.structuralState)) {
    errors.push(`Unknown structuralState: ${value.structuralState}`);
  }

  if (!value.groups || typeof value.groups !== "object") {
    errors.push("groups object is required");
  } else {
    for (const groupId of ENGINE29_GROUP_ORDER) {
      if (!value.groups[groupId]) {
        errors.push(`Missing group: ${groupId}`);
      }
    }
  }

  if (!value.symbols || typeof value.symbols !== "object") {
    errors.push("symbols object is required");
  }

  if (!value.dataQuality || typeof value.dataQuality !== "object") {
    errors.push("dataQuality object is required");
  }

  if (!Array.isArray(value.confirmations)) {
    errors.push("confirmations must be an array");
  }

  if (!Array.isArray(value.warnings)) {
    errors.push("warnings must be an array");
  }

  if (!Array.isArray(value.recoveries)) {
    errors.push("recoveries must be an array");
  }

  if (!Array.isArray(value.missingConfirmations)) {
    errors.push("missingConfirmations must be an array");
  }

  if (!Array.isArray(value.reasonCodes)) {
    errors.push("reasonCodes must be an array");
  }

  if (value.dataDegraded === true && value.overallState === "SYSTEMIC_STRESS") {
    warnings.push(
      "SYSTEMIC_STRESS is present while dataDegraded=true; downstream consumers must inspect missing/stale evidence"
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
