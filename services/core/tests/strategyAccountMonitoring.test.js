import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategyAccountMonitoring } from "../logic/accounts/buildStrategyAccountMonitoring.js";

function engine22() {
  return {
    microExecutionContext: { activeWave: "W3", waveDirection: "UP", lifecycle: "DEVELOPING", microTimingState: "TRANSITION_CONFIRMING", sourceCountId: "M1", revision: 3 },
    degreeStates: {
      subminute: { activeWave: "W3", direction: "UP", state: "ACTIVE" },
      minute: { activeWave: "W3", direction: "UP", state: "ACTIVE" },
      minor: { activeWave: "W3", direction: "UP", state: "ACTIVE" },
      intermediate: { activeWave: "W3", direction: "UP", state: "ACTIVE" },
      primary: { activeWave: "W3", direction: "UP", state: "ACTIVE" },
    },
  };
}

function trade({ id, broker, journal, direction = "LONG", qty = 1 }) {
  return {
    tradeId: id,
    accountMode: "REAL",
    status: "OPEN",
    brokerAccountLabel: broker,
    journalAccount: journal,
    normalizedInstrumentRoot: "MES",
    symbol: "MES",
    direction,
    qty: { remainingQty: qty },
    entry: { price: 7900, time: "2026-10-10T15:00:00Z" },
  };
}

test("existing Intraday and Swing broker accounts route to Intraday and Subminute roles", () => {
  const out = buildStrategyAccountMonitoring({
    openTrades: [
      trade({ id: "I1", broker: "SCHWAB_6380", journal: "INTRADAY", qty: 5 }),
      trade({ id: "S1", broker: "SCHWAB_0747", journal: "SWING", qty: 4 }),
    ],
    engine22WaveStrategy: engine22(),
  });

  const intraday = out.accounts.find((a) => a.accountRole === "INTRADAY");
  const subminute = out.accounts.find((a) => a.accountRole === "SUBMINUTE");
  assert.equal(intraday.position.contracts, 5);
  assert.equal(subminute.position.contracts, 4);
  assert.equal(intraday.alignment, "ALIGNED");
  assert.equal(subminute.alignment, "ALIGNED");
});

test("portfolio exposure aggregates MES contracts across accounts", () => {
  const out = buildStrategyAccountMonitoring({
    openTrades: [
      trade({ id: "I1", broker: "SCHWAB_6380", journal: "INTRADAY", qty: 5 }),
      trade({ id: "S1", broker: "SCHWAB_0747", journal: "SWING", qty: 4 }),
    ],
    engine22WaveStrategy: engine22(),
  });
  assert.equal(out.portfolio.totalOpenContracts, 9);
  assert.equal(out.portfolio.grossDollarsPerPoint, 45);
  assert.equal(out.portfolio.netDollarsPerPoint, 45);
});

test("opposite position direction is reported as structural conflict", () => {
  const out = buildStrategyAccountMonitoring({
    openTrades: [
      trade({ id: "I1", broker: "SCHWAB_6380", journal: "INTRADAY", direction: "SHORT", qty: 1 }),
    ],
    engine22WaveStrategy: engine22(),
  });
  const intraday = out.accounts.find((a) => a.accountRole === "INTRADAY");
  assert.equal(intraday.alignment, "CONFLICT");
  assert.equal(intraday.conflict, true);
});

test("unopened future account slots remain visible and flat", () => {
  const out = buildStrategyAccountMonitoring({
    openTrades: [],
    engine22WaveStrategy: engine22(),
  });
  for (const role of ["MINUTE", "MINOR", "INTERMEDIATE", "PRIMARY"]) {
    const account = out.accounts.find((a) => a.accountRole === role);
    assert.equal(account.brokerBinding.status, "AWAITING_NEW_SCHWAB_ACCOUNT");
    assert.equal(account.position.positionPresent, false);
    assert.equal(account.alignment, "FLAT");
  }
});

test("monitor is read-only", () => {
  const out = buildStrategyAccountMonitoring({ openTrades: [], engine22WaveStrategy: engine22() });
  assert.equal(out.guardrails.noPermissionCreated, true);
  assert.equal(out.guardrails.noSizingAuthority, true);
  assert.equal(out.guardrails.noExecution, true);
  assert.equal(out.guardrails.noJournalMutation, true);
});