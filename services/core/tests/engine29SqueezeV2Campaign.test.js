import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine29SqueezeV2Campaign,
  ENGINE29_SQUEEZE_V2_STATES,
} from "../logic/engine29/tacticalCharacter/buildSqueezeV2Campaign.js";

function obs(overrides = {}) {
  return {
    available: true,
    dataDegraded: false,
    direction: "UP",
    sourceTimestamp: "2026-10-05T14:04:00.000Z",
    es10mQuality: 55,
    esAbnormalityQuality: 60,
    internalDivergence: 60,
    participationConfirmation: 40,
    directionalBreadthPct: 40,
    squeezePressure: 36,
    watchQualified: true,
    activeQualified: false,
    ...overrides,
  };
}

test("new qualified observation creates WATCH campaign and consumer contract", () => {
  const r = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:04:00Z"),
  });

  assert.equal(r.active, true);
  assert.equal(r.public.state, "SQUEEZE_WATCH");
  assert.equal(r.public.direction, "UP");
  assert.ok(r.public.campaignId.startsWith("E29SQ-UP-"));
  assert.equal(r.public.watchAt, "2026-10-05T14:04:00.000Z");
  assert.equal(r.public.activeAt, null);
  assert.equal(r.public.squeezePressure, 36);
});

test("same campaign stays same identity and can promote WATCH to ACTIVE", () => {
  const first = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:04:00Z"),
  });

  const second = buildEngine29SqueezeV2Campaign({
    priorCampaign: first.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      esAbnormalityQuality: 75,
      internalDivergence: 88,
      participationConfirmation: 12,
      directionalBreadthPct: 33.4,
      squeezePressure: 66,
      activeQualified: true,
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });

  assert.equal(second.public.campaignId, first.public.campaignId);
  assert.equal(second.public.state, "SQUEEZE_ACTIVE");
  assert.equal(second.public.activeAt, "2026-10-05T14:10:00.000Z");
});

test("same ACTIVE campaign does not manufacture a new campaignId", () => {
  const first = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:04:00Z"),
  });
  const active = buildEngine29SqueezeV2Campaign({
    priorCampaign: first.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      squeezePressure: 66,
      esAbnormalityQuality: 75,
      internalDivergence: 88,
      activeQualified: true,
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });
  const next = buildEngine29SqueezeV2Campaign({
    priorCampaign: active.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:20:00.000Z",
      squeezePressure: 60,
      esAbnormalityQuality: 70,
      internalDivergence: 86,
      activeQualified: true,
    }),
    now: Date.parse("2026-10-05T14:13:00Z"),
  });

  assert.equal(next.public.campaignId, first.public.campaignId);
  assert.ok([
    "SQUEEZE_HOLDING",
    "SQUEEZE_ACTIVE",
    "SQUEEZE_ACCELERATING",
  ].includes(next.public.state));
});

test("broadening transitions campaign to broad move terminal state", () => {
  const first = buildEngine29SqueezeV2Campaign({
    observation: obs({ participationConfirmation: 12 }),
    now: Date.parse("2026-10-05T14:04:00Z"),
  });
  const active = buildEngine29SqueezeV2Campaign({
    priorCampaign: first.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      participationConfirmation: 15,
      squeezePressure: 65,
      esAbnormalityQuality: 75,
      internalDivergence: 85,
      activeQualified: true,
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });
  const broad = buildEngine29SqueezeV2Campaign({
    priorCampaign: active.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T15:08:17.000Z",
      participationConfirmation: 94,
      internalDivergence: 6,
      squeezePressure: 1,
      esAbnormalityQuality: 5,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T15:08:17Z"),
  });

  assert.equal(broad.active, false);
  assert.equal(broad.public.state, "SQUEEZE_TRANSITIONED_TO_BROAD_MOVE");
  assert.equal(broad.public.campaignId, first.public.campaignId);
  assert.equal(broad.public.endedAt, "2026-10-05T15:08:17.000Z");
});

test("temporary missing data preserves active campaign identity and fails closed", () => {
  const first = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:04:00Z"),
  });

  const gap = buildEngine29SqueezeV2Campaign({
    priorCampaign: first.campaign,
    observation: { available: false, dataDegraded: true },
    now: Date.parse("2026-10-05T14:07:00Z"),
  });

  assert.equal(gap.active, true);
  assert.equal(gap.public.campaignId, first.public.campaignId);
  assert.equal(gap.public.dataDegraded, true);
  assert.equal(gap.public.available, false);
  assert.equal(gap.public.state, "SQUEEZE_WATCH");
});

