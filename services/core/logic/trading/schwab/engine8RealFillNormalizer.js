// services/core/logic/trading/schwab/engine8RealFillNormalizer.js
// Engine 8 — read-only Schwab REAL futures fill normalization.
//
// Input: one Schwab TRADE transaction plus the safe masked account number.
// Output: one normalized REAL broker fill for Engine 10.
//
// This file never places, modifies, cancels, or replaces broker orders.

const ACCOUNT_MAP = Object.freeze({
  "6380": Object.freeze({
    brokerAccountLabel: "SCHWAB_6380",
    journalAccount: "INTRADAY",
  }),
  "0747": Object.freeze({
    brokerAccountLabel: "SCHWAB_0747",
    journalAccount: "SWING",
  }),
});

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function accountLast4(maskedAccountNumber) {
  const digits = text(maskedAccountNumber).replace(/\D/g, "");
  return digits.slice(-4);
}

export function resolveSchwabJournalAccount(maskedAccountNumber) {
  const last4 = accountLast4(maskedAccountNumber);
  const mapped = ACCOUNT_MAP[last4] || null;

  if (!mapped) {
    return {
      ok: false,
      reason: "UNMAPPED_SCHWAB_REAL_ACCOUNT",
      maskedAccountNumber: text(maskedAccountNumber) || null,
    };
  }

  return {
    ok: true,
    last4,
    ...mapped,
  };
}

export function normalizeSchwabFutureSide({
  positionEffect,
  signedAmount,
} = {}) {
  const effect = upper(positionEffect);
  const amount = numberOrNull(signedAmount);

  if (effect !== "OPENING" && effect !== "CLOSING") {
    return {
      ok: false,
      reason: "INVALID_SCHWAB_POSITION_EFFECT",
    };
  }

  if (amount === null || amount === 0) {
    return {
      ok: false,
      reason: "INVALID_SCHWAB_SIGNED_FUTURE_AMOUNT",
    };
  }

  if (effect === "OPENING" && amount > 0) {
    return {
      ok: true,
      positionEffect: effect,
      side: "BUY",
      direction: "LONG",
      quantity: Math.abs(amount),
    };
  }

  if (effect === "OPENING" && amount < 0) {
    return {
      ok: true,
      positionEffect: effect,
      side: "SELL",
      direction: "SHORT",
      quantity: Math.abs(amount),
    };
  }

  if (effect === "CLOSING" && amount < 0) {
    return {
      ok: true,
      positionEffect: effect,
      side: "SELL",
      direction: "LONG",
      quantity: Math.abs(amount),
    };
  }

  return {
    ok: true,
    positionEffect: effect,
    side: "BUY",
    direction: "SHORT",
    quantity: Math.abs(amount),
  };
}

function normalizeFeeBreakdown(transferItems) {
  const fees = [];

  for (const item of transferItems) {
    const feeType = upper(item?.feeType);
    if (!feeType) continue;

    const amount = numberOrNull(item?.amount);
    const cost = numberOrNull(item?.cost);
    const normalizedAmount = Math.abs(
      amount ?? cost ?? 0
    );

    if (normalizedAmount <= 0) continue;

    fees.push({
      feeType,
      amount: round2(normalizedAmount),
      cost: cost === null ? null : round2(cost),
    });
  }

  return fees;
}

function sumFeesByType(fees, feeType) {
  return round2(
    fees
      .filter((fee) => fee.feeType === feeType)
      .reduce((sum, fee) => sum + fee.amount, 0)
  );
}

