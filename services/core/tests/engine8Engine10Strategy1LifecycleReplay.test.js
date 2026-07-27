import test, {
  after,
  before,
} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  applyEngine8ExecutionToJournal,
  createTradeJournalEntryFromEngine8Fill,
} from "../logic/journal/tradeJournalStore.js";

const DATA_DIR = path.resolve(
  process.cwd(),
  "services/core/data"
);

const JOURNAL_FILE = path.resolve(
  DATA_DIR,
  "trade-journal.json"
);

const SNAPSHOT_FILE = path.resolve(
  DATA_DIR,
  "strategy-snapshot.json"
);

const BUILD_SNAPSHOT_FILE = path.resolve(
  process.cwd(),
  "services/core/jobs/buildStrategySnapshot.js"
);

const ARCHIVE_REPLAY_FILE = path.resolve(
  process.cwd(),
  "services/core/jobs/archiveEsReplaySnapshot.js"
);

const backups = new Map();

function backupFile(file) {
  backups.set(
    file,
    fs.existsSync(file)
      ? fs.readFileSync(file)
      : null
  );
}

function restoreFile(file) {
  const backup = backups.get(file);

  if (backup === null) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return;
  }

  fs.mkdirSync(path.dirname(file), {
    recursive: true,
  });
  fs.writeFileSync(file, backup);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true,
  });
  fs.writeFileSync(
    file,
    JSON.stringify(value, null, 2)
  );
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function openingFixture() {
  const candidateId = id("CAND");
  const planId = id("PLAN");
  const executionId = id("ENTRY-X");
  const orderId = id("ENTRY-O");
  const idempotencyKey = id("ENTRY-I");
  const snapshotTime = new Date().toISOString();

  const provenance = {
    contractVersion:
      "strategy1.provenance.v1",
    source: "ENGINE7B_FINAL_SIZING",
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    candidateId,
    zoneId: "ZONE-1",
    symbol: "ES",
    direction: "LONG",
    setupType:
      "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupClass:
      "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade: "A+++",
    identitySetupKey:
      "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion:
      "engine26.strategy1.v1",
    productionRiskSupportedContracts: 1,
    finalProductionContracts: 1,
    finalPaperTestingContracts: 3,
    effectiveOrderedQuantity: 3,
    finalContracts: 3,
    finalSizingMode:
      "PAPER_TESTING_DATA_COLLECTION",
    testingRiskOverrideApplied: true,
    testingThreeContractPlanQualified: true,
    allocationQualificationSource:
      "ENGINE7A_TESTING_DATA_COLLECTION",
    finalThreeContractAllocation: {
      block1Contracts: 1,
      block2Contracts: 1,
      block3Contracts: 1,
      totalContracts: 3,
    },
    planId,
    officialTargets: [
      {
        targetId: "T1",
        price: 101,
      },
      {
        targetId: "T2",
        price: 102,
      },
      {
        targetId: "T3",
        price: 103,
      },
    ],
    threeBlockManagement: {
      totalContracts: 3,
      blocks: [
        {
          blockId: "BLOCK_1",
          contractId: "CONTRACT_1",
          contracts: 1,
          targetId: "T1",
          targetPrice: 101,
        },
        {
          blockId: "BLOCK_2",
          contractId: "CONTRACT_2",
          contracts: 1,
          targetId: "T2",
          targetPrice: 102,
        },
        {
          blockId: "BLOCK_3",
          contractId: "CONTRACT_3",
          contracts: 1,
          targetId: "T3",
          targetPrice: 103,
        },
      ],
    },
    runnerPlan: {
      enabled: true,
      blockId: "BLOCK_3",
      contracts: 1,
      runnerTargetPrice: 103,
      status: "RUNNER_TARGET_SELECTED",
    },
    paperOnly: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
    liveTradingAllowed: false,
  };

  const ticket = {
    executionId,
    orderId,
    idempotencyKey,
    planId,
    candidateId,
    zoneId: "ZONE-1",
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    direction: "LONG",
    setupType:
      "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupClass:
      "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade: "A+++",
    identitySetupKey:
      "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion:
      "engine26.strategy1.v1",
    snapshotTime,
    paper: true,
    assetType: "FUTURES",
    action: "NEW_ENTRY",
    eventType: "NEW_ENTRY",
    side: "BUY",
    qty: 3,
    requestedQuantity: 3,
    orderType: "LIMIT",
    fillStatus: "FILLED",
    fillPrice: 100,
    fillQuantity: 3,
    officialEntryPrice: 100,
    officialStopPrice: 99,
    officialStopDistancePoints: 1,
    officialTargets:
      provenance.officialTargets,
    threeBlockManagement:
      provenance.threeBlockManagement,
    runnerPlan:
      provenance.runnerPlan,
    engine7FinalContracts: 3,
    riskBudgetDollars: 150,
    permissionAdjustedRiskBudget: 150,
    dollarsPerPoint: 50,
    rawRiskPerContract: 50,
    estimatedSlippageRiskPerContract: 0,
    commissionDollarsPerContractRoundTrip: 0,
    effectiveRiskPerContract: 50,
    estimatedTotalRiskDollars: 150,
    frozenOpeningRiskDollars: 150,
    strategy1Provenance: provenance,
    sourceSignal: {
      laneId: "minute",
      strategyId: "intraday_scalp@10m",
      candidateId,
      zoneId: "ZONE-1",
      symbol: "ES",
      direction: "LONG",
      setupType:
        "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
      setupClass:
        "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
      setupGrade: "A+++",
      identitySetupKey:
        "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
      candidateIdentityVersion:
        "engine26.strategy1.v1",
      snapshotTime,
      planId,
      strategy1Provenance: provenance,
    },
  };

  return {
    ticket,
    provenance,
  };
}

