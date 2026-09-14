// services/core/tests/engine10RealBrokerFillLegIdentity.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "engine10-leg-aware-real-fill-"
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


const JOURNAL_FILE =
  path.join(
    tmpDir,
    "trade-journal.json"
  );

test.beforeEach(() => {
  fs.writeFileSync(
    JOURNAL_FILE,
    "[]"
  );
});

function fill({
  parentId,
  legId = null,
  account = "SWING",
  effect,
  side,
  direction,
  qty = 1,
  price,
  time,
  contractCode = "MESU26",
  totalFees = 0,
}) {
  const monthCode =
    contractCode.includes("Z")
      ? "Z"
      : "U";

  const month =
    monthCode === "Z"
      ? "DEC"
      : "SEP";

  const out = {
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
      parentId,

    brokerOrderId:
      `ORDER-${parentId}`,

    brokerStatus:
      "VALID",

    eventType:
      "TRADE",

    brokerSymbol:
      `/${contractCode}:XCME`,

    normalizedInstrumentRoot:
      "MES",

    futuresContractCode:
      contractCode,

    contractMonthCode:
      monthCode,

    contractMonth:
      month,

    contractYear:
      2026,

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
      totalFees,

    otherFees:
      0,

    totalFees,

    paper:
      false,

    readOnlyBrokerObservation:
      true,
  };

  if (legId) {
    out.brokerFillLegId =
      legId;

    out.brokerFillIdentity =
      `SCHWAB|${account}|${parentId}|${legId}`;
  }

  return out;
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

test("proven 130323453531 cross-through ingests CLOSING LONG then OPENING SHORT under same parent activityId", async () => {
  const openingLong =
    await ingestRealBrokerFill(
      fill({
        parentId:
          "130299775797",

        effect:
          "OPENING",

        side:
          "BUY",

        direction:
          "LONG",

        price:
          7601.75,

        time:
          "2026-09-10T12:42:10.000Z",
      })
    );

  assert.equal(
    openingLong.ok,
    true
  );

  const closeLegId =
    "CLOSING|LONG|SELL|/MESU26:XCME|1|7613.25|OCC1";

  const openLegId =
    "OPENING|SHORT|SELL|/MESU26:XCME|1|7613.25|OCC1";

  const closeLong =
    await ingestRealBrokerFill(
      fill({
        parentId:
          "130323453531",

        legId:
          closeLegId,

        effect:
          "CLOSING",

        side:
          "SELL",

        direction:
          "LONG",

        price:
          7613.25,

        time:
          "2026-09-10T14:24:40.000Z",

        totalFees:
          1.30,
      })
    );

  assert.equal(
    closeLong.ok,
    true
  );

  assert.equal(
    closeLong.duplicate,
    false
  );

  assert.equal(
    closeLong.status,
    "CLOSED"
  );

  const openShort =
    await ingestRealBrokerFill(
      fill({
        parentId:
          "130323453531",

        legId:
          openLegId,

        effect:
          "OPENING",

        side:
          "SELL",

        direction:
          "SHORT",

        price:
          7613.25,

        time:
          "2026-09-10T14:24:40.000Z",

        totalFees:
          1.30,
      })
    );

  assert.equal(
    openShort.ok,
    true
  );

  assert.equal(
    openShort.duplicate,
    false
  );

  assert.equal(
    openShort.status,
    "OPEN"
  );

  assert.notEqual(
    closeLong.tradeId,
    openShort.tradeId
  );

  const journal =
    await listTrades({
      accountMode:
        "REAL",
    });

  const longTrade =
    journal.trades.find(
      (trade) =>
        trade.direction ===
          "LONG" &&
        trade.journalAccount ===
          "SWING"
    );

  const shortTrade =
    journal.trades.find(
      (trade) =>
        trade.direction ===
          "SHORT" &&
        trade.journalAccount ===
          "SWING"
    );

  assert.equal(
    longTrade.status,
    "CLOSED"
  );

  assert.equal(
    shortTrade.status,
    "OPEN"
  );

  const longContract =
    longTrade.realBroker
      .contracts[0];

  assert.equal(
    longContract.openingBrokerTransactionId,
    "130299775797"
  );

  assert.equal(
    longContract.closingBrokerTransactionId,
    "130323453531"
  );

  assert.equal(
    longContract.closingBrokerFillLegId,
    closeLegId
  );

  const shortContract =
    shortTrade.realBroker
      .contracts[0];

  assert.equal(
    shortContract.openingBrokerTransactionId,
    "130323453531"
  );

  assert.equal(
    shortContract.openingBrokerFillLegId,
    openLegId
  );

  assert.match(
    shortContract.contractId,
    /\|CTR\|130323453531\|LEG\|/
  );

  const closeEvent =
    longTrade.events.find(
      (event) =>
        event.brokerFillLegId ===
        closeLegId
    );

  const openEvent =
    shortTrade.events.find(
      (event) =>
        event.brokerFillLegId ===
        openLegId
    );

  assert.equal(
    closeEvent.brokerTransactionId,
    "130323453531"
  );

  assert.equal(
    openEvent.brokerTransactionId,
    "130323453531"
  );

  assert.equal(
    closeEvent.brokerFillIdentity,
    `SCHWAB|SWING|130323453531|${closeLegId}`
  );

  assert.equal(
    openEvent.brokerFillIdentity,
    `SCHWAB|SWING|130323453531|${openLegId}`
  );
});

test("distinct legs under one parent are not duplicates; replay of either exact leg is blocked", async () => {
  const parentId =
    "LEG-DEDUPE-PARENT";

  const legA =
    "OPENING|SHORT|SELL|/MESZ26:XCME|1|7700|OCC1";

  const legB =
    "OPENING|SHORT|SELL|/MESZ26:XCME|1|7701|OCC1";

  const first =
    await ingestRealBrokerFill(
      fill({
        parentId,
        legId:
          legA,
        effect:
          "OPENING",
        side:
          "SELL",
        direction:
          "SHORT",
        price:
          7700,
        time:
          "2026-09-11T10:00:00.000Z",
        contractCode:
          "MESZ26",
      })
    );

  const second =
    await ingestRealBrokerFill(
      fill({
        parentId,
        legId:
          legB,
        effect:
          "OPENING",
        side:
          "SELL",
        direction:
          "SHORT",
        price:
          7701,
        time:
          "2026-09-11T10:00:00.000Z",
        contractCode:
          "MESZ26",
      })
    );

  assert.equal(
    first.ok,
    true
  );

  assert.equal(
    first.duplicate,
    false
  );

  assert.equal(
    second.ok,
    true
  );

  assert.equal(
    second.duplicate,
    false
  );

  const replayA =
    await ingestRealBrokerFill(
      fill({
        parentId,
        legId:
          legA,
        effect:
          "OPENING",
        side:
          "SELL",
        direction:
          "SHORT",
        price:
          7700,
        time:
          "2026-09-11T10:00:00.000Z",
        contractCode:
          "MESZ26",
      })
    );

  const replayB =
    await ingestRealBrokerFill(
      fill({
        parentId,
        legId:
          legB,
        effect:
          "OPENING",
        side:
          "SELL",
        direction:
          "SHORT",
        price:
          7701,
        time:
          "2026-09-11T10:00:00.000Z",
        contractCode:
          "MESZ26",
      })
    );

  assert.equal(
    replayA.duplicate,
    true
  );

  assert.equal(
    replayB.duplicate,
    true
  );
});

test("legacy no-leg fill still dedupes exactly by parent brokerTransactionId", async () => {
  const legacy =
    fill({
      parentId:
        "LEGACY-PARENT-1",

      effect:
        "OPENING",

      side:
        "SELL",

      direction:
        "SHORT",

      price:
        7750,

      time:
        "2026-09-12T10:00:00.000Z",
    });

  const first =
    await ingestRealBrokerFill(
      legacy
    );

  const second =
    await ingestRealBrokerFill(
      legacy
    );

  assert.equal(
    first.duplicate,
    false
  );

  assert.equal(
    second.duplicate,
    true
  );

  const event =
    first.trade.events.find(
      (row) =>
        row.brokerTransactionId ===
        "LEGACY-PARENT-1"
    );

  assert.equal(
    event.brokerFillLegId,
    null
  );

  assert.equal(
    event.brokerFillIdentity,
    "SCHWAB|SWING|LEGACY-PARENT-1"
  );

  assert.equal(
    event.brokerDedupeKey,
    "SCHWAB|SWING|LEGACY-PARENT-1"
  );
});

test("leg-aware opening quantity >1 preserves one durable contractId per contract with same leg lineage", async () => {
  const legId =
    "OPENING|SHORT|SELL|/MESU26:XCME|3|7800|OCC1";

  const out =
    await ingestRealBrokerFill(
      fill({
        parentId:
          "QTY3-LEG-PARENT",

        legId,

        effect:
          "OPENING",

        side:
          "SELL",

        direction:
          "SHORT",

        qty:
          3,

        price:
          7800,

        time:
          "2026-09-13T10:00:00.000Z",
      })
    );

  assert.equal(
    out.ok,
    true
  );

  assert.equal(
    out.trade.realBroker
      .contracts.length,
    3
  );

  assert.equal(
    new Set(
      out.trade.realBroker
        .contracts
        .map(
          (contract) =>
            contract.contractId
        )
    ).size,
    3
  );

  assert.ok(
    out.trade.realBroker
      .contracts
      .every(
        (contract) =>
          contract.openingBrokerTransactionId ===
            "QTY3-LEG-PARENT" &&
          contract.openingBrokerFillLegId ===
            legId
      )
  );
});
