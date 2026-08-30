// services/core/tests/engine8RealSchwabObserver.test.js
// Read-only unit proof for Engine 8 Schwab REAL futures normalization.

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSchwabFutureSide,
  normalizeSchwabRealFutureTransaction,
  resolveSchwabJournalAccount,
} from "../logic/trading/schwab/engine8RealFillNormalizer.js";

function tx({
  activityId = 129430040346,
  orderId = 1007761957176,
  positionEffect,
  amount,
  price = 7724.75,
  time = "2026-08-28T20:57:04+0000",
}) {
  return {
    activityId,
    orderId,
    type: "TRADE",
    status: "VALID",
    time,
    transferItems: [
      {
        instrument: {
          assetType: "CURRENCY",
          symbol: "CURRENCY_USD",
        },
        amount: 2.25,
        cost: -2.25,
        feeType: "COMMISSION",
      },
      {
        instrument: {
          assetType: "CURRENCY",
          symbol: "CURRENCY_USD",
        },
        amount: 0.35,
        cost: -0.35,
        feeType: "FUTURES_EXCHANGE_FEE",
      },
      {
        instrument: {
          assetType: "FUTURE",
          symbol: "/MESU26:XCME",
        },
        amount,
        price,
        cost: -38623.75,
        positionEffect,
      },
    ],
  };
}

test("frozen four-way Schwab futures side/direction mapping", () => {
  assert.deepEqual(
    normalizeSchwabFutureSide({ positionEffect: "OPENING", signedAmount: 1 }),
    { ok: true, positionEffect: "OPENING", side: "BUY", direction: "LONG", quantity: 1 }
  );
  assert.deepEqual(
    normalizeSchwabFutureSide({ positionEffect: "OPENING", signedAmount: -2 }),
    { ok: true, positionEffect: "OPENING", side: "SELL", direction: "SHORT", quantity: 2 }
  );
  assert.deepEqual(
    normalizeSchwabFutureSide({ positionEffect: "CLOSING", signedAmount: -1 }),
    { ok: true, positionEffect: "CLOSING", side: "SELL", direction: "LONG", quantity: 1 }
  );
  assert.deepEqual(
    normalizeSchwabFutureSide({ positionEffect: "CLOSING", signedAmount: 2 }),
    { ok: true, positionEffect: "CLOSING", side: "BUY", direction: "SHORT", quantity: 2 }
  );
});

test("frozen Schwab account mapping", () => {
  assert.equal(resolveSchwabJournalAccount("****6380").journalAccount, "INTRADAY");
  assert.equal(resolveSchwabJournalAccount("****0747").journalAccount, "SWING");
});

test("normalizes actual-style Schwab short closing fill and fees", () => {
  const out = normalizeSchwabRealFutureTransaction({
    transaction: tx({ positionEffect: "CLOSING", amount: 1 }),
    maskedAccountNumber: "****0747",
    observedAt: "2026-08-30T15:00:00.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.dedupeKey, "SCHWAB|SWING|129430040346");
  assert.equal(out.fill.brokerAccountLabel, "SCHWAB_0747");
  assert.equal(out.fill.journalAccount, "SWING");
  assert.equal(out.fill.positionEffect, "CLOSING");
  assert.equal(out.fill.side, "BUY");
  assert.equal(out.fill.direction, "SHORT");
  assert.equal(out.fill.quantity, 1);
  assert.equal(out.fill.signedBrokerAmount, 1);
  assert.equal(out.fill.fillPrice, 7724.75);
  assert.equal(out.fill.commission, 2.25);
  assert.equal(out.fill.futuresExchangeFee, 0.35);
  assert.equal(out.fill.totalFees, 2.6);
  assert.equal(out.fill.paper, false);
  assert.equal(out.fill.readOnlyBrokerObservation, true);
});

test("normalizes long opening fill for INTRADAY account", () => {
  const out = normalizeSchwabRealFutureTransaction({
    transaction: tx({
      activityId: 129430040347,
      positionEffect: "OPENING",
      amount: 2,
      price: 7710.25,
    }),
    maskedAccountNumber: "****6380",
  });

  assert.equal(out.ok, true);
  assert.equal(out.fill.journalAccount, "INTRADAY");
  assert.equal(out.fill.side, "BUY");
  assert.equal(out.fill.direction, "LONG");
  assert.equal(out.fill.quantity, 2);
});
