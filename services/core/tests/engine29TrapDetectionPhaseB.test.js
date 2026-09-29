// services/core/tests/engine29TrapDetectionPhaseB.test.js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ENGINE29_TRAP_SIDES,
  ENGINE29_TRAP_STATES,
} from "../logic/engine29/trapDetection/trapConstants.js";
import { detectEngine29TrapAuctionEvent } from "../logic/engine29/trapDetection/detectTrapAuctionEvent.js";
import { resolveEngine29TrapState } from "../logic/engine29/trapDetection/resolveTrapState.js";
import { readEngine25TrapParticipation } from "../logic/engine29/trapDetection/readEngine25TrapParticipation.js";
import { buildEngine29TrapCrossMarketConfirmation } from "../logic/engine29/trapDetection/buildTrapCrossMarketConfirmation.js";

function bar(time, open, high, low, close, completed = true) {
  return { time, open, high, low, close, completed };
}

test("bear trap: low sweep + 30m reclaim reaches FAILED_ACCEPTANCE", () => {
  const t = 1_800_000_000_000;

  const macroLiquidityMap = {
    locationQuality: "VERY_HIGH",
    levels: [
      {
        id: "4H|LOW|1|7700",
        type: "FOUR_HOUR_SWING_LOW",
        timeframe: "4H",
        side: "LOW",
        level: 7700,
        lo: 7700,
        hi: 7700,
      },
    ],
  };

  const esAnchor = {
    liveMonitor: {
      bars: [
        bar(t, 7704, 7705, 7696, 7702, false),
      ],
    },
    structure: {
      fastTactical: {
        bars: [
          bar(t - 3_600_000, 7708, 7710, 7702, 7705, true),
          bar(t - 1_800_000, 7705, 7707, 7694, 7703, true),
        ],
      },
      tactical: {
        bars: [
          bar(t - 7_200_000, 7710, 7712, 7698, 7706, true),
        ],
      },
    },
  };

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap,
    esAnchor,
    now: t + 3_600_000,
  });

  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.BEAR);
  assert.equal(result.state, ENGINE29_TRAP_STATES.FAILED_ACCEPTANCE);
  assert.equal(result.failedAcceptance, true);
  assert.equal(result.liquidityLevel.boundary, 7700);
});

test("bull trap: high sweep + 30m close back under reaches FAILED_ACCEPTANCE", () => {
  const t = 1_800_000_000_000;

  const macroLiquidityMap = {
    locationQuality: "HIGH",
    levels: [
      {
        id: "4H|HIGH|1|7800",
        type: "FOUR_HOUR_SWING_HIGH",
        timeframe: "4H",
        side: "HIGH",
        level: 7800,
        lo: 7800,
        hi: 7800,
      },
    ],
  };

  const esAnchor = {
    liveMonitor: {
      bars: [
        bar(t, 7798, 7805, 7795, 7797, false),
      ],
    },
    structure: {
      fastTactical: {
        bars: [
          bar(t - 3_600_000, 7795, 7799, 7792, 7798, true),
          bar(t - 1_800_000, 7798, 7807, 7794, 7796, true),
        ],
      },
      tactical: {
        bars: [
          bar(t - 7_200_000, 7790, 7806, 7788, 7797, true),
        ],
      },
    },
  };

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap,
    esAnchor,
    now: t + 3_600_000,
  });

  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.BULL);
  assert.equal(result.state, ENGINE29_TRAP_STATES.FAILED_ACCEPTANCE);
  assert.equal(result.failedAcceptance, true);
});

test("forming trap cannot confirm when primary participation is unavailable", () => {
  const result = resolveEngine29TrapState({
    auctionEvent: {
      trapSide: ENGINE29_TRAP_SIDES.BEAR,
      state: ENGINE29_TRAP_STATES.FAILED_ACCEPTANCE,
      failedAcceptance: true,
      reasonCodes: [],
    },
    macroLiquidityMap: {
      locationQuality: "VERY_HIGH",
      reasonCodes: [],
    },
    momentumRepair: {
      state: "STRONG_CONFIRMATION",
      reasonCodes: [],
    },
    primaryParticipation: {
      available: false,
      primaryParticipationSupportsTrap: false,
      primaryParticipationOpposesTrap: false,
      reasonCodes: [],
    },
    secondaryConfirmation: {
      secondarySupportsTrap: true,
      secondaryOpposesTrap: false,
      reasonCodes: [],
    },
  });

  assert.equal(result.state, ENGINE29_TRAP_STATES.TRAP_FORMING);
  assert.ok(
    result.confirmationBlockedBy.includes(
      "ENGINE25_PRIMARY_PARTICIPATION_UNAVAILABLE"
    )
  );
});

