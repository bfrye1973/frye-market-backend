// services/core/logic/engine29/tacticalCharacter/resolveDirectionalMoveParent.js
//
// Stateful lifecycle wrapper for the canonical 30m ordinary MOVE lane.
//
// Authority:
// - activation/reversal/invalidation use completed 30m evidence only
// - 10m/20m diagnostics never create, reverse, or terminate the parent
// - stale/missing 30m authority fails closed

import { ENGINE29_MOVE_DIRECTIONS } from "./moveCharacterConstants.js";
import { finite, pctChange } from "./tacticalCharacterUtils.js";

function oppositeRetracementPct(direction, extremeClose, latestClose) {
  const change = pctChange(extremeClose, latestClose);
  if (!Number.isFinite(change)) return null;
  if (direction === ENGINE29_MOVE_DIRECTIONS.UP) return Math.max(0, -change);
  if (direction === ENGINE29_MOVE_DIRECTIONS.DOWN) return Math.max(0, change);
  return null;
}

function updateExtreme(direction, priorClose, latestClose) {
  const prior = finite(priorClose);
  const latest = finite(latestClose);
  if (!Number.isFinite(latest)) return prior;
  if (!Number.isFinite(prior)) return latest;
  if (direction === ENGINE29_MOVE_DIRECTIONS.UP) return Math.max(prior, latest);
  if (direction === ENGINE29_MOVE_DIRECTIONS.DOWN) return Math.min(prior, latest);
  return latest;
}

function establish(candidate, now) {
  const latestClose = finite(candidate?.latestClose);
  return {
    active: true,
    direction: candidate.direction,
    establishedAt: new Date(now).toISOString(),
    establishedBarTime: candidate?.latestTime ?? null,
    lastQualifiedAt: new Date(now).toISOString(),
    lastQualifiedBarTime: candidate?.latestTime ?? null,
    activationThresholdPct: finite(candidate?.thresholdPct),
    activationReturnPct: finite(candidate?.returnPct),
    extremeClose: latestClose,
    extremeTime: candidate?.latestTime ?? null,
    latestClose,
    latestTime: candidate?.latestTime ?? null,
    persistedWithoutFreshQualification: false,
    invalidationRetracementPct: 0,
    invalidationThresholdPct: finite(candidate?.thresholdPct),
    reason: "PARENT_ESTABLISHED_FROM_QUALIFIED_30M_MOVE",
  };
}

