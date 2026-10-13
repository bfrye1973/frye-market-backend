// services/core/tests/engine10RealSchwabJournal.test.js
//
// Focused Engine 10 REAL Schwab Journal contract proof.
//
// This test NEVER writes to the production Journal.
// TRADE_JOURNAL_DIR is pointed to a temporary directory
// before tradeJournalStore.js is imported.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

function makeTempJournalDir() {
  const dir = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "engine10-real-journal-"
    )
  );

  fs.writeFileSync(
    path.join(dir, "trade-journal.json"),
    "[]"
  );

  return dir;
}

async function loadStore(tempDir) {
  process.env.TRADE_JOURNAL_DIR = tempDir;

  const moduleUrl =
    pathToFileURL(
      path.resolve(
        "services/core/logic/journal/tradeJournalStore.js"
      )
    ).href +
    `?engine10RealTest=${Date.now()}-${Math.random()}`;

  return import(moduleUrl);
}

function schwabFill({
  transactionId,
  account = "INTRADAY",
  symbol = "/MESU26:XCME",
  positionEffect,
  side,
  direction = "SHORT",
  quantity = 1,
  price,
  time,
  orderId = null,
  commission = 2.25,
  exchangeFee = 0.35,
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

    brokerTransactionId:
      String(transactionId),

    brokerOrderId:
      orderId
        ? String(orderId)
        : `ORDER-${transactionId}`,

    brokerStatus: "VALID",
    eventType: "TRADE",

    symbol,
    assetType: "FUTURE",

    positionEffect,
    side,
    direction,
    quantity,

    fillPrice: price,
    fillTime: time,

    commission,
    futuresExchangeFee:
      exchangeFee,

    totalFees:
      commission + exchangeFee,

    paper: false,
    readOnlyBrokerObservation: true,
  };
}

