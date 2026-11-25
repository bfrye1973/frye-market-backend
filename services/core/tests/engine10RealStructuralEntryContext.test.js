import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine10-entry-context-"));
process.env.TRADE_JOURNAL_DIR = tmpDir;

const { ingestRealBrokerFill } = await import("../logic/journal/tradeJournalStore.js");

function realOpeningFill() {
  return {
    source: "SCHWAB_BROKER_FILL",
    broker: "SCHWAB",
    accountMode: "REAL",
    brokerAccountLabel: "SCHWAB_0747",
    journalAccount: "SWING",
    brokerTransactionId: "ENTRY-CONTEXT-1",
    brokerOrderId: "ORDER-ENTRY-CONTEXT-1",
    brokerStatus: "VALID",
    eventType: "TRADE",
    symbol: "/MESZ26:XCME",
    assetType: "FUTURE",
    positionEffect: "OPENING",
    side: "BUY",
    direction: "LONG",
    quantity: 1,
    fillPrice: 8000,
    fillTime: "2026-10-10T19:30:00.000Z",
    commission: 0,
    futuresExchangeFee: 0,
    totalFees: 0,
    paper: false,
    readOnlyBrokerObservation: true,
  };
}

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("new REAL campaign persists strategy role and immutable structural-entry contract", async () => {
  const out = await ingestRealBrokerFill(realOpeningFill());
  assert.equal(out.ok, true);
  assert.equal(out.created, true);
  assert.equal(out.trade.strategyAccountRole, "SUBMINUTE");
  assert.ok(out.trade.structuralContextAtEntry);
  assert.equal(out.trade.structuralContextAtEntry.accountRole, "SUBMINUTE");
  assert.equal(out.trade.structuralContextAtEntry.historicalBackfill ?? false, false);
  assert.match(
    String(out.trade.structuralContextAtEntry.reason ?? out.trade.structuralContextAtEntry.contractVersion),
    /ENGINE22_STRUCTURE_UNAVAILABLE_AT_ENTRY|engine10\.structuralContextAtEntry\.v1/
  );
});