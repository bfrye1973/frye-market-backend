// services/core/logic/engine29/tacticalCharacter/buildSqueezeV2Campaign.js
// Persistent Squeeze v2 lifecycle.
// Campaign identity begins at WATCH and remains stable until terminal/reset.
// No Parent MOVE, permission, sizing, management, or execution authority.

export const ENGINE29_SQUEEZE_V2_STATES = Object.freeze({
  NONE: "NO_ACTIVE_SQUEEZE",
  WATCH: "SQUEEZE_WATCH",
  FORMING: "SQUEEZE_FORMING",
  ACTIVE: "SQUEEZE_ACTIVE",
  ACCELERATING: "SQUEEZE_ACCELERATING",
  HOLDING: "SQUEEZE_HOLDING",
  WEAKENING: "SQUEEZE_WEAKENING",
  FAILED: "SQUEEZE_FAILED",
  BROAD: "SQUEEZE_TRANSITIONED_TO_BROAD_MOVE",
});

// Evidence-loss expiry is confirmed over two consecutive valid 10m observations
// (20 minutes). Missing/degraded data never increments this counter.
export const SQUEEZE_V2_EVIDENCE_LOSS_CONFIRMATIONS = 2;

const ACTIVE_FAMILY = new Set([
  ENGINE29_SQUEEZE_V2_STATES.WATCH,
  ENGINE29_SQUEEZE_V2_STATES.FORMING,
  ENGINE29_SQUEEZE_V2_STATES.ACTIVE,
  ENGINE29_SQUEEZE_V2_STATES.ACCELERATING,
  ENGINE29_SQUEEZE_V2_STATES.HOLDING,
  ENGINE29_SQUEEZE_V2_STATES.WEAKENING,
]);