test("missing data with no campaign publishes fail-closed NONE contract", () => {
  const r = buildEngine29SqueezeV2Campaign({
    observation: { available: false, dataDegraded: true },
    now: Date.parse("2026-10-05T14:04:00Z"),
  });

  assert.equal(r.active, false);
  assert.equal(r.public.state, "NO_ACTIVE_SQUEEZE");
  assert.equal(r.public.campaignId, null);
  assert.equal(r.public.available, false);
});

test("opposite meaningful ES direction terminates old campaign", () => {
  const first = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:04:00Z"),
  });

  const failed = buildEngine29SqueezeV2Campaign({
    priorCampaign: first.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:20:00.000Z",
      direction: "DOWN",
      es10mQuality: 70,
      esAbnormalityQuality: 75,
      internalDivergence: 70,
      squeezePressure: 52,
      activeQualified: true,
    }),
    now: Date.parse("2026-10-05T14:20:00Z"),
  });

  assert.equal(failed.active, false);
  assert.equal(failed.public.state, "SQUEEZE_FAILED");
  assert.equal(failed.public.campaignId, first.public.campaignId);
});

test("after terminal state a new opposite WATCH gets a new campaignId", () => {
  const up = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:04:00Z"),
  });
  const failed = buildEngine29SqueezeV2Campaign({
    priorCampaign: up.campaign,
    observation: obs({ sourceTimestamp: "2026-10-05T14:20:00.000Z", direction: "DOWN", es10mQuality: 70 }),
    now: Date.parse("2026-10-05T14:20:00Z"),
  });
  const down = buildEngine29SqueezeV2Campaign({
    priorCampaign: failed.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:30:00.000Z",
      direction: "DOWN",
      directionalBreadthPct: 31,
    }),
    now: Date.parse("2026-10-05T14:30:00Z"),
  });

  assert.equal(down.public.state, "SQUEEZE_WATCH");
  assert.equal(down.public.direction, "DOWN");
  assert.notEqual(down.public.campaignId, up.public.campaignId);
});

test("consumer state enum remains exact and alias-free", () => {
  assert.deepEqual(Object.values(ENGINE29_SQUEEZE_V2_STATES), [
    "NO_ACTIVE_SQUEEZE",
    "SQUEEZE_WATCH",
    "SQUEEZE_FORMING",
    "SQUEEZE_ACTIVE",
    "SQUEEZE_ACCELERATING",
    "SQUEEZE_HOLDING",
    "SQUEEZE_WEAKENING",
    "SQUEEZE_FAILED",
    "SQUEEZE_TRANSITIONED_TO_BROAD_MOVE",
  ]);
});

test("consumer contract has no trading authority", () => {
  const r = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:04:00Z"),
  });

  assert.equal(r.public.safety.parentMoveAuthority, false);
  assert.equal(r.public.safety.directionAuthority, false);
  assert.equal(r.public.safety.permissionAuthority, false);
  assert.equal(r.public.safety.executionAuthority, false);
});


test("WATCH expires after two consecutive valid observations lose WATCH evidence", () => {
  const watch = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });

  const weak1 = buildEngine29SqueezeV2Campaign({
    priorCampaign: watch.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:20:00.000Z",
      es10mQuality: 10,
      esAbnormalityQuality: 15,
      internalDivergence: 80,
      participationConfirmation: 20,
      squeezePressure: 12,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:20:00Z"),
  });

  assert.equal(weak1.active, true);
  assert.equal(weak1.public.state, "SQUEEZE_WATCH");
  assert.equal(weak1.campaign.evidenceLossCount, 1);

  const weak2 = buildEngine29SqueezeV2Campaign({
    priorCampaign: weak1.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:30:00.000Z",
      es10mQuality: 8,
      esAbnormalityQuality: 10,
      internalDivergence: 78,
      participationConfirmation: 22,
      squeezePressure: 8,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:30:00Z"),
  });

  assert.equal(weak2.active, false);
  assert.equal(weak2.public.state, "SQUEEZE_FAILED");
  assert.equal(weak2.campaign.evidenceLossCount, 2);
});

test("FORMING expires after persistent valid evidence loss", () => {
  const watch = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:00:00Z"),
  });

  const forming = buildEngine29SqueezeV2Campaign({
    priorCampaign: watch.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      watchQualified: true,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });

  assert.equal(forming.public.state, "SQUEEZE_FORMING");

  const weak1 = buildEngine29SqueezeV2Campaign({
    priorCampaign: forming.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:20:00.000Z",
      es10mQuality: 20,
      esAbnormalityQuality: 20,
      squeezePressure: 15,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:20:00Z"),
  });

  const weak2 = buildEngine29SqueezeV2Campaign({
    priorCampaign: weak1.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:30:00.000Z",
      es10mQuality: 15,
      esAbnormalityQuality: 15,
      squeezePressure: 10,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:30:00Z"),
  });

  assert.equal(weak2.active, false);
  assert.equal(weak2.public.state, "SQUEEZE_FAILED");
});