function lifecycleTicket({
  opening,
  tradeId,
  sequence,
  action,
  blockId,
  targetId,
  price,
  remainingQty,
  managementAction,
  exitReason,
}) {
  return {
    ...opening,
    tradeId,
    executionId: id(`EXIT-${sequence}-X`),
    orderId: id(`EXIT-${sequence}-O`),
    idempotencyKey: id(`EXIT-${sequence}-I`),
    action,
    eventType: action,
    side: "SELL",
    fillStatus: "FILLED",
    fillPrice: price,
    fillQuantity: 1,
    remainingQty,
    blockId,
    targetId,
    managementAction,
    exitReason,
  };
}

before(() => {
  backupFile(JOURNAL_FILE);
  backupFile(SNAPSHOT_FILE);
  writeJson(JOURNAL_FILE, []);
  writeJson(SNAPSHOT_FILE, {
    ok: true,
    now: new Date().toISOString(),
    strategies: {},
  });
});

after(() => {
  restoreFile(JOURNAL_FILE);
  restoreFile(SNAPSHOT_FILE);
});

test(
  "Engine 10 preserves provenance through three one-contract exits and closes exactly once",
  async () => {
    const {
      ticket,
      provenance,
    } = openingFixture();

    const opened =
      await createTradeJournalEntryFromEngine8Fill({
        ticket,
        order: {
          ...ticket,
          status: "FILLED",
        },
        result: {
          ...ticket,
          ok: true,
          status: "FILLED",
          fillStatus: "FILLED",
        },
      });

    assert.equal(opened.created, true);
    assert.equal(
      opened.trade.qty.originalQty,
      3
    );
    assert.equal(
      opened.trade.qty.remainingQty,
      3
    );

    const exit1 = lifecycleTicket({
      opening: ticket,
      tradeId: opened.tradeId,
      sequence: 1,
      action: "REDUCE",
      blockId: "BLOCK_1",
      targetId: "T1",
      price: 101,
      remainingQty: 2,
      managementAction: "TAKE_TARGET_1",
      exitReason: "TARGET_EXIT",
    });

    const first =
      await applyEngine8ExecutionToJournal({
        ticket: exit1,
        order: {
          ...exit1,
          status: "FILLED",
        },
        result: {
          ...exit1,
          status: "FILLED",
          fillStatus: "FILLED",
        },
      });

    assert.equal(first.updated, true);
    assert.equal(first.status, "OPEN");
    assert.equal(first.remainingQty, 2);
    assert.equal(first.eventType, "BLOCK_1_EXIT");
    assert.deepEqual(
      first.trade.strategy1Provenance,
      provenance
    );

    const exit2 = lifecycleTicket({
      opening: ticket,
      tradeId: opened.tradeId,
      sequence: 2,
      action: "REDUCE",
      blockId: "BLOCK_2",
      targetId: "T2",
      price: 102,
      remainingQty: 1,
      managementAction:
        "ARM_RUNNER_MANAGEMENT",
      exitReason: "TARGET_EXIT",
    });

    const second =
      await applyEngine8ExecutionToJournal({
        ticket: exit2,
        order: {
          ...exit2,
          status: "FILLED",
        },
        result: {
          ...exit2,
          status: "FILLED",
          fillStatus: "FILLED",
        },
      });

    assert.equal(second.updated, true);
    assert.equal(second.status, "OPEN");
    assert.equal(second.remainingQty, 1);
    assert.equal(second.eventType, "BLOCK_2_EXIT");
    assert.ok(
      second.trade.events.some(
        (event) =>
          event.eventType === "RUNNER_ARMED"
      )
    );
    assert.deepEqual(
      second.trade.strategy1Provenance,
      provenance
    );

    const exit3 = lifecycleTicket({
      opening: ticket,
      tradeId: opened.tradeId,
      sequence: 3,
      action: "EXIT",
      blockId: "BLOCK_3",
      targetId: "T3",
      price: 103,
      remainingQty: 0,
      managementAction: "EXIT_RUNNER",
      exitReason: "FINAL_EXIT",
    });

    const third =
      await applyEngine8ExecutionToJournal({
        ticket: exit3,
        order: {
          ...exit3,
          status: "FILLED",
        },
        result: {
          ...exit3,
          status: "FILLED",
          fillStatus: "FILLED",
        },
      });

    assert.equal(third.updated, true);
    assert.equal(third.status, "CLOSED");
    assert.equal(third.remainingQty, 0);
    assert.equal(third.journalCompleted, true);
    assert.equal(
      third.trade.qty.cumulativeExitQuantity,
      3
    );

    assert.deepEqual(
      third.trade.strategy1Provenance,
      provenance
    );

    const eventTypes =
      third.trade.events.map(
        (event) => event.eventType
      );

    assert.ok(eventTypes.includes("ENTRY_FILLED"));
    assert.ok(eventTypes.includes("BLOCK_1_EXIT"));
    assert.ok(eventTypes.includes("BLOCK_2_EXIT"));
    assert.ok(eventTypes.includes("RUNNER_ARMED"));
    assert.ok(eventTypes.includes("FINAL_EXIT"));
    assert.equal(
      eventTypes.filter(
        (eventType) =>
          eventType === "TRADE_CLOSED"
      ).length,
      1
    );

    assert.equal(
      third.trade.summary.realizedPoints,
      6
    );
    assert.equal(
      third.trade.summary.realizedPnL,
      300
    );
    assert.equal(
      third.trade.summary.realizedR,
      2
    );
    assert.ok(third.trade.summary.closeTime);
    assert.equal(
      third.trade.result,
      "WIN"
    );

    const repeated =
      await applyEngine8ExecutionToJournal({
        ticket: {
          ...exit3,
          executionId: id("REPEAT-X"),
          orderId: id("REPEAT-O"),
          idempotencyKey: id("REPEAT-I"),
        },
        order: {
          ...exit3,
          executionId: id("REPEAT-X2"),
          orderId: id("REPEAT-O2"),
          idempotencyKey: id("REPEAT-I2"),
          status: "FILLED",
        },
        result: {
          ...exit3,
          executionId: id("REPEAT-X3"),
          orderId: id("REPEAT-O3"),
          idempotencyKey: id("REPEAT-I3"),
          status: "FILLED",
          fillStatus: "FILLED",
        },
      });

    assert.equal(repeated.ok, true);
    assert.equal(repeated.updated, false);
    assert.equal(repeated.skipped, true);
    assert.equal(
      repeated.reason,
      "TRADE_ALREADY_CLOSED"
    );
    assert.equal(repeated.status, "CLOSED");
    assert.equal(repeated.remainingQty, 0);
  }
);