test(
  "Engine 10 assembles one INTRADAY short campaign through 3 opens and 3 closes exactly once",
  async (t) => {
    const tempDir =
      makeTempJournalDir();

    t.after(() => {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    });

    const {
      ingestRealBrokerFill,
      listTrades,
    } = await loadStore(tempDir);

    const opening1 =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "A-001",
          positionEffect: "OPENING",
          side: "SELL",
          quantity: 1,
          price: 7800,
          time: "2026-08-30T15:00:00.000Z",
        })
      );

    assert.equal(opening1.ok, true);
    assert.equal(opening1.created, true);
    assert.equal(opening1.updated, false);
    assert.equal(opening1.duplicate, false);
    assert.equal(opening1.status, "OPEN");
    assert.equal(opening1.remainingQty, 1);
    assert.equal(opening1.journalCompleted, true);

    const tradeId =
      opening1.tradeId;

    assert.ok(tradeId);

    const duplicateOpening =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "A-001",
          positionEffect: "OPENING",
          side: "SELL",
          quantity: 1,
          price: 7800,
          time: "2026-08-30T15:00:00.000Z",
        })
      );

    assert.equal(duplicateOpening.ok, true);
    assert.equal(duplicateOpening.duplicate, true);
    assert.equal(duplicateOpening.tradeId, tradeId);
    assert.equal(duplicateOpening.remainingQty, 1);

    const opening2 =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "A-002",
          positionEffect: "OPENING",
          side: "SELL",
          quantity: 1,
          price: 7810,
          time: "2026-08-30T15:01:00.000Z",
        })
      );

    assert.equal(opening2.tradeId, tradeId);
    assert.equal(opening2.created, false);
    assert.equal(opening2.updated, true);
    assert.equal(opening2.remainingQty, 2);
    assert.equal(
      opening2.eventType,
      "REAL_SCALE_IN_FILL"
    );

    const opening3 =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "A-003",
          positionEffect: "OPENING",
          side: "SELL",
          quantity: 1,
          price: 7820,
          time: "2026-08-30T15:02:00.000Z",
        })
      );

    assert.equal(opening3.tradeId, tradeId);
    assert.equal(opening3.remainingQty, 3);

    const close1 =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "A-004",
          positionEffect: "CLOSING",
          side: "BUY",
          quantity: 1,
          price: 7790,
          time: "2026-08-30T15:10:00.000Z",
        })
      );

    assert.equal(close1.tradeId, tradeId);
    assert.equal(close1.remainingQty, 2);
    assert.equal(
      close1.eventType,
      "REAL_PARTIAL_EXIT"
    );

    const close2 =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "A-005",
          positionEffect: "CLOSING",
          side: "BUY",
          quantity: 1,
          price: 7780,
          time: "2026-08-30T15:20:00.000Z",
        })
      );

    assert.equal(close2.tradeId, tradeId);
    assert.equal(close2.remainingQty, 1);

    const close3 =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "A-006",
          positionEffect: "CLOSING",
          side: "BUY",
          quantity: 1,
          price: 7770,
          time: "2026-08-30T15:30:00.000Z",
        })
      );

    assert.equal(close3.ok, true);
    assert.equal(close3.tradeId, tradeId);
    assert.equal(close3.status, "CLOSED");
    assert.equal(close3.remainingQty, 0);
    assert.equal(close3.journalCompleted, true);
    assert.equal(
      close3.eventType,
      "REAL_FINAL_EXIT"
    );

    const listed =
      await listTrades({
        accountMode: "REAL",
      });

    assert.equal(listed.ok, true);
    assert.equal(listed.trades.length, 1);

    const trade =
      listed.trades[0];

    assert.equal(trade.tradeId, tradeId);
    assert.equal(trade.journalAccount, "INTRADAY");
    assert.equal(trade.symbol, "MES");
    assert.equal(trade.direction, "SHORT");
    assert.equal(trade.status, "CLOSED");
    assert.equal(trade.qty.originalQty, 3);
    assert.equal(trade.qty.remainingQty, 0);
    assert.equal(
      trade.qty.cumulativeOpeningQuantity,
      3
    );
    assert.equal(
      trade.qty.cumulativeExitQuantity,
      3
    );

    // FIFO:
    // 7800 -> 7790 = 10 pts * $5 = $50
    // 7810 -> 7780 = 30 pts * $5 = $150
    // 7820 -> 7770 = 50 pts * $5 = $250
    // Gross = $450.
    assert.equal(
      trade.summary.realizedPoints,
      90
    );

    assert.equal(
      trade.summary.realizedPnL,
      450
    );

    assert.equal(
      trade.summary.grossRealizedPnL,
      450
    );

    // Six broker fills at $2.60 each.
    assert.equal(
      trade.summary.actualCommission,
      13.5
    );

    assert.equal(
      trade.summary.futuresExchangeFees,
      2.1
    );

    assert.equal(
      trade.summary.actualFees,
      15.6
    );

    assert.equal(
      trade.summary.netRealizedPnL,
      434.4
    );

    assert.equal(trade.result, "WIN");

    const lifecycleTypes =
      trade.events.map(
        (event) => event.eventType
      );

    assert.deepEqual(
      lifecycleTypes,
      [
        "REAL_ENTRY_FILL",
        "REAL_SCALE_IN_FILL",
        "REAL_SCALE_IN_FILL",
        "REAL_PARTIAL_EXIT",
        "REAL_PARTIAL_EXIT",
        "REAL_FINAL_EXIT",
        "TRADE_CLOSED",
      ]
    );

    assert.equal(
      trade.events.filter(
        (event) =>
          event.eventType ===
          "TRADE_CLOSED"
      ).length,
      1
    );

    const duplicateFinal =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "A-006",
          positionEffect: "CLOSING",
          side: "BUY",
          quantity: 1,
          price: 7770,
          time: "2026-08-30T15:30:00.000Z",
        })
      );

    assert.equal(duplicateFinal.ok, true);
    assert.equal(duplicateFinal.duplicate, true);
    assert.equal(duplicateFinal.tradeId, tradeId);
    assert.equal(duplicateFinal.status, "CLOSED");
    assert.equal(duplicateFinal.remainingQty, 0);

    const afterDuplicate =
      await listTrades({
        accountMode: "REAL",
      });

    assert.equal(
      afterDuplicate.trades[0].events.filter(
        (event) =>
          event.eventType ===
          "TRADE_CLOSED"
      ).length,
      1
    );
  }
);

test(
  "Engine 10 keeps INTRADAY and SWING campaigns separate",
  async (t) => {
    const tempDir =
      makeTempJournalDir();

    t.after(() => {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    });

    const {
      ingestRealBrokerFill,
      listTrades,
    } = await loadStore(tempDir);

    const intraday =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "I-001",
          account: "INTRADAY",
          positionEffect: "OPENING",
          side: "SELL",
          quantity: 1,
          price: 7800,
          time: "2026-08-30T16:00:00.000Z",
        })
      );

    const swing =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "S-001",
          account: "SWING",
          positionEffect: "OPENING",
          side: "SELL",
          quantity: 1,
          price: 7800,
          time: "2026-08-30T16:00:01.000Z",
        })
      );

    assert.equal(intraday.ok, true);
    assert.equal(swing.ok, true);
    assert.notEqual(
      intraday.tradeId,
      swing.tradeId
    );

    const listed =
      await listTrades({
        accountMode: "REAL",
      });

    assert.equal(listed.trades.length, 2);

    const accounts =
      new Set(
        listed.trades.map(
          (trade) =>
            trade.journalAccount
        )
      );

    assert.deepEqual(
      accounts,
      new Set([
        "INTRADAY",
        "SWING",
      ])
    );
  }
);

