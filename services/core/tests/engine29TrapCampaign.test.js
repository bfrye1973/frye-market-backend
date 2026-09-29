// services/core/tests/engine29TrapCampaign.test.js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ENGINE29_TRAP_SIDES,
  ENGINE29_TRAP_STATES,
} from "../logic/engine29/trapDetection/trapConstants.js";
import { buildEngine29TrapCampaign } from "../logic/engine29/trapDetection/buildTrapCampaign.js";
import {
  readEngine29TrapCampaign,
  writeEngine29TrapCampaign,
} from "../logic/engine29/trapDetection/trapCampaignStore.js";

function detection(state, currentPrice = 7702) {
  return {
    trapSide: ENGINE29_TRAP_SIDES.BEAR,
    state,
    locationQuality: "VERY_HIGH",
    confirmationQuality:
      state === ENGINE29_TRAP_STATES.TRAP_CONFIRMED
        ? "FULL_CONFIRMATION"
        : state === ENGINE29_TRAP_STATES.TRAP_FORMING
          ? "STRONG_PRICE_CONFIRMATION"
          : "RECLAIM_WATCH",
    auctionEvent: {
      currentPrice,
      reclaimObserved: true,
      failedAcceptance:
        state === ENGINE29_TRAP_STATES.TRAP_FORMING ||
        state === ENGINE29_TRAP_STATES.TRAP_CONFIRMED,
      liquidityLevel: {
        type: "FOUR_HOUR_SWING_LOW",
        timeframe: "4H",
        boundary: 7700,
        lo: 7700,
        hi: 7700,
        source: "CONFIRMED_SWING",
      },
      sweep: {
        time: 1000,
        extreme: 7694,
        excursionPoints: 6,
        rejectionDistancePoints: Math.max(0, currentPrice - 7700),
        closeLocationPct: 75,
      },
    },
    momentumRepair: {
      state:
        state === ENGINE29_TRAP_STATES.TRAP_CONFIRMED ||
        state === ENGINE29_TRAP_STATES.TRAP_FORMING
          ? "STRONG_CONFIRMATION"
          : "NO_CONFIRMATION",
    },
    participation: {
      primary: {
        available: true,
        breadth: {
          score: 70,
          label: "BREADTH_PARTICIPATION_HEALTHY",
        },
        breadthAlignment: "SUPPORTS_TRAP",
        stockVolume: {
          distributionLabel: "DISTRIBUTION_PRESSURE_LOW",
          rawPressure: 20,
        },
        volumeAlignment: "SUPPORTS_TRAP",
        primaryParticipationSupportsTrap: true,
        primaryParticipationOpposesTrap: false,
      },
      secondary: {
        secondarySupportsTrap: true,
        secondaryOpposesTrap: false,
        confirmingBlocks: ["leadership", "credit"],
        opposingBlocks: [],
        volatility: { move10: -0.3 },
      },
    },
    confirmationBlockedBy: [],
  };
}

test("campaign begins at TRAP_WATCH and preserves milestones", () => {
  const first = buildEngine29TrapCampaign({
    trapDetection: detection(
      ENGINE29_TRAP_STATES.TRAP_WATCH
    ),
    now: Date.parse("2026-09-29T17:00:00.000Z"),
  });

  assert.equal(first.active, true);
  assert.equal(first.campaign.observationCount, 1);
  assert.equal(
    first.campaign.milestones.watchAt,
    "2026-09-29T17:00:00.000Z"
  );

  const second = buildEngine29TrapCampaign({
    priorCampaign: first.campaign,
    trapDetection: detection(
      ENGINE29_TRAP_STATES.TRAP_CONFIRMED,
      7714
    ),
    now: Date.parse("2026-09-29T17:10:00.000Z"),
  });

  assert.equal(
    second.campaign.campaignId,
    first.campaign.campaignId
  );
  assert.equal(
    second.campaign.highestState,
    ENGINE29_TRAP_STATES.TRAP_CONFIRMED
  );
  assert.equal(second.campaign.observationCount, 2);
  assert.equal(
    second.campaign.milestones.watchAt,
    "2026-09-29T17:00:00.000Z"
  );
  assert.equal(
    second.campaign.milestones.confirmedAt,
    "2026-09-29T17:10:00.000Z"
  );
});

test("liquidity sweep with no trap side does not create a trap campaign", () => {
  const result = buildEngine29TrapCampaign({
    trapDetection: {
      trapSide: ENGINE29_TRAP_SIDES.NONE,
      state: ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP,
      auctionEvent: {
        liquidityLevel: {
          type: "FOUR_HOUR_SWING_LOW",
          boundary: 7700,
        },
      },
    },
    now: Date.parse("2026-09-29T17:00:00.000Z"),
  });

  assert.equal(result.active, false);
  assert.equal(result.campaign, null);
});

test("campaign remembers active identity when current build has no active trap", () => {
  const first = buildEngine29TrapCampaign({
    trapDetection: detection(
      ENGINE29_TRAP_STATES.TRAP_FORMING
    ),
    now: Date.parse("2026-09-29T17:00:00.000Z"),
  });

  const gap = buildEngine29TrapCampaign({
    priorCampaign: first.campaign,
    trapDetection: {
      trapSide: ENGINE29_TRAP_SIDES.NONE,
      state: ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP,
    },
    now: Date.parse("2026-09-29T17:10:00.000Z"),
  });

  assert.equal(gap.active, true);
  assert.equal(gap.campaign.campaignId, first.campaign.campaignId);
  assert.equal(gap.campaign.observationGapCount, 1);
  assert.equal(
    gap.campaign.highestState,
    ENGINE29_TRAP_STATES.TRAP_FORMING
  );
});

test("campaign store round-trips exact campaign payload", () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "engine29-campaign-")
  );
  const filePath = path.join(dir, "campaign.json");

  const payload = {
    version: "engine29.trapCampaign.v1",
    active: true,
    campaign: {
      campaignId: "E29TRAP-BEAR-TEST",
      identityKey:
        "BEAR|FOUR_HOUR_SWING_LOW|7700.00",
      active: true,
      side: "BEAR",
      state: "TRAP_FORMING",
    },
  };

  writeEngine29TrapCampaign(payload, filePath);
  const readBack =
    readEngine29TrapCampaign(filePath);

  assert.deepEqual(
    readBack,
    payload.campaign
  );

  fs.rmSync(dir, {
    recursive: true,
    force: true,
  });
});