export function resolveDirectionalMoveParent({
  candidate,
  priorParent = null,
  now = Date.now(),
} = {}) {
  const latestClose = finite(candidate?.latestClose);
  const latestTime = candidate?.latestTime ?? null;

  if (!candidate || candidate.stale === true || candidate.available !== true) {
    return {
      active: false,
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      establishedAt: priorParent?.establishedAt ?? null,
      establishedBarTime: priorParent?.establishedBarTime ?? null,
      lastQualifiedAt: priorParent?.lastQualifiedAt ?? null,
      lastQualifiedBarTime: priorParent?.lastQualifiedBarTime ?? null,
      activationThresholdPct: priorParent?.activationThresholdPct ?? null,
      activationReturnPct: priorParent?.activationReturnPct ?? null,
      extremeClose: priorParent?.extremeClose ?? null,
      extremeTime: priorParent?.extremeTime ?? null,
      latestClose,
      latestTime,
      persistedWithoutFreshQualification: false,
      invalidationRetracementPct: null,
      invalidationThresholdPct: null,
      stale: candidate?.stale === true,
      reason: candidate?.stale === true
        ? "PARENT_FAILED_CLOSED_STALE_30M_AUTHORITY"
        : "PARENT_FAILED_CLOSED_NO_30M_AUTHORITY",
    };
  }

  if (
    candidate.active === true &&
    (
      candidate.direction === ENGINE29_MOVE_DIRECTIONS.UP ||
      candidate.direction === ENGINE29_MOVE_DIRECTIONS.DOWN
    )
  ) {
    if (
      priorParent?.active === true &&
      priorParent?.direction === candidate.direction
    ) {
      const extremeClose = updateExtreme(
        candidate.direction,
        priorParent?.extremeClose,
        latestClose
      );
      const extremeChanged = extremeClose !== finite(priorParent?.extremeClose);
      return {
        ...priorParent,
        active: true,
        direction: candidate.direction,
        lastQualifiedAt: new Date(now).toISOString(),
        lastQualifiedBarTime: latestTime,
        extremeClose,
        extremeTime: extremeChanged ? latestTime : priorParent?.extremeTime ?? latestTime,
        latestClose,
        latestTime,
        persistedWithoutFreshQualification: false,
        invalidationRetracementPct: 0,
        invalidationThresholdPct: finite(candidate?.thresholdPct),
        stale: false,
        reason: "PARENT_CONTINUED_BY_QUALIFIED_30M_MOVE",
      };
    }

    const next = establish(candidate, now);
    return {
      ...next,
      reason: priorParent?.active === true
        ? "PARENT_REVERSED_BY_QUALIFIED_OPPOSITE_30M_MOVE"
        : next.reason,
    };
  }

  if (
    priorParent?.active !== true ||
    ![
      ENGINE29_MOVE_DIRECTIONS.UP,
      ENGINE29_MOVE_DIRECTIONS.DOWN,
    ].includes(priorParent?.direction)
  ) {
    return {
      active: false,
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      establishedAt: null,
      establishedBarTime: null,
      lastQualifiedAt: null,
      lastQualifiedBarTime: null,
      activationThresholdPct: null,
      activationReturnPct: null,
      extremeClose: latestClose,
      extremeTime: latestTime,
      latestClose,
      latestTime,
      persistedWithoutFreshQualification: false,
      invalidationRetracementPct: null,
      invalidationThresholdPct: finite(candidate?.thresholdPct),
      stale: false,
      reason: "NO_ACTIVE_PARENT_AND_NO_QUALIFIED_30M_CANDIDATE",
    };
  }

  const direction = priorParent.direction;
  const extremeClose = updateExtreme(
    direction,
    priorParent?.extremeClose,
    latestClose
  );
  const extremeChanged = extremeClose !== finite(priorParent?.extremeClose);

  const retracementPct = oppositeRetracementPct(
    direction,
    extremeClose,
    latestClose
  );

  const invalidationThresholdPct = Math.max(
    finite(candidate?.thresholdPct) || 0,
    finite(priorParent?.activationThresholdPct) || 0
  );

  const invalidated =
    Number.isFinite(retracementPct) &&
    Number.isFinite(invalidationThresholdPct) &&
    invalidationThresholdPct > 0 &&
    retracementPct >= invalidationThresholdPct;

  if (invalidated) {
    return {
      ...priorParent,
      active: false,
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      extremeClose,
      extremeTime: extremeChanged ? latestTime : priorParent?.extremeTime ?? latestTime,
      latestClose,
      latestTime,
      persistedWithoutFreshQualification: false,
      invalidationRetracementPct: retracementPct,
      invalidationThresholdPct,
      stale: false,
      reason: "PARENT_INVALIDATED_BY_COMPLETED_30M_RETRACEMENT",
      priorDirection: direction,
    };
  }

  return {
    ...priorParent,
    active: true,
    direction,
    extremeClose,
    extremeTime: extremeChanged ? latestTime : priorParent?.extremeTime ?? latestTime,
    latestClose,
    latestTime,
    persistedWithoutFreshQualification: true,
    invalidationRetracementPct: retracementPct,
    invalidationThresholdPct,
    stale: false,
    reason: "PARENT_PERSISTED_THROUGH_COMPLETED_30M_PAUSE",
  };
}

export default resolveDirectionalMoveParent;