function finite(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(now) {
  return new Date(Number(now)).toISOString();
}

function campaignId(direction, at) {
  const stamp = String(at).replace(/[-:.TZ]/g, "").slice(0, 14);
  return `E29SQ-${direction}-${stamp}`;
}

function metricObservation(observation, timestamp) {
  return {
    timestamp,
    sourceTimestamp: observation?.sourceTimestamp ?? null,
    direction: observation?.direction ?? null,
    es10mReturnPct: finite(observation?.es10mReturnPct),
    es20mReturnPct: finite(observation?.es20mReturnPct),
    esAbnormalityQuality: finite(observation?.esAbnormalityQuality),
    internalDivergence: finite(observation?.internalDivergence),
    participationConfirmation: finite(observation?.participationConfirmation),
    directionalBreadthPct: finite(observation?.directionalBreadthPct),
    squeezePressure: finite(observation?.squeezePressure),
    watchQualified: observation?.watchQualified === true,
    activeQualified: observation?.activeQualified === true,
  };
}

function velocities(history, currentParticipation) {
  const prior = history.at(-1)?.participationConfirmation;
  const twoAgo = history.at(-2)?.participationConfirmation;

  return {
    broadeningVelocity10:
      Number.isFinite(currentParticipation) && Number.isFinite(prior)
        ? currentParticipation - prior
        : null,
    broadeningVelocity20:
      Number.isFinite(currentParticipation) && Number.isFinite(twoAgo)
        ? currentParticipation - twoAgo
        : null,
  };
}

function publicContract({
  campaign = null,
  observation = null,
  state = ENGINE29_SQUEEZE_V2_STATES.NONE,
  timestamp,
  dataDegraded = false,
  endedAt = null,
} = {}) {
  const active = ACTIVE_FAMILY.has(state);
  const obs = observation || {};
  const metrics = campaign?.latest || obs;

  return {
    version: "engine29.squeezeCampaign.v2",
    available: dataDegraded !== true && Boolean(observation?.available),
    dataDegraded: dataDegraded === true,

    campaignId: campaign?.campaignId ?? null,
    direction: campaign?.direction ?? null,
    state,

    squeezePressure: finite(metrics?.squeezePressure),
    esAbnormalityQuality: finite(metrics?.esAbnormalityQuality),
    internalDivergence: finite(metrics?.internalDivergence),
    participationConfirmation: finite(metrics?.participationConfirmation),
    directionalBreadthPct: finite(metrics?.directionalBreadthPct),

    broadeningVelocity10: finite(campaign?.broadeningVelocity10),
    broadeningVelocity20: finite(campaign?.broadeningVelocity20),

    establishedAt: campaign?.establishedAt ?? null,
    watchAt: campaign?.watchAt ?? null,
    formingAt: campaign?.formingAt ?? null,
    activeAt: campaign?.activeAt ?? null,
    acceleratingAt: campaign?.acceleratingAt ?? null,
    holdingAt: campaign?.holdingAt ?? null,
    weakeningAt: campaign?.weakeningAt ?? null,
    lastUpdatedAt: timestamp ?? campaign?.lastUpdatedAt ?? null,
    endedAt: endedAt ?? campaign?.endedAt ?? null,

    counterToParent: campaign?.counterToParent === true,

    active,
    reasonCodes: [
      ...(campaign?.reasonCodes || []),
      dataDegraded ? "SQUEEZE_V2_DATA_DEGRADED" : null,
    ].filter(Boolean),

    safety: {
      parentMoveAuthority: false,
      directionAuthority: false,
      permissionAuthority: false,
      executionAuthority: false,
    },
  };
}

function isEvidenceLoss(state, observation) {
  if (
    state === ENGINE29_SQUEEZE_V2_STATES.WATCH ||
    state === ENGINE29_SQUEEZE_V2_STATES.FORMING
  ) {
    return observation?.watchQualified !== true;
  }

  if (
    [
      ENGINE29_SQUEEZE_V2_STATES.ACTIVE,
      ENGINE29_SQUEEZE_V2_STATES.HOLDING,
      ENGINE29_SQUEEZE_V2_STATES.ACCELERATING,
      ENGINE29_SQUEEZE_V2_STATES.WEAKENING,
    ].includes(state)
  ) {
    const pressure = finite(observation?.squeezePressure);
    const divergence = finite(observation?.internalDivergence);
    const esQuality = finite(observation?.esAbnormalityQuality);

    return (
      Number.isFinite(pressure) &&
      Number.isFinite(divergence) &&
      Number.isFinite(esQuality) &&
      pressure < 25 &&
      (divergence < 45 || esQuality < 35)
    );
  }

  return false;
}

function nextState({ prior, observation, v10, v20, evidenceLossCount = 0 }) {
  const state = prior?.state || ENGINE29_SQUEEZE_V2_STATES.NONE;
  const participation = finite(observation?.participationConfirmation);
  const pressure = finite(observation?.squeezePressure);
  const divergence = finite(observation?.internalDivergence);
  const esQuality = finite(observation?.esAbnormalityQuality);
  const priorPressure = finite(prior?.latest?.squeezePressure);

  if (observation?.direction && observation.direction !== prior?.direction) {
    if (Number(observation?.es10mQuality) >= 45 || Number(esQuality) >= 50) {
      return ENGINE29_SQUEEZE_V2_STATES.FAILED;
    }
    return state;
  }

  const broadened =
    participation >= 70 &&
    (
      (Number.isFinite(v10) && v10 >= 20) ||
      (Number.isFinite(v20) && v20 >= 20)
    );

  if (broadened) {
    return ENGINE29_SQUEEZE_V2_STATES.BROAD;
  }

  if (
    evidenceLossCount >= SQUEEZE_V2_EVIDENCE_LOSS_CONFIRMATIONS
  ) {
    return ENGINE29_SQUEEZE_V2_STATES.FAILED;
  }

  if (
    state === ENGINE29_SQUEEZE_V2_STATES.WATCH &&
    observation?.watchQualified === true
  ) {
    return observation?.activeQualified === true
      ? ENGINE29_SQUEEZE_V2_STATES.ACTIVE
      : ENGINE29_SQUEEZE_V2_STATES.FORMING;
  }

  if (
    state === ENGINE29_SQUEEZE_V2_STATES.FORMING &&
    observation?.activeQualified === true
  ) {
    return ENGINE29_SQUEEZE_V2_STATES.ACTIVE;
  }

  if (
    [
      ENGINE29_SQUEEZE_V2_STATES.ACTIVE,
      ENGINE29_SQUEEZE_V2_STATES.HOLDING,
      ENGINE29_SQUEEZE_V2_STATES.ACCELERATING,
      ENGINE29_SQUEEZE_V2_STATES.WEAKENING,
    ].includes(state)
  ) {
    if (
      observation?.activeQualified === true &&
      Number.isFinite(priorPressure) &&
      Number.isFinite(pressure) &&
      pressure >= priorPressure + 10 &&
      Number(esQuality) >= Number(prior?.latest?.esAbnormalityQuality || 0) + 10
    ) {
      return ENGINE29_SQUEEZE_V2_STATES.ACCELERATING;
    }

    if (Number.isFinite(v20) && v20 >= 20) {
      return ENGINE29_SQUEEZE_V2_STATES.WEAKENING;
    }

    if (
      Number(pressure) >= 35 &&
      Number(divergence) >= 45
    ) {
      return ENGINE29_SQUEEZE_V2_STATES.HOLDING;
    }

    return ENGINE29_SQUEEZE_V2_STATES.WEAKENING;
  }

  return state;
}

function applyMilestone(campaign, state, timestamp) {
  const next = { ...campaign };
  const field = {
    [ENGINE29_SQUEEZE_V2_STATES.WATCH]: "watchAt",
    [ENGINE29_SQUEEZE_V2_STATES.FORMING]: "formingAt",
    [ENGINE29_SQUEEZE_V2_STATES.ACTIVE]: "activeAt",
    [ENGINE29_SQUEEZE_V2_STATES.ACCELERATING]: "acceleratingAt",
    [ENGINE29_SQUEEZE_V2_STATES.HOLDING]: "holdingAt",
    [ENGINE29_SQUEEZE_V2_STATES.WEAKENING]: "weakeningAt",
  }[state];

  if (field && !next[field]) next[field] = timestamp;
  return next;
}

export function buildEngine29SqueezeV2Campaign({
  priorCampaign = null,
  observation = null,
  parentMove = null,
  now = Date.now(),
} = {}) {
  const timestamp = iso(now);

  if (observation?.available !== true) {
    if (priorCampaign && ACTIVE_FAMILY.has(priorCampaign.state)) {
      const held = {
        ...priorCampaign,
        dataDegraded: true,
        lastUpdatedAt: timestamp,
        reasonCodes: [
          ...(priorCampaign.reasonCodes || []),
          "SQUEEZE_V2_CAMPAIGN_PRESERVED_DURING_DATA_GAP",
        ],
      };
      return {
        active: true,
        campaign: held,
        public: publicContract({
          campaign: held,
          observation,
          state: held.state,
          timestamp,
          dataDegraded: true,
        }),
      };
    }

    return {
      active: false,
      campaign: null,
      public: publicContract({
        campaign: null,
        observation,
        state: ENGINE29_SQUEEZE_V2_STATES.NONE,
        timestamp,
        dataDegraded: true,
      }),
    };
  }

  if (!priorCampaign || !ACTIVE_FAMILY.has(priorCampaign.state)) {
    if (observation?.watchQualified !== true) {
      return {
        active: false,
        campaign: null,
        public: publicContract({
          campaign: null,
          observation,
          state: ENGINE29_SQUEEZE_V2_STATES.NONE,
          timestamp,
        }),
      };
    }

    const direction = observation.direction;
    const latest = metricObservation(observation, timestamp);
    let campaign = {
      campaignId: campaignId(direction, timestamp),
      direction,
      state: ENGINE29_SQUEEZE_V2_STATES.WATCH,
      establishedAt: timestamp,
      watchAt: timestamp,
      formingAt: null,
      activeAt: null,
      acceleratingAt: null,
      holdingAt: null,
      weakeningAt: null,
      endedAt: null,
      lastUpdatedAt: timestamp,
      counterToParent:
        parentMove?.active === true &&
        ["UP", "DOWN"].includes(parentMove?.direction) &&
        parentMove.direction !== direction,
      latest,
      history: [latest],
      broadeningVelocity10: null,
      broadeningVelocity20: null,
      evidenceLossCount: 0,
      dataDegraded: false,
      reasonCodes: ["SQUEEZE_V2_NEW_CAMPAIGN_WATCH"],
    };

    return {
      active: true,
      campaign,
      public: publicContract({
        campaign,
        observation,
        state: campaign.state,
        timestamp,
      }),
    };
  }

  const history = Array.isArray(priorCampaign.history)
    ? priorCampaign.history
    : [];

  const currentParticipation = finite(observation.participationConfirmation);
  const { broadeningVelocity10, broadeningVelocity20 } =
    velocities(history, currentParticipation);

  const evidenceLoss =
    isEvidenceLoss(priorCampaign.state, observation);

  const evidenceLossCount =
    evidenceLoss
      ? Number(priorCampaign.evidenceLossCount || 0) + 1
      : 0;

  const state = nextState({
    prior: priorCampaign,
    observation,
    v10: broadeningVelocity10,
    v20: broadeningVelocity20,
    evidenceLossCount,
  });

  const latest = metricObservation(observation, timestamp);
  let campaign = {
    ...priorCampaign,
    state,
    latest,
    history: [...history, latest].slice(-36),
    broadeningVelocity10,
    broadeningVelocity20,
    evidenceLossCount,
    lastUpdatedAt: timestamp,
    dataDegraded: false,
    reasonCodes: [
      ...(priorCampaign.reasonCodes || []),
      evidenceLoss
        ? `SQUEEZE_V2_VALID_EVIDENCE_LOSS_${evidenceLossCount}_OF_${SQUEEZE_V2_EVIDENCE_LOSS_CONFIRMATIONS}`
        : "SQUEEZE_V2_EVIDENCE_LOSS_RESET",
      state === ENGINE29_SQUEEZE_V2_STATES.FAILED &&
      evidenceLossCount >= SQUEEZE_V2_EVIDENCE_LOSS_CONFIRMATIONS
        ? "SQUEEZE_V2_EXPIRED_AFTER_PERSISTENT_VALID_EVIDENCE_LOSS"
        : null,
      `SQUEEZE_V2_STATE_${state}`,
    ].filter(Boolean),
  };

  campaign = applyMilestone(campaign, state, timestamp);

  if (
    state === ENGINE29_SQUEEZE_V2_STATES.FAILED ||
    state === ENGINE29_SQUEEZE_V2_STATES.BROAD
  ) {
    campaign.endedAt = timestamp;
    return {
      active: false,
      campaign,
      public: publicContract({
        campaign,
        observation,
        state,
        timestamp,
        endedAt: timestamp,
      }),
    };
  }

  return {
    active: true,
    campaign,
    public: publicContract({
      campaign,
      observation,
      state,
      timestamp,
    }),
  };
}

export default buildEngine29SqueezeV2Campaign;
