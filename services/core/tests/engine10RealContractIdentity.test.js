// services/core/tests/engine10RealContractIdentity.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "engine10-contract-id-"
    )
  );

process.env.TRADE_JOURNAL_DIR =
  tmpDir;

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
  qty,
  price,
  time,
  direction = "SHORT",
}) {
  return {
    source:
      "SCHWAB_BROKER_FILL",

    broker:
      "SCHWAB",

    accountMode:
      "REAL",

    brokerAccountLabel:
      account === "INTRADAY"
        ? "SCHWAB_6380"
        : "SCHWAB_0747",

    journalAccount:
      account,

    brokerTransactionId:
      id,

    brokerOrderId:
      `ORDER-${id}`,

    brokerStatus:
      "VALID",

    eventType:
      "TRADE",

    symbol:
      "/MESU26:XCME",

    assetType:
      "FUTURE",

    positionEffect:
      effect,

    side,
    direction,
    quantity:
      qty,

    fillPrice:
      price,

    fillTime:
      time,

    commission:
      0,

    futuresExchangeFee:
      0,

    totalFees:
      0,

    paper:
      false,

    readOnlyBrokerObservation:
      true,
  };
}

test.after(() => {
  fs.rmSync(
    tmpDir,
    {
      recursive: true,
      force: true,
    }
  );
});

test("opening quantity 3 creates three durable OPEN contractIds", async () => {
  const out =
    await ingestRealBrokerFill(
      fill({
        id: "OPEN-A",
        effect: "OPENING",
        side: "SELL",
        qty: 3,
        price: 7800,
        time:
          "2026-08-30T16:00:00.000Z",
      })
    );

  const contracts =
    out.trade.realBroker.contracts;

  assert.equal(
    contracts.length,
    3
  );

  assert.equal(
    new Set(
      contracts.map(
        (c) => c.contractId
      )
    ).size,
    3
  );

  assert.deepEqual(
    contracts.map(
      (c) => c.status
    ),
    [
      "OPEN",
      "OPEN",
      "OPEN",
    ]
  );

  assert.deepEqual(
    out.trade.realBroker.remainingLots.map(
      (lot) => lot.qty
    ),
    [
      1,
      1,
      1,
    ]
  );
});

test("closing one contract closes exactly the first FIFO contractId", async () => {
  const before =
    await listTrades({
      accountMode:
        "REAL",
    });

  const tradeBefore =
    before.trades.find(
      (t) =>
        t.journalAccount ===
        "INTRADAY"
    );

  const firstContractId =
    tradeBefore.realBroker
      .contracts[0]
      .contractId;

  const out =
    await ingestRealBrokerFill(
      fill({
        id: "CLOSE-A1",
        effect: "CLOSING",
        side: "BUY",
        qty: 1,
        price: 7790,
        time:
          "2026-08-30T16:01:00.000Z",
      })
    );

  const event =
    out.trade.events.find(
      (e) =>
        e.brokerTransactionId ===
        "CLOSE-A1"
    );

  assert.equal(
    event.closedContracts.length,
    1
  );

  assert.equal(
    event.closedContracts[0]
      .contractId,
    firstContractId
  );

  const closedRegistry =
    out.trade.realBroker
      .contracts.find(
        (c) =>
          c.contractId ===
          firstContractId
      );

  assert.equal(
    closedRegistry.status,
    "CLOSED"
  );

  assert.equal(
    closedRegistry
      .closingBrokerTransactionId,
    "CLOSE-A1"
  );

  assert.equal(
    out.remainingQty,
    2
  );
});

test("closing quantity 2 closes exactly two remaining contractIds", async () => {
  const out =
    await ingestRealBrokerFill(
      fill({
        id: "CLOSE-A2",
        effect: "CLOSING",
        side: "BUY",
        qty: 2,
        price: 7780,
        time:
          "2026-08-30T16:02:00.000Z",
      })
    );

  const event =
    out.trade.events.find(
      (e) =>
        e.brokerTransactionId ===
        "CLOSE-A2"
    );

  assert.equal(
    event.closedContracts.length,
    2
  );

  assert.equal(
    new Set(
      event.closedContracts.map(
        (c) =>
          c.contractId
      )
    ).size,
    2
  );

  assert.equal(
    out.trade.realBroker
      .contracts.filter(
        (c) =>
          c.status ===
          "CLOSED"
      ).length,
    3
  );

  assert.equal(
    out.remainingQty,
    0
  );

  assert.equal(
    out.status,
    "CLOSED"
  );
});

test("INTRADAY and SWING contractIds remain in separate registries", async () => {
  const out =
    await ingestRealBrokerFill(
      fill({
        id: "SWING-OPEN",
        account: "SWING",
        effect: "OPENING",
        side: "SELL",
        qty: 2,
        price: 7770,
        time:
          "2026-08-30T17:00:00.000Z",
      })
    );

  assert.equal(
    out.trade.journalAccount,
    "SWING"
  );

  assert.equal(
    out.trade.realBroker
      .contracts.length,
    2
  );

  assert.ok(
    out.trade.realBroker
      .contracts.every(
        (c) =>
          c.journalAccount ===
          "SWING"
      )
  );
});

test("duplicate close never closes a contractId twice", async () => {
  const closingFill =
    fill({
      id: "SWING-CLOSE",
      account: "SWING",
      effect: "CLOSING",
      side: "BUY",
      qty: 1,
      price: 7760,
      time:
        "2026-08-30T17:01:00.000Z",
    });

  const first =
    await ingestRealBrokerFill(
      closingFill
    );

  const second =
    await ingestRealBrokerFill(
      closingFill
    );

  assert.equal(
    first.duplicate,
    false
  );

  assert.equal(
    second.duplicate,
    true
  );

  const closedIds =
    first.trade.realBroker
      .contracts
      .filter(
        (c) =>
          c.status ===
          "CLOSED"
      )
      .map(
        (c) =>
          c.contractId
      );

  assert.equal(
    closedIds.length,
    1
  );

  assert.equal(
    new Set(
      closedIds
    ).size,
    1
  );
});
