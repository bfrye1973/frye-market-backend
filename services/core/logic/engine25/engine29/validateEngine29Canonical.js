// services/core/logic/engine25/engine29/validateEngine29Canonical.js

import fs from "fs";

export const MAX_ENGINE29_AGE_MS = 5 * 60 * 1000;

export function validateEngine29Canonical({
  filePath,
  now = Date.now(),
  maxAgeMs = MAX_ENGINE29_AGE_MS,
} = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      ok: false,
      exists: false,
      fresh: false,
      ageMs: null,
      timestamp: null,
      reason: "ENGINE29_CANONICAL_MISSING",
    };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      exists: true,
      fresh: false,
      ageMs: null,
      timestamp: null,
      reason: "ENGINE29_CANONICAL_INVALID_JSON",
      error: error?.message || String(error),
    };
  }

  if (!data?.version) {
    return { ok: false, exists: true, fresh: false, ageMs: null, timestamp: data?.timestamp ?? null, reason: "ENGINE29_VERSION_MISSING" };
  }
  if (!data?.timestamp) {
    return { ok: false, exists: true, fresh: false, ageMs: null, timestamp: null, reason: "ENGINE29_TIMESTAMP_MISSING" };
  }
  if (!data?.overallState) {
    return { ok: false, exists: true, fresh: false, ageMs: null, timestamp: data.timestamp, reason: "ENGINE29_OVERALL_STATE_MISSING" };
  }

  const timestampMs = Date.parse(data.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, exists: true, fresh: false, ageMs: null, timestamp: data.timestamp, reason: "ENGINE29_TIMESTAMP_INVALID" };
  }

  const ageMs = Number(now) - timestampMs;
  const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;

  if (!fresh) {
    return {
      ok: false,
      exists: true,
      fresh: false,
      ageMs,
      timestamp: data.timestamp,
      reason: ageMs < 0 ? "ENGINE29_TIMESTAMP_IN_FUTURE" : "ENGINE29_CANONICAL_STALE",
    };
  }

  return {
    ok: true,
    exists: true,
    fresh: true,
    ageMs,
    timestamp: data.timestamp,
    version: data.version,
    overallState: data.overallState,
    reason: null,
  };
}

export default validateEngine29Canonical;