export function normalizeSchwabRealFutureTransaction({
  transaction,
  maskedAccountNumber,
  observedAt = new Date().toISOString(),
} = {}) {
  const account = resolveSchwabJournalAccount(maskedAccountNumber);

  if (!account.ok) {
    return {
      ok: false,
      reason: account.reason,
      brokerTransactionId:
        text(transaction?.activityId || transaction?.transactionId || transaction?.id) || null,
    };
  }

  const brokerTransactionId =
    text(transaction?.activityId || transaction?.transactionId || transaction?.id) || null;

  if (!brokerTransactionId) {
    return {
      ok: false,
      reason: "MISSING_SCHWAB_BROKER_TRANSACTION_ID",
    };
  }

  if (upper(transaction?.type) !== "TRADE") {
    return {
      ok: false,
      reason: "SCHWAB_TRANSACTION_NOT_TRADE",
      brokerTransactionId,
    };
  }

  if (upper(transaction?.status) !== "VALID") {
    return {
      ok: false,
      reason: "SCHWAB_TRADE_TRANSACTION_NOT_VALID",
      brokerTransactionId,
    };
  }

  const transferItems = Array.isArray(transaction?.transferItems)
    ? transaction.transferItems
    : [];

  const futureItems = transferItems.filter(
    (item) => upper(item?.instrument?.assetType) === "FUTURE"
  );

  if (futureItems.length === 0) {
    return {
      ok: false,
      skipped: true,
      reason: "SCHWAB_TRADE_HAS_NO_FUTURE_TRANSFER_ITEM",
      brokerTransactionId,
    };
  }

  if (futureItems.length !== 1) {
    return {
      ok: false,
      reason: "MULTIPLE_FUTURE_TRANSFER_ITEMS_UNSUPPORTED",
      brokerTransactionId,
      futureTransferItemCount: futureItems.length,
    };
  }

  const futureItem = futureItems[0];
  const signedBrokerAmount = numberOrNull(futureItem?.amount);
  const side = normalizeSchwabFutureSide({
    positionEffect: futureItem?.positionEffect,
    signedAmount: signedBrokerAmount,
  });

  if (!side.ok) {
    return {
      ok: false,
      reason: side.reason,
      brokerTransactionId,
    };
  }

  const symbol = text(futureItem?.instrument?.symbol);
  const fillPrice = numberOrNull(futureItem?.price);
  const fillTime = text(transaction?.time || transaction?.tradeDate);

  if (!symbol) {
    return {
      ok: false,
      reason: "MISSING_SCHWAB_FUTURE_SYMBOL",
      brokerTransactionId,
    };
  }

  if (fillPrice === null || fillPrice <= 0) {
    return {
      ok: false,
      reason: "INVALID_SCHWAB_FUTURE_FILL_PRICE",
      brokerTransactionId,
    };
  }

  if (!fillTime || !Number.isFinite(Date.parse(fillTime))) {
    return {
      ok: false,
      reason: "INVALID_SCHWAB_FUTURE_FILL_TIME",
      brokerTransactionId,
    };
  }

  const feeBreakdown = normalizeFeeBreakdown(transferItems);
  const commission = sumFeesByType(feeBreakdown, "COMMISSION");
  const futuresExchangeFee = sumFeesByType(
    feeBreakdown,
    "FUTURES_EXCHANGE_FEE"
  );
  const otherFeeBreakdown = feeBreakdown.filter(
    (fee) =>
      fee.feeType !== "COMMISSION" &&
      fee.feeType !== "FUTURES_EXCHANGE_FEE"
  );
  const otherFees = round2(
    otherFeeBreakdown.reduce((sum, fee) => sum + fee.amount, 0)
  );
  const totalFees = round2(
    commission + futuresExchangeFee + otherFees
  );

  const normalized = {
    contractVersion: "engine8.schwabRealFill.v1",
    source: "SCHWAB_BROKER_FILL",
    broker: "SCHWAB",
    accountMode: "REAL",

    brokerAccountLabel: account.brokerAccountLabel,
    journalAccount: account.journalAccount,

    brokerTransactionId,
    brokerOrderId: text(transaction?.orderId) || null,

    brokerStatus: "VALID",
    eventType: "TRADE",

    symbol,
    assetType: "FUTURE",

    positionEffect: side.positionEffect,
    side: side.side,
    direction: side.direction,
    quantity: side.quantity,
    signedBrokerAmount,

    fillPrice,
    fillTime,

    commission,
    futuresExchangeFee,
    otherFees,
    otherFeeBreakdown,
    totalFees,

    paper: false,
    readOnlyBrokerObservation: true,
    observedAt,
  };

  return {
    ok: true,
    fill: normalized,
    dedupeKey:
      `SCHWAB|${normalized.journalAccount}|${normalized.brokerTransactionId}`,
  };
}

export default {
  resolveSchwabJournalAccount,
  normalizeSchwabFutureSide,
  normalizeSchwabRealFutureTransaction,
};

