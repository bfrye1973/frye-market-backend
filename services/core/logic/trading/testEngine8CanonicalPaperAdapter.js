import buildEngine8CanonicalPaperAdapter from "./engine8CanonicalPaperAdapter.js";

const result = buildEngine8CanonicalPaperAdapter({
  engine6PaperPermission: {
    decision: "PAPER_WATCH_FAST",
    allowed: false,
    direction: "LONG",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    setupType: "TEST",
  },

  engine9OfficialManagementPlan: {
    planStatus: "WAITING_FOR_UPSTREAM_CONFIRMATION",
    managementReady: false,
    official: false,

    planId: "PLAN1",
    candidateId: "C1",
    zoneId: "Z1",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    direction: "LONG",
    setupType: "TEST",
    snapshotTime: "2026-07-16T00:00:00Z",
  },

  engine7PositionSizing: {
    status: "WAITING_FOR_ENGINE9_OFFICIAL_PLAN",
    allowed: false,
    executableSizing: false,
    finalContracts: 0,

    planId: "PLAN1",
    candidateId: "C1",
    zoneId: "Z1",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    direction: "LONG",
    setupType: "TEST",
    snapshotTime: "2026-07-16T00:00:00Z",
  },

  duplicateState: {},
  paperExecutionEnabled: true,
  liveTradingEnabled: false,
  allowLiveFutures: false,
});

console.log(JSON.stringify(result, null, 2));