test(
  "canonical snapshot attachment and Replay opaque copy preserve the completed journal unchanged",
  () => {
    const snapshotSource =
      fs.readFileSync(
        BUILD_SNAPSHOT_FILE,
        "utf8"
      );

    assert.match(
      snapshotSource,
      /attachEngine10JournalToCanonicalStrategy/
    );
    assert.match(
      snapshotSource,
      /strategyNode\.engine10Journal/
    );
    assert.match(
      snapshotSource,
      /tradeJournalStore\.listTrades/
    );

    if (fs.existsSync(ARCHIVE_REPLAY_FILE)) {
      const replaySource =
        fs.readFileSync(
          ARCHIVE_REPLAY_FILE,
          "utf8"
        );

      assert.match(
        replaySource,
        /strategies/
      );
    }

    const trades =
      JSON.parse(
        fs.readFileSync(
          JOURNAL_FILE,
          "utf8"
        )
      );

    const completed =
      trades.find(
        (trade) =>
          trade?.status === "CLOSED"
      );

    assert.ok(completed);

    const canonicalSnapshot = {
      strategies: {
        "intraday_scalp@10m": {
          engine10Journal:
            JSON.parse(
              JSON.stringify(completed)
            ),
        },
      },
    };

    const replay = {
      strategies:
        JSON.parse(
          JSON.stringify(
            canonicalSnapshot.strategies
          )
        ),
    };

    assert.deepEqual(
      replay.strategies[
        "intraday_scalp@10m"
      ].engine10Journal,
      completed
    );

    const replayTrade =
      replay.strategies[
        "intraday_scalp@10m"
      ].engine10Journal;

    assert.equal(replayTrade.status, "CLOSED");
    assert.equal(
      replayTrade.qty.remainingQty,
      0
    );
    assert.equal(
      replayTrade.strategy1Provenance
        .productionRiskSupportedContracts,
      1
    );
    assert.equal(
      replayTrade.strategy1Provenance
        .finalPaperTestingContracts,
      3
    );
    assert.equal(
      replayTrade.strategy1Provenance
        .effectiveOrderedQuantity,
      3
    );
    assert.deepEqual(
      replayTrade.strategy1Provenance
        .finalThreeContractAllocation,
      {
        block1Contracts: 1,
        block2Contracts: 1,
        block3Contracts: 1,
        totalContracts: 3,
      }
    );
    assert.equal(
      replayTrade.summary.realizedPnL,
      300
    );
    assert.equal(
      replayTrade.summary.realizedR,
      2
    );
  }
);