test("ACTIVE weakens then terminates after persistent core evidence collapse", () => {
  const watch = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:00:00Z"),
  });

  const active = buildEngine29SqueezeV2Campaign({
    priorCampaign: watch.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      esAbnormalityQuality: 75,
      internalDivergence: 85,
      participationConfirmation: 15,
      squeezePressure: 64,
      activeQualified: true,
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });

  const collapse1 = buildEngine29SqueezeV2Campaign({
    priorCampaign: active.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:20:00.000Z",
      es10mQuality: 15,
      esAbnormalityQuality: 20,
      internalDivergence: 35,
      participationConfirmation: 40,
      squeezePressure: 7,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:20:00Z"),
  });

  assert.equal(collapse1.active, true);
  assert.equal(collapse1.public.state, "SQUEEZE_WEAKENING");
  assert.equal(collapse1.campaign.evidenceLossCount, 1);

  const collapse2 = buildEngine29SqueezeV2Campaign({
    priorCampaign: collapse1.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:30:00.000Z",
      es10mQuality: 10,
      esAbnormalityQuality: 15,
      internalDivergence: 30,
      participationConfirmation: 42,
      squeezePressure: 5,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:30:00Z"),
  });

  assert.equal(collapse2.active, false);
  assert.equal(collapse2.public.state, "SQUEEZE_FAILED");
});

test("DATA GAP preserves identity and does not increment evidence-loss persistence", () => {
  const watch = buildEngine29SqueezeV2Campaign({
    observation: obs(),
    now: Date.parse("2026-10-05T14:00:00Z"),
  });

  const weak = buildEngine29SqueezeV2Campaign({
    priorCampaign: watch.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      es10mQuality: 15,
      esAbnormalityQuality: 15,
      squeezePressure: 10,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });

  assert.equal(weak.campaign.evidenceLossCount, 1);

  const gap = buildEngine29SqueezeV2Campaign({
    priorCampaign: weak.campaign,
    observation: {
      available: false,
      dataDegraded: true,
    },
    now: Date.parse("2026-10-05T14:20:00Z"),
  });

  assert.equal(gap.active, true);
  assert.equal(gap.public.campaignId, watch.public.campaignId);
  assert.equal(gap.campaign.evidenceLossCount, 1);
  assert.equal(gap.public.dataDegraded, true);
});


test("WATCH evidence-loss count advances only on a new canonical 10m sourceTimestamp", () => {
  const watch = buildEngine29SqueezeV2Campaign({
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });

  const weakObservation = obs({
    sourceTimestamp: "2026-10-05T14:20:00.000Z",
    es10mQuality: 10,
    esAbnormalityQuality: 15,
    internalDivergence: 80,
    participationConfirmation: 20,
    squeezePressure: 12,
    watchQualified: false,
    activeQualified: false,
  });

  const weak1 = buildEngine29SqueezeV2Campaign({
    priorCampaign: watch.campaign,
    observation: weakObservation,
    now: Date.parse("2026-10-05T14:20:00Z"),
  });

  assert.equal(weak1.campaign.evidenceLossCount, 1);
  assert.equal(weak1.campaign.history.length, 2);

  const repeat1 = buildEngine29SqueezeV2Campaign({
    priorCampaign: weak1.campaign,
    observation: weakObservation,
    now: Date.parse("2026-10-05T14:23:00Z"),
  });

  const repeat2 = buildEngine29SqueezeV2Campaign({
    priorCampaign: repeat1.campaign,
    observation: weakObservation,
    now: Date.parse("2026-10-05T14:26:00Z"),
  });

  assert.equal(repeat1.active, true);
  assert.equal(repeat1.public.state, "SQUEEZE_WATCH");
  assert.equal(repeat1.campaign.evidenceLossCount, 1);
  assert.equal(repeat1.campaign.history.length, 2);

  assert.equal(repeat2.active, true);
  assert.equal(repeat2.public.state, "SQUEEZE_WATCH");
  assert.equal(repeat2.campaign.evidenceLossCount, 1);
  assert.equal(repeat2.campaign.history.length, 2);

  const weak2 = buildEngine29SqueezeV2Campaign({
    priorCampaign: repeat2.campaign,
    observation: obs({
      ...weakObservation,
      sourceTimestamp: "2026-10-05T14:30:00.000Z",
      esAbnormalityQuality: 10,
      squeezePressure: 8,
    }),
    now: Date.parse("2026-10-05T14:30:00Z"),
  });

  assert.equal(weak2.active, false);
  assert.equal(weak2.public.state, "SQUEEZE_FAILED");
  assert.equal(weak2.campaign.evidenceLossCount, 2);
  assert.equal(weak2.campaign.history.length, 3);
});