test(
  "Engine 10 rejects side-direction mismatch and out-of-order REAL fills",
  async (t) => {
    const tempDir =
      makeTempJournalDir();

    t.after(() => {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    });

    const {
      ingestRealBrokerFill,
    } = await loadStore(tempDir);

    const invalid =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "BAD-001",
          positionEffect: "OPENING",
          side: "BUY",
          direction: "SHORT",
          quantity: 1,
          price: 7800,
          time: "2026-08-30T17:00:00.000Z",
        })
      );

    assert.equal(invalid.ok, false);
    assert.equal(
      invalid.error,
      "INVALID_REAL_BROKER_FILL"
    );

    assert.ok(
      invalid.reasonCodes.includes(
        "REAL_FILL_SIDE_DIRECTION_MISMATCH"
      )
    );

    const first =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "O-001",
          positionEffect: "OPENING",
          side: "SELL",
          quantity: 1,
          price: 7800,
          time: "2026-08-30T17:10:00.000Z",
        })
      );

    assert.equal(first.ok, true);

    const outOfOrder =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "O-002",
          positionEffect: "OPENING",
          side: "SELL",
          quantity: 1,
          price: 7801,
          time: "2026-08-30T17:09:00.000Z",
        })
      );

    assert.equal(outOfOrder.ok, false);
    assert.equal(
      outOfOrder.error,
      "REAL_FILL_OUT_OF_ORDER"
    );
  }
);

test(
  "Engine 10 refuses ambiguous REAL campaign matches instead of guessing",
  async (t) => {
    const tempDir =
      makeTempJournalDir();

    t.after(() => {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    });

    const {
      ingestRealBrokerFill,
    } = await loadStore(tempDir);

    const fixture = [
      {
        tradeId: "AMB-1",
        source: "SCHWAB_BROKER_FILL",
        broker: "SCHWAB",
        accountMode: "REAL",
        journalAccount: "INTRADAY",
        symbol: "MES",
        normalizedInstrumentRoot: "MES",
        direction: "SHORT",
        status: "OPEN",
        qty: {
          originalQty: 1,
          remainingQty: 1,
          cumulativeOpeningQuantity: 1,
          cumulativeExitQuantity: 0,
        },
        brokerImport: {
          accountAlias: "INTRADAY",
          remainingLots: [
            {
              qty: 1,
              price: 7800,
            },
          ],
        },
        events: [],
        createdAt: "2026-08-30T18:00:00.000Z",
        updatedAt: "2026-08-30T18:00:00.000Z",
      },
      {
        tradeId: "AMB-2",
        source: "SCHWAB_BROKER_FILL",
        broker: "SCHWAB",
        accountMode: "REAL",
        journalAccount: "INTRADAY",
        symbol: "MES",
        normalizedInstrumentRoot: "MES",
        direction: "SHORT",
        status: "OPEN",
        qty: {
          originalQty: 1,
          remainingQty: 1,
          cumulativeOpeningQuantity: 1,
          cumulativeExitQuantity: 0,
        },
        brokerImport: {
          accountAlias: "INTRADAY",
          remainingLots: [
            {
              qty: 1,
              price: 7810,
            },
          ],
        },
        events: [],
        createdAt: "2026-08-30T18:01:00.000Z",
        updatedAt: "2026-08-30T18:01:00.000Z",
      },
    ];

    fs.writeFileSync(
      path.join(
        tempDir,
        "trade-journal.json"
      ),
      JSON.stringify(
        fixture,
        null,
        2
      )
    );

    const out =
      await ingestRealBrokerFill(
        schwabFill({
          transactionId: "AMB-CLOSE",
          positionEffect: "CLOSING",
          side: "BUY",
          quantity: 1,
          price: 7790,
          time: "2026-08-30T18:10:00.000Z",
        })
      );

    assert.equal(out.ok, false);
    assert.equal(
      out.error,
      "AMBIGUOUS_REAL_CAMPAIGN_MATCH"
    );

    assert.deepEqual(
      new Set(out.matchingTradeIds),
      new Set([
        "AMB-1",
        "AMB-2",
      ])
    );
  }
);
