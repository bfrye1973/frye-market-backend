// services/core/tests/engine10RealClosedContracts.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "engine10-closed-contracts-")
);

process.env.TRADE_JOURNAL_DIR = tmpDir;

const {
  ingestRealBrokerFill,
  listTrades,
} = await import(
  "../logic/journal/tradeJournalStore.js"
);

function fill({
  id,
  account = "INTRADAY",
  effect,
  side,
  direction = "SHORT",
  qty,
  price,
  time,
}) {
  return {
    source: "SCHWAB_BROKER_FILL",
    broker: "SCHWAB",
    accountMode: "REAL",
    brokerAccountLabel:
      account === "INTRADAY"
        ? "SCHWAB_6380"
        : "SCHWAB_0747",
    journalAccount: account,
    brokerTransactionId: id,
    brokerOrderId: `ORDER-${id}`,
    brokerStatus: "VALID",
    eventType: "TRADE",
    symbol: "/MESU26:XCME",
    assetType: "FUTURE",
    positionEffect: effect,
    side,
    direction,
    quantity: qty,
    fillPrice: price,
    fillTime: time,
    commission: 0,
    futuresExchangeFee: 0,
    totalFees: 0,
    paper: false,
    readOnlyBrokerObservation: true,
  };
}

test.after(() => {
  fs.rmSync(tmpDir, {
    recursive: true,
    force: true,
  });
});

test("one-contract close persists exactly one closed contract result", async () => {
  await ingestRealBrokerFill(fill({
    id:"OPEN-1", effect:"OPENING", side:"SELL",
    qty:1, price:7800, time:"2026-08-30T16:00:00.000Z"
  }));

  const out=await ingestRealBrokerFill(fill({
    id:"CLOSE-1", effect:"CLOSING", side:"BUY",
    qty:1, price:7790, time:"2026-08-30T16:01:00.000Z"
  }));

  const event=out.trade.events.find(e=>e.brokerTransactionId==="CLOSE-1");
  assert.equal(event.closedContracts.length,1);
  assert.equal(event.closedContracts[0].quantity,1);
  assert.equal(event.closedContracts[0].entryPrice,7800);
  assert.equal(event.closedContracts[0].exitPrice,7790);
  assert.equal(event.closedContracts[0].realizedPoints,10);
  assert.equal(event.closedContracts[0].grossRealizedPnL,50);
  assert.equal(event.grossEventRealizedPnL,50);
});

test("two-contract close from same opening lot persists two exact observations", async () => {
  await ingestRealBrokerFill(fill({
    id:"OPEN-2", effect:"OPENING", side:"SELL",
    qty:2, price:7780, time:"2026-08-30T17:00:00.000Z"
  }));

  const out=await ingestRealBrokerFill(fill({
    id:"CLOSE-2", effect:"CLOSING", side:"BUY",
    qty:2, price:7775, time:"2026-08-30T17:01:00.000Z"
  }));

  const event=out.trade.events.find(e=>e.brokerTransactionId==="CLOSE-2");
  assert.equal(event.closedContracts.length,2);
  assert.deepEqual(
    event.closedContracts.map(c=>c.grossRealizedPnL),
    [25,25]
  );
  assert.equal(
    event.closedContracts.reduce((s,c)=>s+c.grossRealizedPnL,0),
    event.grossEventRealizedPnL
  );
});

test("FIFO close across different opening prices preserves each contract result", async () => {
  await ingestRealBrokerFill(fill({
    id:"OPEN-3A", effect:"OPENING", side:"SELL",
    qty:1, price:7760, time:"2026-08-30T18:00:00.000Z"
  }));
  await ingestRealBrokerFill(fill({
    id:"OPEN-3B", effect:"OPENING", side:"SELL",
    qty:1, price:7750, time:"2026-08-30T18:01:00.000Z"
  }));

  const out=await ingestRealBrokerFill(fill({
    id:"CLOSE-3", effect:"CLOSING", side:"BUY",
    qty:2, price:7740, time:"2026-08-30T18:02:00.000Z"
  }));

  const event=out.trade.events.find(e=>e.brokerTransactionId==="CLOSE-3");
  assert.equal(event.closedContracts.length,2);
  assert.deepEqual(
    event.closedContracts.map(c=>c.entryPrice),
    [7760,7750]
  );
  assert.deepEqual(
    event.closedContracts.map(c=>c.grossRealizedPnL),
    [100,50]
  );
  assert.equal(event.grossEventRealizedPnL,150);
});

test("partial close records contract result immediately while campaign remains open", async () => {
  await ingestRealBrokerFill(fill({
    id:"OPEN-4", account:"SWING", effect:"OPENING", side:"SELL",
    qty:3, price:7730, time:"2026-08-30T19:00:00.000Z"
  }));

  const out=await ingestRealBrokerFill(fill({
    id:"CLOSE-4", account:"SWING", effect:"CLOSING", side:"BUY",
    qty:1, price:7720, time:"2026-08-30T19:01:00.000Z"
  }));

  assert.equal(out.status,"OPEN");
  assert.equal(out.remainingQty,2);
  const event=out.trade.events.find(e=>e.brokerTransactionId==="CLOSE-4");
  assert.equal(event.closedContracts.length,1);
  assert.equal(event.closedContracts[0].grossRealizedPnL,50);
});

test("duplicate close does not create duplicate closed-contract observations", async () => {
  const close=fill({
    id:"CLOSE-4-DUP", account:"SWING", effect:"CLOSING", side:"BUY",
    qty:1, price:7710, time:"2026-08-30T19:02:00.000Z"
  });

  const first=await ingestRealBrokerFill(close);
  const second=await ingestRealBrokerFill(close);

  assert.equal(first.duplicate,false);
  assert.equal(second.duplicate,true);

  const journal=await listTrades({accountMode:"REAL"});
  const trade=journal.trades.find(t=>t.journalAccount==="SWING");
  const matching=trade.events.filter(e=>e.brokerTransactionId==="CLOSE-4-DUP");
  assert.equal(matching.length,1);
  assert.equal(matching[0].closedContracts.length,1);
});
