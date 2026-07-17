import {
  prepareEngine8PaperExecution,
} from "./engine8PaperExecutor.js";

const readyAdapter = {
  status: "READY_TO_CREATE_PAPER_ORDER",
  executable: true,

  paperOnly: true,
  realExecutionAllowed: false,
  brokerExecutionAllowed: false,
  schwabExecutionAllowed: false,

  planId: "E9P-TEST-001",
  candidateId: "E26C-TEST-001",
  zoneId: "E26Z-TEST-001",
  strategyId: "intraday_scalp@10m",
  symbol: "ES",
  direction: "LONG",
  setupType: "TEST_SETUP",
  snapshotTime: new Date().toISOString(),

  finalContracts: 1,

  officialEntryPrice: 7574,
  officialStopPrice: 7540.5,

  officialTargets: [
    {
      targetId: "T1",
      price: 7675.75,
      allocationPct: 100,
      role: "FULL_EXIT",
      status: "PLANNED",
    },
  ],
};

const result =
  await prepareEngine8PaperExecution({
    engine8PaperOrder: readyAdapter,
  });

console.log(
  JSON.stringify(
    {
      status: result.status,
      ok: result.ok,
      rejected: result.rejected,
      duplicateBlocked:
        result.duplicateBlocked,

      executionId: result.executionId,
      idempotencyKey:
        result.idempotencyKey,
      orderId: result.orderId,
      tradeId: result.tradeId,

      orderCreated: result.orderCreated,
      fillCreated: result.fillCreated,
      journalCompleted:
        result.journalCompleted,

      noBrokerOrder: result.noBrokerOrder,
      noSchwabCall: result.noSchwabCall,

      duplicateState:
        result.duplicateState,

      reasonCodes: result.reasonCodes,
    },
    null,
    2
  )
);