test("ACTIVE collapse persistence ignores repeated 3m builds of the same 10m observation", () => {
  const watch = buildEngine29SqueezeV2Campaign({
    observation: obs({
      sourceTimestamp: "2026-10-05T14:00:00.000Z",
    }),
    now: Date.parse("2026-10-05T14:00:00Z"),
  });

  const active = buildEngine29SqueezeV2Campaign({
    priorCampaign: watch.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      esAbnormalityQuality: 75,
      internalDivergence: 85,
      participationConfirmation: 15,
      squeezePressure: 64,
      activeQualified: true,
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });

  const collapseObservation = obs({
    sourceTimestamp: "2026-10-05T14:20:00.000Z",
    es10mQuality: 15,
    esAbnormalityQuality: 20,
    internalDivergence: 35,
    participationConfirmation: 40,
    squeezePressure: 7,
    watchQualified: false,
    activeQualified: false,
  });

  const collapse1 = buildEngine29SqueezeV2Campaign({
    priorCampaign: active.campaign,
    observation: collapseObservation,
    now: Date.parse("2026-10-05T14:20:00Z"),
  });

  assert.equal(collapse1.public.state, "SQUEEZE_WEAKENING");
  assert.equal(collapse1.campaign.evidenceLossCount, 1);

  const repeat1 = buildEngine29SqueezeV2Campaign({
    priorCampaign: collapse1.campaign,
    observation: collapseObservation,
    now: Date.parse("2026-10-05T14:23:00Z"),
  });

  const repeat2 = buildEngine29SqueezeV2Campaign({
    priorCampaign: repeat1.campaign,
    observation: collapseObservation,
    now: Date.parse("2026-10-05T14:26:00Z"),
  });

  assert.equal(repeat1.public.state, "SQUEEZE_WEAKENING");
  assert.equal(repeat1.campaign.evidenceLossCount, 1);
  assert.equal(repeat2.public.state, "SQUEEZE_WEAKENING");
  assert.equal(repeat2.campaign.evidenceLossCount, 1);

  const collapse2 = buildEngine29SqueezeV2Campaign({
    priorCampaign: repeat2.campaign,
    observation: obs({
      ...collapseObservation,
      sourceTimestamp: "2026-10-05T14:30:00.000Z",
      esAbnormalityQuality: 15,
      internalDivergence: 30,
      squeezePressure: 5,
    }),
    now: Date.parse("2026-10-05T14:30:00Z"),
  });

  assert.equal(collapse2.active, false);
  assert.equal(collapse2.public.state, "SQUEEZE_FAILED");
  assert.equal(collapse2.campaign.evidenceLossCount, 2);
});

test("duplicate sourceTimestamp cannot advance broadening velocity or 10m/20m history", () => {
  const watch = buildEngine29SqueezeV2Campaign({
    observation: obs({
      sourceTimestamp: "2026-10-05T14:00:00.000Z",
      participationConfirmation: 20,
    }),
    now: Date.parse("2026-10-05T14:00:00Z"),
  });

  const next = buildEngine29SqueezeV2Campaign({
    priorCampaign: watch.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      participationConfirmation: 30,
      watchQualified: true,
    }),
    now: Date.parse("2026-10-05T14:10:00Z"),
  });

  assert.equal(next.campaign.history.length, 2);
  assert.equal(next.campaign.broadeningVelocity10, 10);
  assert.equal(next.campaign.broadeningVelocity20, null);

  const duplicate = buildEngine29SqueezeV2Campaign({
    priorCampaign: next.campaign,
    observation: obs({
      sourceTimestamp: "2026-10-05T14:10:00.000Z",
      participationConfirmation: 95,
      internalDivergence: 5,
      squeezePressure: 2,
      watchQualified: false,
      activeQualified: false,
    }),
    now: Date.parse("2026-10-05T14:13:00Z"),
  });

  assert.equal(duplicate.campaign.history.length, 2);
  assert.equal(duplicate.campaign.broadeningVelocity10, 10);
  assert.equal(duplicate.campaign.broadeningVelocity20, null);
  assert.equal(duplicate.public.state, next.public.state);
});
