// services/core/tests/engine29TrapDetectionPhaseB.test.js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ENGINE29_AUCTION_RESULTS,
  ENGINE29_LIQUIDITY_EVENT_STATES,
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



test("local 4H plus derived 2H and 1H highs do not become macro liquidity without institutional or macro-extreme support", () => {
  const t = 1_800_000_000_000;

  const macro = {
    locationQuality: "LOW",
    levels: [
      {
        id: "4H|HIGH|a|7739.25",
        type: "FOUR_HOUR_SWING_HIGH",
        timeframe: "4H",
        side: "HIGH",
        level: 7739.25,
        lo: 7739.25,
        hi: 7739.25,
        eventEligible: false,
        significance: "STRUCTURAL_ONLY",
      },
      {
        id: "2H|HIGH|b|7739.25",
        type: "TWO_HOUR_SWING_HIGH",
        timeframe: "2H",
        side: "HIGH",
        level: 7739.25,
        lo: 7739.25,
        hi: 7739.25,
        eventEligible: false,
        significance: "STRUCTURAL_ONLY",
      },
      {
        id: "1H|HIGH|c|7742",
        type: "ONE_HOUR_SWING_HIGH",
        timeframe: "1H",
        side: "HIGH",
        level: 7742,
        lo: 7742,
        hi: 7742,
        eventEligible: false,
        significance: "STRUCTURAL_ONLY",
      },
    ],
  };

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap: macro,
    esAnchor: {
      liveMonitor: {
        bars: [
          bar(t, 7738.5, 7741.0, 7737.0, 7740.0, false),
        ],
      },
      structure: {
        fastTactical: {
          bars: [
            bar(t - 3_600_000, 7730, 7744, 7728, 7738, true),
            bar(t - 1_800_000, 7738, 7743, 7734, 7739, true),
          ],
        },
        tactical: { bars: [] },
      },
    },
    now: t + 10 * 60 * 1000,
  });

  assert.equal(
    result.liquidityEvent.state,
    ENGINE29_LIQUIDITY_EVENT_STATES.NO_LIQUIDITY_EVENT
  );
  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.NONE);
});

test("structural-only swing is ignored by live liquidity detection", () => {
  const t = 1_800_000_000_000;

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap: {
      locationQuality: "LOW",
      levels: [{
        id: "4H|HIGH|internal|7739.25",
        type: "FOUR_HOUR_SWING_HIGH",
        timeframe: "4H",
        side: "HIGH",
        level: 7739.25,
        lo: 7739.25,
        hi: 7739.25,
        eventEligible: false,
        significance: "STRUCTURAL_ONLY",
      }],
    },
    esAnchor: {
      liveMonitor: {
        bars: [
          bar(t, 7738.5, 7741.0, 7737.5, 7740.5, false),
        ],
      },
      structure: {
        fastTactical: {
          bars: [
            bar(t - 3_600_000, 7734, 7742, 7730, 7738, true),
            bar(t - 1_800_000, 7738, 7743, 7733, 7739, true),
          ],
        },
        tactical: { bars: [] },
      },
    },
    now: t + 10 * 60 * 1000,
  });

  assert.equal(
    result.liquidityEvent.state,
    ENGINE29_LIQUIDITY_EVENT_STATES.NO_LIQUIDITY_EVENT
  );
  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.NONE);
});

test("bar fully below a prior low is acceptance travel, not a fresh liquidity sweep", () => {
  const t = 1_800_000_000_000;

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap: {
      locationQuality: "VERY_HIGH",
      levels: [{
        id: "4H|LOW|accepted|7752.75",
        type: "FOUR_HOUR_SWING_LOW",
        timeframe: "4H",
        side: "LOW",
        level: 7752.75,
        lo: 7752.75,
        hi: 7752.75,
        eventEligible: true,
        significance: "MACRO_CONFLUENCE",
      }],
    },
    esAnchor: {
      liveMonitor: {
        bars: [
          bar(t, 7742.5, 7743.0, 7742.25, 7742.75, false),
        ],
      },
      structure: {
        fastTactical: {
          bars: [
            bar(t - 1_800_000, 7739.0, 7749.25, 7738.0, 7743.75, true),
          ],
        },
        tactical: { bars: [] },
      },
    },
    now: t + 10 * 60 * 1000,
  });

  assert.equal(
    result.liquidityEvent.state,
    ENGINE29_LIQUIDITY_EVENT_STATES.NO_LIQUIDITY_EVENT
  );
  assert.equal(result.auctionResult, ENGINE29_AUCTION_RESULTS.NO_ACTIVE_AUCTION);
  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.NONE);
});

test("tiny one-tick cross does not qualify as a meaningful sweep", () => {
  const t = 1_800_000_000_000;

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap: {
      locationQuality: "VERY_HIGH",
      levels: [{
        id: "4H|HIGH|major|7800",
        type: "FOUR_HOUR_SWING_HIGH",
        timeframe: "4H",
        side: "HIGH",
        level: 7800,
        lo: 7800,
        hi: 7800,
        eventEligible: true,
        significance: "MACRO_EXTREME",
      }],
    },
    esAnchor: {
      liveMonitor: {
        bars: [
          bar(t, 7799.5, 7800.25, 7798.5, 7799.75, false),
        ],
      },
      structure: {
        fastTactical: {
          bars: [
            bar(t - 5_400_000, 7790, 7802, 7788, 7795, true),
            bar(t - 3_600_000, 7795, 7804, 7791, 7798, true),
            bar(t - 1_800_000, 7798, 7803, 7792, 7799, true),
          ],
        },
        tactical: { bars: [] },
      },
    },
    now: t + 10 * 60 * 1000,
  });

  assert.equal(
    result.liquidityEvent.state,
    ENGINE29_LIQUIDITY_EVENT_STATES.TEST_HIGH
  );
  assert.equal(result.liquidityEvent.swept, false);
  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.NONE);
});