test("high-quality failed auction plus aligned participation confirms trap", () => {
  const result = resolveEngine29TrapState({
    auctionEvent: {
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      state: ENGINE29_TRAP_STATES.FAILED_ACCEPTANCE,
      failedAcceptance: true,
      reasonCodes: [],
    },
    macroLiquidityMap: {
      locationQuality: "VERY_HIGH",
      reasonCodes: [],
    },
    momentumRepair: {
      state: "STRONG_CONFIRMATION",
      reasonCodes: [],
    },
    primaryParticipation: {
      available: true,
      primaryParticipationSupportsTrap: true,
      primaryParticipationOpposesTrap: false,
      reasonCodes: [],
    },
    secondaryConfirmation: {
      secondarySupportsTrap: true,
      secondaryOpposesTrap: false,
      reasonCodes: [],
    },
  });

  assert.equal(result.state, ENGINE29_TRAP_STATES.TRAP_CONFIRMED);
  assert.equal(result.confirmationQuality, "FULL_CONFIRMATION");
  assert.deepEqual(result.confirmationBlockedBy, []);
});

test("low-quality location cannot confirm even with participation", () => {
  const result = resolveEngine29TrapState({
    auctionEvent: {
      trapSide: ENGINE29_TRAP_SIDES.BEAR,
      state: ENGINE29_TRAP_STATES.FAILED_ACCEPTANCE,
      failedAcceptance: true,
      reasonCodes: [],
    },
    macroLiquidityMap: {
      locationQuality: "LOW",
      reasonCodes: [],
    },
    momentumRepair: {
      state: "STRONG_CONFIRMATION",
      reasonCodes: [],
    },
    primaryParticipation: {
      available: true,
      primaryParticipationSupportsTrap: true,
      primaryParticipationOpposesTrap: false,
      reasonCodes: [],
    },
    secondaryConfirmation: {
      secondarySupportsTrap: true,
      secondaryOpposesTrap: false,
      reasonCodes: [],
    },
  });

  assert.equal(result.state, ENGINE29_TRAP_STATES.TRAP_FORMING);
  assert.ok(
    result.confirmationBlockedBy.includes(
      "MACRO_LOCATION_NOT_HIGH_QUALITY"
    )
  );
});


test("Engine25 scanner breadth + stock volume are consumed read-only for bull trap", () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "engine29-trap-")
  );
  const filePath = path.join(dir, "sector.json");

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      ok: true,
      updatedAt: "2026-09-29T17:00:00.000Z",
      sources: {
        intraday: {
          ok: true,
          updatedAt: "2026-09-29T17:00:00.000Z",
        },
        eod: {
          ok: true,
          updatedAt: "2026-09-29T16:00:00.000Z",
        },
      },
      breadthParticipation: {
        score: 32,
        label: "BREADTH_PARTICIPATION_WEAK",
        inputs: {
          intraday: {
            avgBreadth: 31,
            avgMomentum: 34,
          },
          eod: {
            avgBreadth: 38,
            avgMomentum: 40,
          },
        },
      },
      distributionPressure: {
        score: 22,
        label: "DISTRIBUTION_PRESSURE_HIGH",
        rawPressure: 78,
        inputs: {
          volumeEvidence: {
            available: true,
            combinedVolumePressure: 86,
            intraday: {
              available: true,
              stocksScanned: 5470,
              stocksWithVolume: 4800,
              coveragePct: 87.75,
              advancingVolumeShare: 0.28,
              decliningVolumeShare: 0.72,
              volumeImbalance: 0.44,
              volumePressure: 91,
              reason: null,
            },
            eod: {
              available: true,
              stocksScanned: 5470,
              stocksWithVolume: 5000,
              coveragePct: 91.41,
              advancingVolumeShare: 0.30,
              decliningVolumeShare: 0.70,
              volumeImbalance: 0.40,
              volumePressure: 88,
              reason: null,
            },
          },
        },
      },
    }),
    "utf8"
  );

  const result = readEngine25TrapParticipation({
    trapSide: ENGINE29_TRAP_SIDES.BULL,
    filePath,
    now: Date.parse("2026-09-29T17:05:00.000Z"),
  });

  assert.equal(result.available, true);
  assert.equal(result.breadthAlignment, "SUPPORTS_TRAP");
  assert.equal(result.volumeAlignment, "SUPPORTS_TRAP");
  assert.equal(result.primaryParticipationSupportsTrap, true);
  assert.equal(result.stockVolume.intraday.coveragePct, 87.75);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("direct VIX may veto otherwise supportive secondary bull-trap confirmation", () => {
  const moveCharacter = {
    directVixAvailable: true,
    underlyingPressure: {
      blocks: {
        leadership: { direction: "DOWN" },
        credit: { direction: "DOWN" },
        financials: { direction: "FLAT" },
      },
    },
  };

  const supportiveVix = buildEngine29TrapCrossMarketConfirmation({
    moveCharacter,
    liveMonitor: {
      metrics: {
        vix: { move10: 0.35 },
      },
    },
    trapSide: ENGINE29_TRAP_SIDES.BULL,
  });

  assert.equal(supportiveVix.secondarySupportsTrap, true);
  assert.equal(supportiveVix.volatility.supportsTrap, true);

  const opposingVix = buildEngine29TrapCrossMarketConfirmation({
    moveCharacter,
    liveMonitor: {
      metrics: {
        vix: { move10: -0.35 },
      },
    },
    trapSide: ENGINE29_TRAP_SIDES.BULL,
  });

  assert.equal(opposingVix.secondarySupportsTrap, false);
  assert.equal(opposingVix.secondaryOpposesTrap, true);
  assert.equal(opposingVix.volatility.opposesTrap, true);
});
