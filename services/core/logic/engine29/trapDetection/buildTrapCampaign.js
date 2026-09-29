// services/core/logic/engine29/trapDetection/buildTrapCampaign.js
// Engine 29 — persistent trap campaign memory.
// Preserves one exact failed-auction identity across rebuilds.
// No permission, sizing, or execution authority.

import {
  ENGINE29_TRAP_SIDES,
  ENGINE29_TRAP_STATES,
} from "./trapConstants.js";

const RANK = {
  NO_ACTIVE_TRAP: 0,
  LIQUIDITY_TEST: 1,
  LIQUIDITY_SWEEP: 2,
  FAILED_ACCEPTANCE: 3,
  TRAP_FORMING: 4,
  TRAP_CONFIRMED: 5,
  RESOLVING: 6,
  INVALIDATED: 7,
};

const MAX_OBSERVATIONS = 36;

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundQuarter(v) {
  const n = finite(v);
  return n === null ? null : Number((Math.round(n * 4) / 4).toFixed(2));
}

function toIso(now) {
  return new Date(Number(now)).toISOString();
}

function identityFrom(trapDetection) {
  const level = trapDetection?.auctionEvent?.liquidityLevel || null;
  const side = trapDetection?.trapSide || ENGINE29_TRAP_SIDES.NONE;
  const boundary = roundQuarter(level?.boundary);

  if (
    side === ENGINE29_TRAP_SIDES.NONE ||
    !level?.type ||
    boundary === null
  ) {
    return null;
  }

  return {
    key: [side, String(level.type), boundary.toFixed(2)].join("|"),
    side,
    type: String(level.type),
    timeframe: level.timeframe ?? null,
    boundary,
    lo: finite(level.lo),
    hi: finite(level.hi),
    source: level.source ?? null,
  };
}

function observation(trapDetection, timestamp) {
  const primary = trapDetection?.participation?.primary || null;
  const secondary = trapDetection?.participation?.secondary || null;
  const auction = trapDetection?.auctionEvent || null;

  return {
    timestamp,
    state: trapDetection?.state ?? ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP,
    trapSide: trapDetection?.trapSide ?? ENGINE29_TRAP_SIDES.NONE,
    currentPrice: finite(auction?.currentPrice),
    locationQuality: trapDetection?.locationQuality ?? null,
    confirmationQuality: trapDetection?.confirmationQuality ?? null,
    failedAcceptance: auction?.failedAcceptance === true,
    sweep: auction?.sweep || null,
    momentumState: trapDetection?.momentumRepair?.state ?? null,
    engine25: {
      available: primary?.available === true,
      breadthScore: finite(primary?.breadth?.score),
      breadthLabel: primary?.breadth?.label ?? null,
      breadthAlignment: primary?.breadthAlignment ?? null,
      distributionLabel: primary?.stockVolume?.distributionLabel ?? null,
      distributionRawPressure: finite(primary?.stockVolume?.rawPressure),
      volumeAlignment: primary?.volumeAlignment ?? null,
      primarySupportsTrap:
        primary?.primaryParticipationSupportsTrap === true,
      primaryOpposesTrap:
        primary?.primaryParticipationOpposesTrap === true,
    },
    engine29: {
      secondarySupportsTrap:
        secondary?.secondarySupportsTrap === true,
      secondaryOpposesTrap:
        secondary?.secondaryOpposesTrap === true,
      confirmingBlocks: secondary?.confirmingBlocks || [],
      opposingBlocks: secondary?.opposingBlocks || [],
      vix10m: finite(secondary?.volatility?.move10),
    },
    confirmationBlockedBy:
      trapDetection?.confirmationBlockedBy || [],
  };
}

function campaignId(identity, firstObservedAt) {
  const stamp = String(firstObservedAt)
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);

  return [
    "E29TRAP",
    identity.side,
    identity.type,
    identity.boundary.toFixed(2),
    stamp,
  ].join("-");
}