test("low sweep alone is a liquidity event, not a bear trap", () => {
  const t = 1_800_000_000_000;

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap: {
      locationQuality: "VERY_HIGH",
      levels: [{
        id: "4H|LOW|1|7700",
        type: "FOUR_HOUR_SWING_LOW",
        timeframe: "4H",
        side: "LOW",
        level: 7700,
        lo: 7700,
        hi: 7700,
      }],
    },
    esAnchor: {
      liveMonitor: {
        bars: [
          bar(t, 7704, 7705, 7696, 7698, false),
        ],
      },
      structure: {
        fastTactical: {
          bars: [
            bar(t - 3_600_000, 7708, 7710, 7702, 7705, true),
          ],
        },
        tactical: { bars: [] },
      },
    },
    now: t + 10 * 60 * 1000,
  });

  assert.equal(
    result.liquidityEvent.state,
    ENGINE29_LIQUIDITY_EVENT_STATES.SWEEP_LOW
  );
  assert.equal(
    result.auctionResult,
    ENGINE29_AUCTION_RESULTS.SWEPT_LOW
  );
  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.NONE);
  assert.equal(result.reclaimObserved, false);
  assert.equal(result.failedAcceptance, false);
});

test("low sweep + completed 30m reclaim creates bear trap-side failed acceptance", () => {
  const t = 1_800_000_000_000;

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap: {
      locationQuality: "VERY_HIGH",
      levels: [{
        id: "4H|LOW|1|7700",
        type: "FOUR_HOUR_SWING_LOW",
        timeframe: "4H",
        side: "LOW",
        level: 7700,
        lo: 7700,
        hi: 7700,
      }],
    },
    esAnchor: {
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
    },
    now: t + 3_600_000,
  });

  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.BEAR);
  assert.equal(result.failedAcceptance, true);
  assert.equal(result.reclaimObserved, true);
  assert.equal(
    result.auctionResult,
    ENGINE29_AUCTION_RESULTS.FAILED_ACCEPTANCE_LOW
  );
  assert.equal(
    result.liquidityEvent.state,
    ENGINE29_LIQUIDITY_EVENT_STATES.RECLAIMED_LOW
  );
});

test("high sweep + completed 30m failure creates bull trap-side failed acceptance", () => {
  const t = 1_800_000_000_000;

  const result = detectEngine29TrapAuctionEvent({
    macroLiquidityMap: {
      locationQuality: "HIGH",
      levels: [{
        id: "4H|HIGH|1|7800",
        type: "FOUR_HOUR_SWING_HIGH",
        timeframe: "4H",
        side: "HIGH",
        level: 7800,
        lo: 7800,
        hi: 7800,
      }],
    },
    esAnchor: {
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
        tactical: { bars: [] },
      },
    },
    now: t + 3_600_000,
  });

  assert.equal(result.trapSide, ENGINE29_TRAP_SIDES.BULL);
  assert.equal(result.failedAcceptance, true);
  assert.equal(
    result.auctionResult,
    ENGINE29_AUCTION_RESULTS.FAILED_ACCEPTANCE_HIGH
  );
});

test("10m reclaim without completed 30m failure is TRAP_WATCH only", () => {
  const result = resolveEngine29TrapState({
    auctionEvent: {
      trapSide: ENGINE29_TRAP_SIDES.BEAR,
      reclaimObserved: true,
      failedAcceptance: false,
      reasonCodes: [],
    },
    macroLiquidityMap: {
      locationQuality: "VERY_HIGH",
      reasonCodes: [],
    },
    momentumRepair: {
      state: "PARTIAL_CONFIRMATION",
      reasonCodes: [],
    },
    primaryParticipation: null,
    secondaryConfirmation: null,
  });

  assert.equal(result.state, ENGINE29_TRAP_STATES.TRAP_WATCH);
  assert.ok(
    result.confirmationBlockedBy.includes(
      "COMPLETED_30M_FAILED_ACCEPTANCE_NOT_CONFIRMED"
    )
  );
});

test("forming trap cannot confirm when primary participation is unavailable", () => {
  const result = resolveEngine29TrapState({
    auctionEvent: {
      trapSide: ENGINE29_TRAP_SIDES.BEAR,
      reclaimObserved: true,
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
      reclaimObserved: true,
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
      reclaimObserved: true,
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
      schema: "engine25.participation@1",
      engine: "engine25.participation.v1",
      generatedAt: "2026-09-29T17:00:00.000Z",
      authority: {
        owner: "ENGINE25",
      },
      sources: {
        intraday: {
          sourceTimestamp: "2026-09-29T17:00:00.000Z",
        },
        eod: {
          sourceTimestamp: "2026-09-29T16:00:00.000Z",
          sessionDate: "2026-09-29",
        },
      },
      freshness: {
        state: "CURRENT",
        reason: "TEST_FIXTURE_CURRENT",
        usableForTrapConfirmation: true,
        intraday: {
          sourceTimestamp: "2026-09-29T17:00:00.000Z",
          sourceHealthy: true,
          sourceCurrent: true,
          volumeCoverageValid: true,
          state: "CURRENT",
          reason: "TEST_FIXTURE_CURRENT",
          ageMs: 300000,
        },
        eod: {
          sourceTimestamp: "2026-09-29T16:00:00.000Z",
          sessionDate: "2026-09-29",
          expectedSessionDate: "2026-09-29",
          valid: true,
          sourceHealthy: true,
          reason: "TEST_FIXTURE_VALID",
        },
      },
      participation: {
        breadth: {
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
        },
        stockVolume: {
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
