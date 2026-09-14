// services/core/logic/trading/schwab/engine8RealFillNormalizer.js
// Engine 8 — read-only Schwab REAL futures fill normalization.
//
// Legacy API:
// - normalizeSchwabRealFutureTransaction()
// - preserves the existing one-transaction -> one-fill contract
// - preserves the legacy dedupe key for single-leg transactions
//
// Leg-aware API:
// - normalizeSchwabRealFutureTransactionLegs()
// - expands every legitimate FUTURE transfer item under one Schwab activityId
// - preserves the real parent brokerTransactionId on every leg
// - creates deterministic brokerFillLegId / brokerFillIdentity
// - orders CLOSING legs before OPENING legs
// - allocates parent broker fees across legs exactly
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

const FUTURES_MONTHS = Object.freeze({
  F: "JAN",
  G: "FEB",
  H: "MAR",
  J: "APR",
  K: "MAY",
  M: "JUN",
  N: "JUL",
  Q: "AUG",
  U: "SEP",
  V: "OCT",
  X: "NOV",
  Z: "DEC",
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

function canonicalNumber(value) {
  const parsed = numberOrNull(value);
  return parsed === null ? "" : String(parsed);
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

function parseFuturesContractIdentity(symbol) {
  const brokerSymbol = text(symbol);
  const match = brokerSymbol.match(
    /^\/([A-Z]+)([FGHJKMNQUVXZ])(\d{2})(?::.*)?$/i
  );

  if (!match) {
    return {
      brokerSymbol: brokerSymbol || null,
      normalizedInstrumentRoot: null,
      futuresContractCode: null,
      contractMonthCode: null,
      contractMonth: null,
      contractYear: null,
    };
  }

  const root = upper(match[1]);
  const monthCode = upper(match[2]);
  const year2 = match[3];

  return {
    brokerSymbol,
    normalizedInstrumentRoot: root,
    futuresContractCode: `${root}${monthCode}${year2}`,
    contractMonthCode: monthCode,
    contractMonth: FUTURES_MONTHS[monthCode] || null,
    contractYear: 2000 + Number(year2),
  };
}

function allocateUnsignedMoney(total, weights) {
  const cents = Math.round(Math.abs(Number(total) || 0) * 100);

  if (weights.length === 0) return [];

  const normalizedWeights = weights.map((value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  });

  const totalWeight = normalizedWeights.reduce(
    (sum, value) => sum + value,
    0
  );

  if (totalWeight <= 0) {
    const out = Array(weights.length).fill(0);
    out[0] = cents;
    return out.map((value) => value / 100);
  }

  const allocatedCents = normalizedWeights.map((weight) =>
    Math.floor((cents * weight) / totalWeight)
  );

  let remainder =
    cents - allocatedCents.reduce((sum, value) => sum + value, 0);

  // Locked rule: rounding remainder goes to earliest canonical leg.
  let index = 0;
  while (remainder > 0) {
    allocatedCents[index] += 1;
    remainder -= 1;
    index = (index + 1) % allocatedCents.length;
  }

  return allocatedCents.map((value) => value / 100);
}

function allocateSignedMoney(total, weights) {
  const number = Number(total);

  if (!Number.isFinite(number)) {
    return Array(weights.length).fill(null);
  }

  const sign = number < 0 ? -1 : 1;

  return allocateUnsignedMoney(Math.abs(number), weights).map(
    (value) => round2(value * sign)
  );
}

function semanticLegBase({
  positionEffect,
  direction,
  side,
  brokerSymbol,
  quantity,
  fillPrice,
}) {
  return [
    upper(positionEffect),
    upper(direction),
    upper(side),
    upper(brokerSymbol),
    canonicalNumber(quantity),
    canonicalNumber(fillPrice),
  ].join("|");
}

function canonicalLegSort(left, right) {
  const leftRank =
    left.side.positionEffect === "CLOSING" ? 0 : 1;
  const rightRank =
    right.side.positionEffect === "CLOSING" ? 0 : 1;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const semanticCompare =
    left.semanticBase.localeCompare(right.semanticBase);

  if (semanticCompare !== 0) {
    return semanticCompare;
  }

  // Identical semantic legs are intentionally interchangeable.
  // Source index is used only to make this one in-memory sort stable;
  // durable identity is OCC<n> within the identical semantic group.
  return left.sourceIndex - right.sourceIndex;
}

function validateTransactionEnvelope({
  transaction,
  maskedAccountNumber,
}) {
  const account = resolveSchwabJournalAccount(maskedAccountNumber);

  if (!account.ok) {
    return {
      ok: false,
      reason: account.reason,
      brokerTransactionId:
        text(
          transaction?.activityId ||
            transaction?.transactionId ||
            transaction?.id
        ) || null,
    };
  }

  const brokerTransactionId =
    text(
      transaction?.activityId ||
        transaction?.transactionId ||
        transaction?.id
    ) || null;

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

  const fillTime = text(
    transaction?.time || transaction?.tradeDate
  );

  if (!fillTime || !Number.isFinite(Date.parse(fillTime))) {
    return {
      ok: false,
      reason: "INVALID_SCHWAB_FUTURE_FILL_TIME",
      brokerTransactionId,
    };
  }

  return {
    ok: true,
    account,
    brokerTransactionId,
    transferItems,
    futureItems,
    fillTime,
  };
}

/**
 * Leg-aware normalizer.
 *
 * Returns:
 * {
 *   ok: true,
 *   brokerTransactionId,
 *   candidates: [
 *     { fill, dedupeKey }
 *   ]
 * }
 *
 * All candidates preserve the same real Schwab brokerTransactionId.
 */
export function normalizeSchwabRealFutureTransactionLegs({
  transaction,
  maskedAccountNumber,
  observedAt = new Date().toISOString(),
} = {}) {
  const envelope = validateTransactionEnvelope({
    transaction,
    maskedAccountNumber,
  });

  if (!envelope.ok) {
    return envelope;
  }

  const {
    account,
    brokerTransactionId,
    transferItems,
    futureItems,
    fillTime,
  } = envelope;

  const preliminaryLegs = [];

  for (let sourceIndex = 0; sourceIndex < futureItems.length; sourceIndex += 1) {
    const futureItem = futureItems[sourceIndex];
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
        futureTransferItemIndex: sourceIndex,
      };
    }

    const symbol = text(futureItem?.instrument?.symbol);
    const fillPrice = numberOrNull(futureItem?.price);

    if (!symbol) {
      return {
        ok: false,
        reason: "MISSING_SCHWAB_FUTURE_SYMBOL",
        brokerTransactionId,
        futureTransferItemIndex: sourceIndex,
      };
    }

    if (fillPrice === null || fillPrice <= 0) {
      return {
        ok: false,
        reason: "INVALID_SCHWAB_FUTURE_FILL_PRICE",
        brokerTransactionId,
        futureTransferItemIndex: sourceIndex,
      };
    }

    const contractIdentity =
      parseFuturesContractIdentity(symbol);

    preliminaryLegs.push({
      sourceIndex,
      futureItem,
      signedBrokerAmount,
      side,
      symbol,
      fillPrice,
      contractIdentity,
      semanticBase: semanticLegBase({
        positionEffect: side.positionEffect,
        direction: side.direction,
        side: side.side,
        brokerSymbol: symbol,
        quantity: side.quantity,
        fillPrice,
      }),
    });
  }

  preliminaryLegs.sort(canonicalLegSort);

  const occurrenceBySemanticBase = new Map();

  for (const leg of preliminaryLegs) {
    const nextOccurrence =
      (occurrenceBySemanticBase.get(leg.semanticBase) || 0) + 1;

    occurrenceBySemanticBase.set(
      leg.semanticBase,
      nextOccurrence
    );

    leg.brokerFillLegId =
      `${leg.semanticBase}|OCC${nextOccurrence}`;

    leg.brokerFillIdentity =
      `SCHWAB|${account.journalAccount}|` +
      `${brokerTransactionId}|${leg.brokerFillLegId}`;
  }

  const feeBreakdown = normalizeFeeBreakdown(transferItems);

  const parentCommission =
    sumFeesByType(feeBreakdown, "COMMISSION");

  const parentFuturesExchangeFee =
    sumFeesByType(
      feeBreakdown,
      "FUTURES_EXCHANGE_FEE"
    );

  const parentOtherFeeBreakdown =
    feeBreakdown.filter(
      (fee) =>
        fee.feeType !== "COMMISSION" &&
        fee.feeType !== "FUTURES_EXCHANGE_FEE"
    );

  const parentOtherFees =
    round2(
      parentOtherFeeBreakdown.reduce(
        (sum, fee) => sum + fee.amount,
        0
      )
    );

  const weights =
    preliminaryLegs.map(
      (leg) => leg.side.quantity
    );

  const commissionByLeg =
    allocateUnsignedMoney(
      parentCommission,
      weights
    );

  const futuresExchangeFeeByLeg =
    allocateUnsignedMoney(
      parentFuturesExchangeFee,
      weights
    );

  const otherFeeAllocations =
    parentOtherFeeBreakdown.map((fee) => ({
      fee,
      amountByLeg:
        allocateUnsignedMoney(
          fee.amount,
          weights
        ),
      costByLeg:
        fee.cost === null
          ? Array(weights.length).fill(null)
          : allocateSignedMoney(
              fee.cost,
              weights
            ),
    }));

  const candidates = preliminaryLegs.map(
    (leg, index) => {
      const otherFeeBreakdown =
        otherFeeAllocations
          .map(({ fee, amountByLeg, costByLeg }) => ({
            feeType: fee.feeType,
            amount: round2(amountByLeg[index]),
            cost:
              costByLeg[index] === null
                ? null
                : round2(costByLeg[index]),
          }))
          .filter((fee) => fee.amount > 0);

      const otherFees =
        round2(
          otherFeeBreakdown.reduce(
            (sum, fee) => sum + fee.amount,
            0
          )
        );

      const commission =
        round2(commissionByLeg[index]);

      const futuresExchangeFee =
        round2(
          futuresExchangeFeeByLeg[index]
        );

      const totalFees =
        round2(
          commission +
            futuresExchangeFee +
            otherFees
        );

      const normalized = {
        contractVersion:
          "engine8.schwabRealFill.v2",
        source: "SCHWAB_BROKER_FILL",
        broker: "SCHWAB",
        accountMode: "REAL",

        brokerAccountLabel:
          account.brokerAccountLabel,
        journalAccount:
          account.journalAccount,

        brokerTransactionId,
        brokerFillLegId:
          leg.brokerFillLegId,
        brokerFillIdentity:
          leg.brokerFillIdentity,
        brokerOrderId:
          text(transaction?.orderId) || null,

        brokerStatus: "VALID",
        eventType: "TRADE",

        symbol: leg.symbol,
        brokerSymbol:
          leg.contractIdentity.brokerSymbol,
        normalizedInstrumentRoot:
          leg.contractIdentity.normalizedInstrumentRoot,
        futuresContractCode:
          leg.contractIdentity.futuresContractCode,
        contractMonthCode:
          leg.contractIdentity.contractMonthCode,
        contractMonth:
          leg.contractIdentity.contractMonth,
        contractYear:
          leg.contractIdentity.contractYear,

        assetType: "FUTURE",

        positionEffect:
          leg.side.positionEffect,
        side:
          leg.side.side,
        direction:
          leg.side.direction,
        quantity:
          leg.side.quantity,
        signedBrokerAmount:
          leg.signedBrokerAmount,

        fillPrice:
          leg.fillPrice,
        fillTime,

        commission,
        futuresExchangeFee,
        otherFees,
        otherFeeBreakdown,
        totalFees,

        parentBrokerFees: {
          commission:
            parentCommission,
          futuresExchangeFee:
            parentFuturesExchangeFee,
          otherFees:
            parentOtherFees,
          totalFees:
            round2(
              parentCommission +
                parentFuturesExchangeFee +
                parentOtherFees
            ),
        },

        paper: false,
        readOnlyBrokerObservation: true,
        observedAt,
      };

      return {
        fill: normalized,
        dedupeKey:
          normalized.brokerFillIdentity,
      };
    }
  );

  return {
    ok: true,
    brokerTransactionId,
    brokerOrderId:
      text(transaction?.orderId) || null,
    futureTransferItemCount:
      futureItems.length,
    candidates,
  };
}

/**
 * Legacy one-fill normalizer.
 *
 * IMPORTANT:
 * - single-leg behavior and dedupe key remain unchanged
 * - multi-leg transactions remain blocked here until the observer is
 *   explicitly upgraded to consume normalizeSchwabRealFutureTransactionLegs()
 *
 * This prevents historical single-leg fills from being reclassified as
 * leg-aware fills before the observer/store migration is complete.
 */
export function normalizeSchwabRealFutureTransaction({
  transaction,
  maskedAccountNumber,
  observedAt = new Date().toISOString(),
} = {}) {
  const envelope = validateTransactionEnvelope({
    transaction,
    maskedAccountNumber,
  });

  if (!envelope.ok) {
    return envelope;
  }

  const {
    account,
    brokerTransactionId,
    transferItems,
    futureItems,
    fillTime,
  } = envelope;

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

  const symbol = text(
    futureItem?.instrument?.symbol
  );

  const fillPrice =
    numberOrNull(futureItem?.price);

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

  const feeBreakdown =
    normalizeFeeBreakdown(transferItems);

  const commission =
    sumFeesByType(
      feeBreakdown,
      "COMMISSION"
    );

  const futuresExchangeFee =
    sumFeesByType(
      feeBreakdown,
      "FUTURES_EXCHANGE_FEE"
    );

  const otherFeeBreakdown =
    feeBreakdown.filter(
      (fee) =>
        fee.feeType !== "COMMISSION" &&
        fee.feeType !==
          "FUTURES_EXCHANGE_FEE"
    );

  const otherFees =
    round2(
      otherFeeBreakdown.reduce(
        (sum, fee) => sum + fee.amount,
        0
      )
    );

  const totalFees =
    round2(
      commission +
        futuresExchangeFee +
        otherFees
    );

  const normalized = {
    contractVersion:
      "engine8.schwabRealFill.v1",
    source:
      "SCHWAB_BROKER_FILL",
    broker:
      "SCHWAB",
    accountMode:
      "REAL",

    brokerAccountLabel:
      account.brokerAccountLabel,
    journalAccount:
      account.journalAccount,

    brokerTransactionId,
    brokerOrderId:
      text(transaction?.orderId) || null,

    brokerStatus:
      "VALID",
    eventType:
      "TRADE",

    symbol,
    assetType:
      "FUTURE",

    positionEffect:
      side.positionEffect,
    side:
      side.side,
    direction:
      side.direction,
    quantity:
      side.quantity,
    signedBrokerAmount,

    fillPrice,
    fillTime,

    commission,
    futuresExchangeFee,
    otherFees,
    otherFeeBreakdown,
    totalFees,

    paper:
      false,
    readOnlyBrokerObservation:
      true,
    observedAt,
  };

  return {
    ok: true,
    fill: normalized,

    // Preserve exact legacy Engine 8 observer key.
    dedupeKey:
      `SCHWAB|${normalized.journalAccount}|` +
      `${normalized.brokerTransactionId}`,
  };
}

export default {
  resolveSchwabJournalAccount,
  normalizeSchwabFutureSide,
  normalizeSchwabRealFutureTransaction,
  normalizeSchwabRealFutureTransactionLegs,
};