function milestoneName(state) {
  if (state === ENGINE29_TRAP_STATES.LIQUIDITY_TEST) return "firstTestAt";
  if (state === ENGINE29_TRAP_STATES.LIQUIDITY_SWEEP) return "firstSweepAt";
  if (state === ENGINE29_TRAP_STATES.FAILED_ACCEPTANCE) return "failedAcceptanceAt";
  if (state === ENGINE29_TRAP_STATES.TRAP_FORMING) return "formingAt";
  if (state === ENGINE29_TRAP_STATES.TRAP_CONFIRMED) return "confirmedAt";
  return null;
}

function applyMilestone(milestones = {}, state, timestamp) {
  const next = { ...milestones };
  const name = milestoneName(state);

  if (name && !next[name]) {
    next[name] = timestamp;
  }

  return {
    firstTestAt: next.firstTestAt ?? null,
    firstSweepAt: next.firstSweepAt ?? null,
    failedAcceptanceAt: next.failedAcceptanceAt ?? null,
    formingAt: next.formingAt ?? null,
    confirmedAt: next.confirmedAt ?? null,
    resolvingAt: next.resolvingAt ?? null,
    invalidatedAt: next.invalidatedAt ?? null,
  };
}

function higherState(a, b) {
  return (RANK[b] ?? 0) >= (RANK[a] ?? 0) ? b : a;
}

export function buildEngine29TrapCampaign({
  priorCampaign = null,
  trapDetection = null,
  now = Date.now(),
} = {}) {
  const timestamp = toIso(now);
  const identity = identityFrom(trapDetection);
  const detectionState =
    trapDetection?.state ?? ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP;

  if (!identity) {
    if (!priorCampaign) {
      return {
        version: "engine29.trapCampaign.v1",
        active: false,
        campaign: null,
      };
    }

    return {
      version: "engine29.trapCampaign.v1",
      active: priorCampaign?.active === true,
      campaign: {
        ...priorCampaign,
        lastBuildAt: timestamp,
        currentDetectionState: ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP,
        observationGapCount:
          Number(priorCampaign?.observationGapCount || 0) + 1,
      },
    };
  }

  const same =
    priorCampaign?.active === true &&
    priorCampaign?.identityKey === identity.key;

  const obs = observation(trapDetection, timestamp);

  if (!same) {
    return {
      version: "engine29.trapCampaign.v1",
      active: true,
      campaign: {
        campaignId: campaignId(identity, timestamp),
        identityKey: identity.key,
        active: true,
        side: identity.side,
        state: detectionState,
        highestState: detectionState,
        location: identity,
        firstObservedAt: timestamp,
        lastObservedAt: timestamp,
        lastBuildAt: timestamp,
        observationCount: 1,
        observationGapCount: 0,
        milestones: applyMilestone({}, detectionState, timestamp),
        latest: obs,
        observations: [obs],
        noPermissionCreated: true,
        noExecution: true,
      },
    };
  }

  const priorObservations =
    Array.isArray(priorCampaign?.observations)
      ? priorCampaign.observations
      : [];

  return {
    version: "engine29.trapCampaign.v1",
    active: true,
    campaign: {
      ...priorCampaign,
      active: true,
      state: detectionState,
      highestState: higherState(
        priorCampaign?.highestState ||
          priorCampaign?.state ||
          ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP,
        detectionState
      ),
      lastObservedAt: timestamp,
      lastBuildAt: timestamp,
      observationCount:
        Number(priorCampaign?.observationCount || 0) + 1,
      observationGapCount: 0,
      milestones: applyMilestone(
        priorCampaign?.milestones || {},
        detectionState,
        timestamp
      ),
      latest: obs,
      observations: [...priorObservations, obs].slice(-MAX_OBSERVATIONS),
      noPermissionCreated: true,
      noExecution: true,
    },
  };
}

export default buildEngine29TrapCampaign;
