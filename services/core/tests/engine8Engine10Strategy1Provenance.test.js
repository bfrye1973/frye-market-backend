import test, {
  after,
  before,
} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildEngine8CanonicalPaperAdapter,
} from "../logic/trading/engine8CanonicalPaperAdapter.js";
import {
  prepareEngine8PaperExecution,
} from "../logic/trading/engine8PaperExecutor.js";
import {
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

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function buildFixtures() {
  const candidateId = uniqueId("CAND");
  const planId = uniqueId("PLAN");
  const snapshotTime = new Date().toISOString();

  const identity = {
    laneId: "minute",
    planId,
    candidateId,
    zoneId: "ZONE-STRATEGY1",
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
  };

  const officialTargets = [
    {
      targetId: "T1",
      sequence: 1,
      price: 7700,
      role: "TARGET_1",
      status: "READY",
    },
    {
      targetId: "T2",
      sequence: 2,
      price: 7710,
      role: "TARGET_2",
      status: "READY",
    },
    {
      targetId: "T3",
      sequence: 3,
      price: 7739.5,
      role: "RUNNER",
      status: "READY",
    },
  ];

  const blocks = [
    {
      blockId: "BLOCK_1",
      contractId: "CONTRACT_1",
      contracts: 1,
      purpose: "TARGET_1_ZONE_TOUCH",
      targetId: "T1",
      targetPrice: 7700,
      status: "READY",
    },
    {
      blockId: "BLOCK_2",
      contractId: "CONTRACT_2",
      contracts: 1,
      purpose: "TARGET_2_ZONE_MIDLINE",
      targetId: "T2",
      targetPrice: 7710,
      status: "READY",
    },
    {
      blockId: "BLOCK_3",
      contractId: "CONTRACT_3",
      contracts: 1,
      purpose: "ENGINE9_RUNNER",
      targetId: "T3",
      targetPrice: 7739.5,
      status: "READY",
    },
  ];

  const engine6 = {
    ...identity,
    decision: "FAST_INTRADAY_PAPER_ALLOW",
    allowed: true,
    planningAllowed: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
  };

  const engine9 = {
    ...identity,
    planStatus: "OFFICIAL_PLAN_READY",
    managementReady: true,
    official: true,
    officialEntryPrice: 7680,
    officialStopPrice: 7677,
    officialStopDistancePoints: 3,
    officialTargets,
    threeBlockManagement: {
      totalContracts: 3,
      blocks,
    },
    runnerPlan: {
      enabled: true,
      blockId: "BLOCK_3",
      contracts: 1,
      runnerTargetPrice: 7739.5,
      status: "RUNNER_TARGET_SELECTED",
    },
  };

  const engine7 = {
    ...identity,
    status: "FINAL_SIZE_READY",
    allowed: true,
    executableSizing: true,
    paperOrderSizingReady: true,
    officialEntryPrice: 7680,
    officialStopPrice: 7677,
    officialStopDistancePoints: 3,
    finalContracts: 3,
    productionRiskSupportedContracts: 1,
    finalProductionContracts: 1,
    finalPaperTestingContracts: 3,
    finalSizingMode:
      "PAPER_TESTING_DATA_COLLECTION",
    engine7ATestingRiskOverrideApplied: true,
    finalTestingThreeContractPlanQualified: true,
    engine9AllocationQualificationSource:
      "ENGINE7A_TESTING_DATA_COLLECTION",
    finalThreeContractAllocation: {
      block1Contracts: 1,
      block2Contracts: 1,
      block3Contracts: 1,
      totalContracts: 3,
    },
    riskBudgetDollars: 100,
    permissionAdjustedRiskBudget: 100,
    dollarsPerPoint: 50,
    rawRiskPerContract: 150,
    estimatedSlippageRiskPerContract: 0,
    commissionDollarsPerContractRoundTrip: 0,
    effectiveRiskPerContract: 150,
    estimatedTotalRiskDollars: 150,
  };

  return {
    identity,
    officialTargets,
    blocks,
    engine6,
    engine9,
    engine7,
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
  "Engine 8 preserves frozen Strategy 1 identity and sizing provenance",
  async () => {
    const {
      identity,
      blocks,
      engine6,
      engine9,
      engine7,
    } = buildFixtures();

    const adapter =
      buildEngine8CanonicalPaperAdapter({
        engine6PaperPermission: engine6,
        engine9OfficialManagementPlan: engine9,
        engine7PositionSizing: engine7,
        duplicateState: {
          candidateAlreadyOrdered: false,
          idempotencyKeyAlreadyUsed: false,
          openTradeForStrategy: false,
          activeTradeIdExists: false,
          orderExistsForPlanId: false,
          acceptanceTradeCompleted: false,
          newPaperOrdersAllowed: true,
        },
        paperExecutionEnabled: true,
        liveTradingEnabled: false,
        allowLiveFutures: false,
      });

    assert.equal(
      adapter.status,
      "READY_TO_CREATE_PAPER_ORDER"
    );
    assert.equal(adapter.executable, true);
    assert.equal(adapter.finalContracts, 3);

    assert.deepEqual(
      adapter.strategy1Provenance,
      {
        contractVersion:
          "strategy1.provenance.v1",
        source: "ENGINE7B_FINAL_SIZING",
        laneId: identity.laneId,
        strategyId: identity.strategyId,
        candidateId: identity.candidateId,
        zoneId: identity.zoneId,
        symbol: identity.symbol,
        direction: identity.direction,
        setupType: identity.setupType,
        setupClass: identity.setupClass,
        setupGrade: identity.setupGrade,
        identitySetupKey:
          identity.identitySetupKey,
        candidateIdentityVersion:
          identity.candidateIdentityVersion,
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
        planId: identity.planId,
        officialTargets:
          engine9.officialTargets,
        threeBlockManagement:
          engine9.threeBlockManagement,
        runnerPlan: engine9.runnerPlan,
        paperOnly: true,
        realExecutionAllowed: false,
        brokerExecutionAllowed: false,
        schwabExecutionAllowed: false,
        liveTradingAllowed: false,
      }
    );

    assert.deepEqual(
      adapter.strategy1Provenance
        .threeBlockManagement.blocks,
      blocks
    );

    const prepared =
      await prepareEngine8PaperExecution({
        engine8PaperOrder: adapter,
      });

    assert.equal(
      prepared.status,
      "READY_FOR_PAPER_EXECUTION_CALL"
    );
    assert.equal(prepared.ok, true);
    assert.deepEqual(
      prepared.strategy1Provenance,
      adapter.strategy1Provenance
    );

    assert.equal(
      prepared.strategy1Provenance
        .realExecutionAllowed,
      false
    );
    assert.equal(
      prepared.strategy1Provenance
        .brokerExecutionAllowed,
      false
    );
    assert.equal(
      prepared.strategy1Provenance
        .schwabExecutionAllowed,
      false
    );
    assert.equal(
      prepared.strategy1Provenance
        .liveTradingAllowed,
      false
    );
  }
);

test(
  "Engine 10 durably stores provenance without reinterpreting it",
  async () => {
    const {
      identity,
      engine9,
      engine7,
    } = buildFixtures();

    const strategy1Provenance = {
      contractVersion:
        "strategy1.provenance.v1",
      source: "ENGINE7B_FINAL_SIZING",
      laneId: identity.laneId,
      strategyId: identity.strategyId,
      candidateId: identity.candidateId,
      zoneId: identity.zoneId,
      symbol: identity.symbol,
      direction: identity.direction,
      setupType: identity.setupType,
      setupClass: identity.setupClass,
      setupGrade: identity.setupGrade,
      identitySetupKey:
        identity.identitySetupKey,
      candidateIdentityVersion:
        identity.candidateIdentityVersion,
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
      planId: identity.planId,
      officialTargets:
        engine9.officialTargets,
      threeBlockManagement:
        engine9.threeBlockManagement,
      runnerPlan: engine9.runnerPlan,
      paperOnly: true,
      realExecutionAllowed: false,
      brokerExecutionAllowed: false,
      schwabExecutionAllowed: false,
      liveTradingAllowed: false,
    };

    const ticket = {
      ...identity,
      executionId: uniqueId("E8X"),
      orderId: uniqueId("E8O"),
      idempotencyKey: uniqueId("IDEMP"),
      tradeId: null,
      paper: true,
      assetType: "FUTURES",
      action: "NEW_ENTRY",
      eventType: "NEW_ENTRY",
      side: "BUY",
      qty: 3,
      requestedQuantity: 3,
      orderType: "LIMIT",
      timeframe: "10m",
      fillStatus: "FILLED",
      fillPrice: 7680,
      fillQuantity: 3,
      officialEntryPrice: 7680,
      officialStopPrice: 7677,
      officialStopDistancePoints: 3,
      officialTargets:
        engine9.officialTargets,
      threeBlockManagement:
        engine9.threeBlockManagement,
      runnerPlan: engine9.runnerPlan,
      engine9OfficialManagementPlan:
        engine9,
      engine7FinalContracts: 3,
      engine7PositionSizing: engine7,
      estimatedTotalRiskDollars: 150,
      frozenOpeningRiskDollars: 150,
      dollarsPerPoint: 50,
      strategy1Provenance,
      sourceSignal: {
        ...identity,
        strategy1Provenance,
      },
    };

    const created =
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

    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    assert.equal(created.status, "OPEN");
    assert.equal(
      created.trade.qty.originalQty,
      3
    );
    assert.equal(
      created.trade.qty.remainingQty,
      3
    );

    assert.deepEqual(
      created.trade.strategy1Provenance,
      strategy1Provenance
    );

    assert.equal(
      created.trade.identity.laneId,
      "minute"
    );
    assert.equal(
      created.trade.identity.setupClass,
      "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION"
    );
    assert.equal(
      created.trade.identity.setupGrade,
      "A+++"
    );
    assert.equal(
      created.trade.identity.identitySetupKey,
      "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION"
    );
    assert.equal(
      created.trade.identity
        .candidateIdentityVersion,
      "engine26.strategy1.v1"
    );

    const duplicate =
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

    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.skipped, true);
    assert.equal(
      duplicate.reason,
      "TRADE_ALREADY_RECORDED"
    );
    assert.equal(
      duplicate.tradeId,
      created.tradeId
    );
    assert.deepEqual(
      duplicate.trade.strategy1Provenance,
      strategy1Provenance
    );
  }
);
