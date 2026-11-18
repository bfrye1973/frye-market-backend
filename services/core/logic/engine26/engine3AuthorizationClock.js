// services/core/logic/engine26/engine3AuthorizationClock.js
// Engine 26-owned continuity clock for Engine 3 evaluation authorization.
//
// Contract:
// - engine3AuthorizationStartedAt is the first source as-of timestamp of the
//   current uninterrupted authorized run for the same (candidateId, zoneId).
// - It is independent of direction/contact and MUST NOT reuse
//   candidateLifecycleStartTime.
// - Any unauthorized/ineligible/terminal tick ends the run.
// - Candidate/zone identity change starts a new run.
// - State is persisted so process restart does not re-date a live run.
// - A stored future record is never allowed to backdate an older as-of read.

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH =
  process.env.ENGINE26_ENGINE3_AUTHORIZATION_CLOCK_PATH ||
  "/opt/render/project/src/services/core/data/engine26/engine3-authorization-clock.json";

const VERSION = "engine26.engine3AuthorizationClock.v1";

function normalizeIso(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function streamKey({ symbol, strategyId }) {
  return [
    String(symbol || "").toUpperCase(),
    String(strategyId || ""),
  ].join("::");
}

function emptyStore() {
  return {
    version: VERSION,
    records: {},
  };
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      version: parsed?.version || VERSION,
      records:
        parsed?.records && typeof parsed.records === "object"
          ? parsed.records
          : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(store, null, 2)}\n`,
    "utf8"
  );
  fs.renameSync(temporaryPath, filePath);
}

export function resolveEngine3AuthorizationClock({
  symbol,
  strategyId,
  candidateId = null,
  zoneId = null,
  authorized = false,
  sourceAsOf,
  filePath = DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH,
  persist = true,
} = {}) {
  const normalizedAsOf = normalizeIso(sourceAsOf);
  const key = streamKey({ symbol, strategyId });
  const store = readStore(filePath);
  const previous = store.records?.[key] || null;

  const identityValid =
    Boolean(candidateId) &&
    Boolean(zoneId) &&
    Boolean(key) &&
    normalizedAsOf !== null;

  const runAuthorized =
    authorized === true && identityValid;

  const previousSourceAsOf =
    normalizeIso(previous?.sourceAsOf);
  const previousStartedAt =
    normalizeIso(previous?.engine3AuthorizationStartedAt);

  const previousNotFromFuture =
    previousSourceAsOf === null ||
    normalizedAsOf === null ||
    previousSourceAsOf <= normalizedAsOf;

  const sameUninterruptedRun =
    runAuthorized &&
    previous?.active === true &&
    previous?.candidateId === candidateId &&
    previous?.zoneId === zoneId &&
    previousStartedAt !== null &&
    previousNotFromFuture;

  const engine3AuthorizationStartedAt =
    runAuthorized
      ? (
          sameUninterruptedRun
            ? previousStartedAt
            : normalizedAsOf
        )
      : null;

  const record = {
    symbol: String(symbol || "").toUpperCase(),
    strategyId: String(strategyId || ""),
    candidateId: candidateId || null,
    zoneId: zoneId || null,
    active: runAuthorized,
    engine3AuthorizationStartedAt,
    sourceAsOf: normalizedAsOf,
    lastAuthorizedAsOf:
      runAuthorized
        ? normalizedAsOf
        : previous?.lastAuthorizedAsOf || null,
    endedAt:
      runAuthorized
        ? null
        : normalizedAsOf,
  };

  const nextStore = {
    ...store,
    version: VERSION,
    records: {
      ...(store.records || {}),
      [key]: record,
    },
  };

  if (persist) {
    writeStore(filePath, nextStore);
  }

  return {
    engine3AuthorizationStartedAt,
    engine3AuthorizationSourceAsOf: normalizedAsOf,
    engine3AuthorizationIdentity: {
      candidateId: candidateId || null,
      zoneId: zoneId || null,
    },
    engine3AuthorizationContinuous:
      sameUninterruptedRun,
    engine3AuthorizationActive:
      runAuthorized,
    record,
    store: nextStore,
  };
}

export default resolveEngine3AuthorizationClock;
