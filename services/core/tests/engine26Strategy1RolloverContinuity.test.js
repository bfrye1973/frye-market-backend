import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

function shortEvidenceBars() {
  return [
    {
      time: "2026-09-01T14:30:00.000Z",
      open: 7698,
      high: 7708,
      low: 7690,
      close: 7702,
      completed: true,
    },
    {
      time: "2026-09-01T14:40:00.000Z",
      open: 7702,
      high: 7704,
      low: 7688,
      close: 7694,
      completed: true,
    },
    {
      time: "2026-09-01T14:50:00.000Z",
      open: 7694,
      high: 7698,
      low: 7682,
      close: 7685,
      completed: true,
    },
  ];
}

function openPaperTradeFor(candidate) {
  return {
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    status: "OPEN",
    accountMode: "PAPER",
    direction: candidate.directionBias,
    candidateId: candidate.candidateId,
    zoneId: candidate.zoneId,
  };
}

test(
  "active SHORT trip survives ES price-basis rollover and completes at the adjusted target midpoint",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "engine26-rollover-continuity-")
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const priorAdjustment =
      process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT;

    try {
      // Establish the trip on the protected source-contract price basis.
      process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT = "0";

      const initial = buildEngine26A({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: 7695,
        snapshotTime: "2026-09-01T15:00:00.000Z",
        ema10Posture: "BEARISH",
        bars10m: shortEvidenceBars(),
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(initial.directionBias, "SHORT");
      assert.equal(initial.entryZone.low, 7687.25);
      assert.equal(initial.entryZone.high, 7705.5);
      assert.equal(initial.targetZone.low, 7635.5);
      assert.equal(initial.targetZone.high, 7658.75);

      const initialCandidateId = initial.candidateId;
      const initialZoneId = initial.zoneId;
      const openPaperTrades = [
        openPaperTradeFor(initial),
      ];

      /*
       * Simulate memory written by the pre-fix production code.
       * It had price-derived zoneId values but no logicalZoneKey field.
       */
      const legacyMemory = JSON.parse(
        fs.readFileSync(memoryFilePath, "utf8")
      );

      for (const record of Object.values(legacyMemory.records || {})) {
        delete record.logicalZoneKey;
        if (record.targetZone) {
          delete record.targetZone.logicalZoneKey;
        }
      }

      fs.writeFileSync(
        memoryFilePath,
        JSON.stringify(legacyMemory, null, 2),
        "utf8"
      );

      // Simulate the production contract-basis change ESU26 -> ESZ26.
      process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT = "67.5";

      // previousLocationCandidate=null intentionally simulates a restart.
      const recovered = buildEngine26A({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: 7740,
        snapshotTime: "2026-09-23T15:00:00.000Z",
        previousLocationCandidate: null,
        openPaperTrades,
        ema10Posture: "BEARISH",
        bars10m: [],
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(recovered.candidateId, initialCandidateId);
      assert.equal(recovered.zoneId, initialZoneId);
      assert.equal(recovered.directionBias, "SHORT");
      assert.equal(recovered.entryZone.low, 7754.75);
      assert.equal(recovered.entryZone.high, 7773);
      assert.equal(recovered.targetZone.low, 7703);
      assert.equal(recovered.targetZone.high, 7726.25);
      assert.equal(recovered.targetZone.midline, 7714.75);
      assert.equal(recovered.completionBoundary, 7714.75);
      assert.equal(
        recovered.childPreservation.recoveredFromMemory,
        true
      );
      assert.ok(
        recovered.reasonCodes.includes(
          "ENGINE26_STRATEGY1_TRIP_IDENTITY_PRESERVED_ACROSS_PRICE_BASIS_CHANGE"
        )
      );

      // First target-zone entry closes Block 1 only.
      const partial = buildEngine26A({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: 7726.25,
        snapshotTime: "2026-09-23T15:10:00.000Z",
        previousLocationCandidate: recovered,
        openPaperTrades,
        ema10Posture: "BEARISH",
        bars10m: [],
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(partial.candidateId, initialCandidateId);
      assert.equal(partial.zoneId, initialZoneId);
      assert.equal(partial.directionBias, "SHORT");
      assert.equal(
        partial.priorRotationCompletionState,
        "PARTIAL_PROFIT_TAKING"
      );
      assert.equal(partial.targetZoneEntryTouched, true);
      assert.equal(partial.targetMidlineReached, false);
      assert.equal(partial.priorRotationFullyComplete, false);
      assert.equal(partial.completionBoundary, 7714.75);

      // Midpoint finishes the trip and resets Engine 26A to NEUTRAL.
      const completed = buildEngine26A({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: 7714.75,
        snapshotTime: "2026-09-23T15:20:00.000Z",
        previousLocationCandidate: partial,
        openPaperTrades,
        ema10Posture: "BEARISH",
        bars10m: [],
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.notEqual(completed.candidateId, initialCandidateId);
      assert.notEqual(completed.zoneId, initialZoneId);
      assert.equal(completed.directionBias, "NEUTRAL");
      assert.equal(
        completed.priorRotationCompletionState,
        "FULL_TARGET_COMPLETION"
      );
      assert.equal(completed.priorRotationFullyComplete, true);
      assert.equal(completed.promotedFromTargetCompletion, true);
      assert.equal(completed.completionBoundary, 7714.75);
      assert.equal(completed.status, "OBSERVING_PROMOTED_ZONE");
    } finally {
      if (priorAdjustment === undefined) {
        delete process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT;
      } else {
        process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT =
          priorAdjustment;
      }

      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    }
  }
);


test(
  "missed prior SHORT midpoint completion overrides a newer wrong SHORT child and restores NEUTRAL",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "engine26-midpoint-reconcile-")
    );

    const oldMemoryPath = path.join(
      tempDir,
      "old-trip-memory.json"
    );

    const wrongMemoryPath = path.join(
      tempDir,
      "wrong-trip-memory.json"
    );

    const priorAdjustment =
      process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT;

    try {
      process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT = "0";

      const oldShort = buildEngine26A({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: 7695,
        snapshotTime: "2026-09-01T15:00:00.000Z",
        ema10Posture: "BEARISH",
        bars10m: shortEvidenceBars(),
        memoryFilePath: oldMemoryPath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(oldShort.directionBias, "SHORT");
      assert.equal(oldShort.entryZone.low, 7687.25);
      assert.equal(oldShort.targetZone.low, 7635.5);
      assert.equal(oldShort.targetZone.high, 7658.75);
      assert.equal(oldShort.targetZone.midline, 7647.25);

      const wrongShort = buildEngine26A({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: 7630,
        snapshotTime: "2026-09-01T15:30:00.000Z",
        ema10Posture: "BEARISH",
        bars10m: [
          {
            time: "2026-09-01T15:00:00.000Z",
            open: 7648,
            high: 7660,
            low: 7645,
            close: 7655,
            completed: true,
          },
          {
            time: "2026-09-01T15:10:00.000Z",
            open: 7655,
            high: 7657,
            low: 7632,
            close: 7640,
            completed: true,
          },
          {
            time: "2026-09-01T15:20:00.000Z",
            open: 7640,
            high: 7642,
            low: 7628,
            close: 7630,
            completed: true,
          },
        ],
        memoryFilePath: wrongMemoryPath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(wrongShort.directionBias, "SHORT");
      assert.equal(wrongShort.entryZone.low, 7635.5);
      assert.equal(wrongShort.targetZone.midline, 7601);

      /*
       * Simulate the live defect: the older SHORT that should have completed
       * at 7647.25 is still ACTIVE in memory, while a newer SHORT child has
       * already been created from that completed target zone.
       */
      const oldStore = JSON.parse(
        fs.readFileSync(oldMemoryPath, "utf8")
      );
      const wrongStore = JSON.parse(
        fs.readFileSync(wrongMemoryPath, "utf8")
      );

      oldStore.records = {
        ...(oldStore.records || {}),
        ...(wrongStore.records || {}),
      };

      fs.writeFileSync(
        oldMemoryPath,
        JSON.stringify(oldStore, null, 2),
        "utf8"
      );

      const reconciled = buildEngine26A({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: 7665,
        snapshotTime: "2026-09-01T15:40:00.000Z",
        previousLocationCandidate: wrongShort,
        ema10Posture: "BULLISH",
        bars10m: [
          {
            time: "2026-09-01T15:20:00.000Z",
            open: 7652,
            high: 7656,
            low: 7647.25,
            close: 7651,
            completed: true,
          },
          {
            time: "2026-09-01T15:30:00.000Z",
            open: 7651,
            high: 7666,
            low: 7650,
            close: 7665,
            completed: true,
          },
        ],
        memoryFilePath: oldMemoryPath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(reconciled.directionBias, "NEUTRAL");
      assert.equal(reconciled.direction, "NEUTRAL");
      assert.equal(reconciled.directionState, "NEUTRAL");
      assert.equal(reconciled.entryZone.low, 7635.5);
      assert.equal(reconciled.entryZone.high, 7658.75);
      assert.equal(reconciled.completionBoundary, 7647.25);
      assert.equal(reconciled.priorRotationFullyComplete, true);
      assert.equal(
        reconciled.priorRotationCompletionState,
        "FULL_TARGET_COMPLETION"
      );
      assert.equal(reconciled.promotedFromTargetCompletion, true);
      assert.equal(reconciled.priorCandidateId, oldShort.candidateId);
      assert.equal(reconciled.priorZoneId, oldShort.zoneId);
      assert.notEqual(reconciled.candidateId, wrongShort.candidateId);
      assert.ok(
        reconciled.reasonCodes.includes(
          "ENGINE26_STRATEGY1_UNRECORDED_MIDPOINT_COMPLETION_RECONCILED"
        )
      );

      const nextSnapshot = buildEngine26A({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: 7670,
        snapshotTime: "2026-09-01T15:50:00.000Z",
        previousLocationCandidate: reconciled,
        ema10Posture: "BULLISH",
        bars10m: [
          {
            time: "2026-09-01T15:40:00.000Z",
            open: 7665,
            high: 7672,
            low: 7664,
            close: 7670,
            completed: true,
          },
        ],
        memoryFilePath: oldMemoryPath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(nextSnapshot.candidateId, reconciled.candidateId);
      assert.equal(nextSnapshot.zoneId, reconciled.zoneId);
      assert.equal(nextSnapshot.directionBias, "NEUTRAL");
      assert.equal(nextSnapshot.contactState, "NEGOTIATED_LINE_CONTACT");
      assert.equal(nextSnapshot.priorRotationFullyComplete, true);
    } finally {
      if (priorAdjustment === undefined) {
        delete process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT;
      } else {
        process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT =
          priorAdjustment;
      }

      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    }
  }
);
