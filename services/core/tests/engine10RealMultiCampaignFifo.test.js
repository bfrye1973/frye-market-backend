// services/core/tests/engine10RealMultiCampaignFifo.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "engine10-multi-campaign-fifo-"
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
  account = "SWING",
  contractCode = "MESU26",
  effect,
  side,
  qty,
  price,
  time,
  direction = "SHORT",
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
}

function readTrades() {
  return JSON.parse(
    fs.readFileSync(
      JOURNAL_FILE,
      "utf8"
    )
  );
}

function writeTrades(trades) {
  fs.writeFileSync(
    JOURNAL_FILE,
    JSON.stringify(
      trades,
      null,
      2
    )
  );
}

function openContracts(
  trades,
  code
) {
  return trades
    .filter(
      (trade) =>
        trade.journalAccount ===
        "SWING"
    )
    .flatMap(
      (trade) =>
        trade?.realBroker?.contracts ||
        []
    )
    .filter(
      (contract) =>
        contract.status === "OPEN" &&
        contract.futuresContractCode ===
          code
    );
}

async function createSeparateCampaign({
  id,
  price,
  time,
}) {
  /*
   * Create a campaign normally in isolation, capture it, then clear the
   * temp Journal. This lets the test seed the exact historical condition
   * production currently contains: multiple OPEN campaigns with identical
   * account/root/expiration/direction.
   */
  writeTrades([]);

  const out =
    await ingestRealBrokerFill(
      fill({
        id,
        contractCode:
          "MESU26",
        effect:
          "OPENING",
        side:
          "SELL",
        qty:
          1,
        price,
        time,
      })
    );

  assert.equal(
    out.ok,
    true
  );

  return out.trade;
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

test("one Schwab close qty 2 FIFO-closes across two matching SWING MESU26 campaigns", async () => {
  const older =
    await createSeparateCampaign({
      id:
        "OPEN-OLDER",
      price:
        7601.75,
      time:
        "2026-09-10T12:42:10.000Z",
    });

  const newer =
    await createSeparateCampaign({
      id:
        "OPEN-NEWER",
      price:
        7617.50,
      time:
        "2026-09-10T15:37:34.000Z",
    });

  /*
   * Give the newer campaign a second contract while it is isolated.
   */
  writeTrades([
    newer,
  ]);

  const scale =
    await ingestRealBrokerFill(
      fill({
        id:
          "OPEN-NEWER-2",
        contractCode:
          "MESU26",
        effect:
          "OPENING",
        side:
          "SELL",
        qty:
          1,
        price:
          7617.50,
        time:
          "2026-09-10T15:37:35.000Z",
      })
    );

  assert.equal(
    scale.ok,
    true
  );

  const newerWithTwo =
    scale.trade;

  /*
   * Seed production-like split campaigns:
   *   older: 1 open @ 7601.75
   *   newer: 2 open @ 7617.50
   */
  writeTrades([
    newerWithTwo,
    older,
  ]);

  const close =
    await ingestRealBrokerFill(
      fill({
        id:
          "CLOSE-QTY-2",
        contractCode:
          "MESU26",
        effect:
          "CLOSING",
        side:
          "BUY",
        qty:
          2,
        price:
          7605,
        time:
          "2026-09-14T14:30:14.000Z",
        totalFees:
          5.20,
      })
    );

  assert.equal(
    close.ok,
    true
  );

  assert.equal(
    close.duplicate,
    false
  );

  assert.equal(
    close.eventType,
    "REAL_MULTI_CAMPAIGN_EXIT"
  );

  assert.equal(
    close.tradeIds.length,
    2
  );

  assert.equal(
    close.closedContracts.length,
    2
  );

  assert.equal(
    new Set(
      close.closedContracts.map(
        (contract) =>
          contract.contractId
      )
    ).size,
    2
  );

  assert.deepEqual(
    close.closedContracts.map(
      (contract) =>
        contract.entryPrice
    ),
    [
      7601.75,
      7617.5,
    ]
  );

  assert.ok(
    close.closedContracts.every(
      (contract) =>
        contract.futuresContractCode ===
        "MESU26" &&
        contract.closingBrokerTransactionId ===
        "CLOSE-QTY-2"
    )
  );

  assert.equal(
    close.remainingQty,
    1
  );

  assert.equal(
    close.allocatedFees.totalFees,
    5.2
  );

  const after =
    await listTrades({
      accountMode:
        "REAL",
    });

  assert.equal(
    openContracts(
      after.trades,
      "MESU26"
    ).length,
    1
  );

  assert.equal(
    openContracts(
      after.trades,
      "MESU26"
    )[0].entryPrice,
    7617.5
  );

  const allEvents =
    after.trades.flatMap(
      (trade) =>
        trade.events || []
    );

  const closeEvents =
    allEvents.filter(
      (event) =>
        event.brokerTransactionId ===
          "CLOSE-QTY-2" &&
        Array.isArray(
          event.closedContracts
        ) &&
        event.closedContracts.length > 0
    );

  assert.equal(
    closeEvents.length,
    2
  );

  assert.equal(
    closeEvents.reduce(
      (sum, event) =>
        sum +
        Number(
          event.totalFees || 0
        ),
      0
    ),
    5.2
  );
});

test("multi-campaign FIFO never crosses MESU26 into MESZ26", async () => {
  writeTrades([]);

  const uOlder =
    await createSeparateCampaign({
      id:
        "U-OLDER",
      price:
        7600,
      time:
        "2026-09-10T12:00:00.000Z",
    });

  writeTrades([]);

  const zOpen =
    await ingestRealBrokerFill(
      fill({
        id:
          "Z-OPEN",
        contractCode:
          "MESZ26",
        effect:
          "OPENING",
        side:
          "SELL",
        qty:
          1,
        price:
          7700,
        time:
          "2026-09-10T12:30:00.000Z",
      })
    );

  assert.equal(
    zOpen.ok,
    true
  );

  const zTrade =
    zOpen.trade;

  writeTrades([]);

  const uNewer =
    await createSeparateCampaign({
      id:
        "U-NEWER",
      price:
        7610,
      time:
        "2026-09-10T13:00:00.000Z",
    });

  writeTrades([
    uNewer,
    zTrade,
    uOlder,
  ]);

  const close =
    await ingestRealBrokerFill(
      fill({
        id:
          "U-CLOSE-2",
        contractCode:
          "MESU26",
        effect:
          "CLOSING",
        side:
          "BUY",
        qty:
          2,
        price:
          7590,
        time:
          "2026-09-14T15:00:00.000Z",
      })
    );

  assert.equal(
    close.ok,
    true
  );

  assert.equal(
    close.closedContracts.length,
    2
  );

  assert.ok(
    close.closedContracts.every(
      (contract) =>
        contract.futuresContractCode ===
        "MESU26"
    )
  );

  const after =
    await listTrades({
      accountMode:
        "REAL",
    });

  assert.equal(
    openContracts(
      after.trades,
      "MESU26"
    ).length,
    0
  );

  assert.equal(
    openContracts(
      after.trades,
      "MESZ26"
    ).length,
    1
  );
});

test("aggregate close rejects only when total matching inventory is insufficient", async () => {
  const one =
    await createSeparateCampaign({
      id:
        "ONLY-ONE",
      price:
        7600,
      time:
        "2026-09-10T12:00:00.000Z",
    });

  writeTrades([
    one,
  ]);

  const close =
    await ingestRealBrokerFill(
      fill({
        id:
          "TOO-MUCH",
        contractCode:
          "MESU26",
        effect:
          "CLOSING",
        side:
          "BUY",
        qty:
          2,
        price:
          7590,
        time:
          "2026-09-14T15:00:00.000Z",
      })
    );

  assert.equal(
    close.ok,
    false
  );

  /*
   * With one campaign the legacy single-campaign protection is retained.
   */
  assert.equal(
    close.error,
    "REAL_EXIT_QUANTITY_EXCEEDS_REMAINING_QUANTITY"
  );
});
