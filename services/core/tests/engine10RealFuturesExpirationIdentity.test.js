// services/core/tests/engine10RealFuturesExpirationIdentity.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "engine10-expiration-id-"
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

function fill({
  id,
  account = "INTRADAY",
  contractCode = "MESU26",
  effect,
  side,
  qty,
  price,
  time,
  direction = "SHORT",
}) {
  const month =
    contractCode.includes("Z")
      ? "DEC"
      : "SEP";

  const monthCode =
    contractCode.includes("Z")
      ? "Z"
      : "U";

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

    /*
     * Mimic the new Engine 8 expiration-aware normalizedFill contract:
     * preserve brokerSymbol exactly and publish normalizedInstrumentRoot.
     *
     * Intentionally omit symbol/instrumentRoot so this test proves Engine 10
     * accepts the new canonical aliases directly.
     */
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
      0,

    totalFees:
      0,

    paper:
      false,

    readOnlyBrokerObservation:
      true,
  };
}

function contractRows(
  trade
) {
  return (
    trade?.realBroker
      ?.contracts || []
  );
}

function openContractRows(
  trade
) {
  return contractRows(
    trade
  ).filter(
    contract =>
      contract.status ===
      "OPEN"
  );
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

test("Engine 8 brokerSymbol-only normalized fills preserve exact U26 futures identity", async () => {
  const out =
    await ingestRealBrokerFill(
      fill({
        id:
          "U26-OPEN-1",
        contractCode:
          "MESU26",
        effect:
          "OPENING",
        side:
          "SELL",
        qty: 2,
        price: 7700,
        time:
          "2026-09-10T14:00:00.000Z",
      })
    );

  assert.equal(
    out.ok,
    true
  );

  assert.equal(
    out.trade
      .normalizedInstrumentRoot,
    "MES"
  );

  assert.equal(
    out.trade
      .brokerSymbol,
    "/MESU26:XCME"
  );

  assert.equal(
    out.trade
      .futuresContractCode,
    "MESU26"
  );

  assert.equal(
    out.trade
      .contractMonthCode,
    "U"
  );

  assert.equal(
    out.trade
      .contractMonth,
    "SEP"
  );

  assert.equal(
    out.trade
      .contractYear,
    2026
  );

  assert.equal(
    contractRows(
      out.trade
    ).length,
    2
  );

  assert.ok(
    contractRows(
      out.trade
    ).every(
      contract =>
        contract.futuresContractCode ===
          "MESU26" &&
        contract.brokerSymbol ===
          "/MESU26:XCME"
    )
  );

  assert.ok(
    out.trade.realBroker
      .remainingLots
      .every(
        lot =>
          lot.futuresContractCode ===
            "MESU26" &&
          lot.brokerSymbol ===
            "/MESU26:XCME"
      )
  );
});

test("Z26 closing fill cannot close an OPEN U26 campaign", async () => {
  const out =
    await ingestRealBrokerFill(
      fill({
        id:
          "Z26-WRONG-CLOSE",
        contractCode:
          "MESZ26",
        effect:
          "CLOSING",
        side:
          "BUY",
        qty: 1,
        price: 7690,
        time:
          "2026-09-10T14:01:00.000Z",
      })
    );

  assert.equal(
    out.ok,
    false
  );

  assert.equal(
    out.error,
    "REAL_OPEN_CAMPAIGN_NOT_FOUND"
  );

  assert.equal(
    out.futuresContractCode,
    "MESZ26"
  );

  const listed =
    await listTrades({
      accountMode:
        "REAL",
    });

  const u26 =
    listed.trades.find(
      trade =>
        trade.journalAccount ===
          "INTRADAY" &&
        trade.futuresContractCode ===
          "MESU26"
    );

  assert.equal(
    u26.qty.remainingQty,
    2
  );

  assert.equal(
    openContractRows(
      u26
    ).length,
    2
  );
});

test("same account can hold U26 and Z26 simultaneously as separate campaigns", async () => {
  const out =
    await ingestRealBrokerFill(
      fill({
        id:
          "Z26-OPEN-1",
        contractCode:
          "MESZ26",
        effect:
          "OPENING",
        side:
          "SELL",
        qty: 2,
        price: 7680,
        time:
          "2026-09-10T14:02:00.000Z",
      })
    );

  assert.equal(
    out.ok,
    true
  );

  const listed =
    await listTrades({
      accountMode:
        "REAL",
    });

  const intradayOpen =
    listed.trades.filter(
      trade =>
        trade.journalAccount ===
          "INTRADAY" &&
        trade.status ===
          "OPEN"
    );

  assert.equal(
    intradayOpen.length,
    2
  );

  assert.deepEqual(
    new Set(
      intradayOpen.map(
        trade =>
          trade.futuresContractCode
      )
    ),
    new Set([
      "MESU26",
      "MESZ26",
    ])
  );

  assert.notEqual(
    intradayOpen[0]
      .tradeId,
    intradayOpen[1]
      .tradeId
  );
});

test("Z26 close FIFO-closes only a Z26 contractId and leaves U26 untouched", async () => {
  const before =
    await listTrades({
      accountMode:
        "REAL",
    });

  const u26Before =
    before.trades.find(
      trade =>
        trade.journalAccount ===
          "INTRADAY" &&
        trade.futuresContractCode ===
          "MESU26"
    );

  const z26Before =
    before.trades.find(
      trade =>
        trade.journalAccount ===
          "INTRADAY" &&
        trade.futuresContractCode ===
          "MESZ26"
    );

  const firstZ26ContractId =
    z26Before.realBroker
      .contracts[0]
      .contractId;

  const u26OpenBefore =
    openContractRows(
      u26Before
    ).map(
      contract =>
        contract.contractId
    );

  const out =
    await ingestRealBrokerFill(
      fill({
        id:
          "Z26-CLOSE-1",
        contractCode:
          "MESZ26",
        effect:
          "CLOSING",
        side:
          "BUY",
        qty: 1,
        price: 7670,
        time:
          "2026-09-10T14:03:00.000Z",
      })
    );

  assert.equal(
    out.ok,
    true
  );

  assert.equal(
    out.trade
      .futuresContractCode,
    "MESZ26"
  );

  const closeEvent =
    out.trade.events.find(
      event =>
        event.brokerTransactionId ===
        "Z26-CLOSE-1"
    );

  assert.equal(
    closeEvent
      .closedContracts
      .length,
    1
  );

  assert.equal(
    closeEvent
      .closedContracts[0]
      .contractId,
    firstZ26ContractId
  );

  assert.equal(
    closeEvent
      .closedContracts[0]
      .futuresContractCode,
    "MESZ26"
  );

  const after =
    await listTrades({
      accountMode:
        "REAL",
    });

  const u26After =
    after.trades.find(
      trade =>
        trade.journalAccount ===
          "INTRADAY" &&
        trade.futuresContractCode ===
          "MESU26"
    );

  assert.deepEqual(
    openContractRows(
      u26After
    ).map(
      contract =>
        contract.contractId
    ),
    u26OpenBefore
  );
});

test("U26 close FIFO-closes only a U26 contractId and leaves Z26 open", async () => {
  const before =
    await listTrades({
      accountMode:
        "REAL",
    });

  const u26Before =
    before.trades.find(
      trade =>
        trade.journalAccount ===
          "INTRADAY" &&
        trade.futuresContractCode ===
          "MESU26"
    );

  const firstU26ContractId =
    openContractRows(
      u26Before
    )[0].contractId;

  const out =
    await ingestRealBrokerFill(
      fill({
        id:
          "U26-CLOSE-1",
        contractCode:
          "MESU26",
        effect:
          "CLOSING",
        side:
          "BUY",
        qty: 1,
        price: 7660,
        time:
          "2026-09-10T14:04:00.000Z",
      })
    );

  assert.equal(
    out.ok,
    true
  );

  const closeEvent =
    out.trade.events.find(
      event =>
        event.brokerTransactionId ===
        "U26-CLOSE-1"
    );

  assert.equal(
    closeEvent
      .closedContracts[0]
      .contractId,
    firstU26ContractId
  );

  assert.equal(
    closeEvent
      .closedContracts[0]
      .futuresContractCode,
    "MESU26"
  );

  const listed =
    await listTrades({
      accountMode:
        "REAL",
    });

  const z26 =
    listed.trades.find(
      trade =>
        trade.journalAccount ===
          "INTRADAY" &&
        trade.futuresContractCode ===
          "MESZ26"
    );

  assert.equal(
    z26.qty.remainingQty,
    1
  );

  assert.equal(
    openContractRows(
      z26
    ).length,
    1
  );
});

test("quantity > 1 opening creates individual contractIds with identical exact expiration lineage", async () => {
  const out =
    await ingestRealBrokerFill(
      fill({
        id:
          "SWING-Z26-OPEN-3",
        account:
          "SWING",
        contractCode:
          "MESZ26",
        effect:
          "OPENING",
        side:
          "SELL",
        qty: 3,
        price: 7650,
        time:
          "2026-09-10T15:00:00.000Z",
      })
    );

  const contracts =
    out.trade.realBroker
      .contracts;

  assert.equal(
    contracts.length,
    3
  );

  assert.equal(
    new Set(
      contracts.map(
        contract =>
          contract.contractId
      )
    ).size,
    3
  );

  assert.ok(
    contracts.every(
      contract =>
        contract.futuresContractCode ===
          "MESZ26" &&
        contract.contractMonthCode ===
          "Z" &&
        contract.contractMonth ===
          "DEC" &&
        contract.contractYear ===
          2026 &&
        contract.brokerSymbol ===
          "/MESZ26:XCME"
    )
  );
});

test("FIFO hard guard rejects a mismatched expiration lot even if campaign identity matches", async () => {
  const open =
    await ingestRealBrokerFill(
      fill({
        id:
          "SWING-U26-GUARD-OPEN",
        account:
          "SWING",
        contractCode:
          "MESU26",
        effect:
          "OPENING",
        side:
          "SELL",
        qty: 1,
        price: 7640,
        time:
          "2026-09-10T15:10:00.000Z",
      })
    );

  assert.equal(
    open.ok,
    true
  );

  const journal =
    JSON.parse(
      fs.readFileSync(
        JOURNAL_FILE,
        "utf8"
      )
    );

  const trade =
    journal.find(
      row =>
        row.tradeId ===
        open.trade.tradeId
    );

  /*
   * Simulate a corrupted/mixed FIFO lot while leaving the campaign itself U26.
   * Engine 10 must refuse to consume it rather than crossing expirations.
   */
  trade.realBroker
    .remainingLots[0]
    .futuresContractCode =
      "MESZ26";

  trade.realBroker
    .remainingLots[0]
    .brokerSymbol =
      "/MESZ26:XCME";

  trade.brokerImport
    .remainingLots =
      structuredClone(
        trade.realBroker
          .remainingLots
      );

  fs.writeFileSync(
    JOURNAL_FILE,
    JSON.stringify(
      journal,
      null,
      2
    )
  );

  const out =
    await ingestRealBrokerFill(
      fill({
        id:
          "SWING-U26-GUARD-CLOSE",
        account:
          "SWING",
        contractCode:
          "MESU26",
        effect:
          "CLOSING",
        side:
          "BUY",
        qty: 1,
        price: 7630,
        time:
          "2026-09-10T15:11:00.000Z",
      })
    );

  assert.equal(
    out.ok,
    false
  );

  assert.equal(
    out.error,
    "REAL_FIFO_FUTURES_CONTRACT_MISMATCH"
  );

  assert.equal(
    out.expectedFuturesContractCode,
    "MESU26"
  );

  assert.equal(
    out.lotFuturesContractCode,
    "MESZ26"
  );
});
