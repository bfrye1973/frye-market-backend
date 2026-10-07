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
    observation: obs({ direction: "DOWN", es10mQuality: 70 }),
    now: Date.parse("2026-10-05T14:20:00Z"),
  });
  const down = buildEngine29SqueezeV2Campaign({
    priorCampaign: failed.campaign,
    observation: obs({
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
