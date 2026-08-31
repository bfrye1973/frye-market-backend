// services/core/logic/trading/schwab/engine8RealFillObserver.js
// Engine 8 — additive READ-ONLY Schwab TRADE observer for REAL futures fills.
//
// Broker authority boundary:
// - Schwab access in this module is GET-only.
// - This module never places, changes, cancels, or replaces an order.
// - REAL fills never pass through the Engine 8 PAPER executor.
//
// Journal boundary:
// - one Schwab activityId -> one normalized Engine 10 delivery
// - Engine 10 owns tradeId, contractId, FIFO, and contract lifecycle
// - delivery is marked complete only after Engine 10 acknowledgement
//
// Restart boundary:
// - normal polling uses the short rolling lookback
// - first run after process start may use durable recovery watermark + overlap
// - pre-bootstrap transactions are never automatically delivered

import {
  getSchwabAccountNumbers,
  schwabApiRequest,
} from "./schwabClient.js";
import { getSchwabConfig } from "./schwabConfig.js";
import {
  normalizeSchwabRealFutureTransaction,
  resolveSchwabJournalAccount,
} from "./engine8RealFillNormalizer.js";
import {
  getEngine8RealFillAccountWatermark,
  getEngine8RealFillBootstrapStartedAt,
  getEngine8RealFillRecord,
  updateEngine8RealFillAccountWatermark,
  upsertEngine8RealFillRecord,
} from "./engine8RealFillStore.js";

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = text(process.env[name]).toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function validDateMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function journalBaseUrl(explicitBaseUrl) {
  const base = text(
    explicitBaseUrl ||
      process.env.ENGINE8_REAL_JOURNAL_BASE_URL ||
      process.env.CORE_BASE
  );

  return base ? base.replace(/\/+$/, "") : null;
}

function transactionPath(accountHash, startDate, endDate) {
  return (
    `/accounts/${encodeURIComponent(accountHash)}/transactions` +
    `?startDate=${encodeURIComponent(startDate)}` +
    `&endDate=${encodeURIComponent(endDate)}` +
    `&types=TRADE`
  );
}

async function fetchTradeTransactions({
  accountHash,
  startDate,
  endDate,
}) {
  const response = await schwabApiRequest(
    transactionPath(accountHash, startDate, endDate),
    {
      method: "GET",
      operation: "SCHWAB_REAL_FILL_OBSERVER_READ_FAILED",
    }
  );

  return Array.isArray(response.body) ? response.body : [];
}

async function deliverToEngine10({
  fill,
  baseUrl,
  adminSecret,
}) {
  const response = await fetch(
    `${baseUrl}/api/v1/trade-journal/real-fill`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Engine8-Admin-Secret": adminSecret,
      },
      body: JSON.stringify(fill),
      signal: AbortSignal.timeout(20_000),
    }
  );

  const raw = await response.text();
  let body = null;

  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw ? { rawText: raw.slice(0, 1000) } : null;
  }

  return {
    httpOk: response.ok,
    httpStatus: response.status,
    body,
  };
}

function isEngine10Acknowledgement(fill, delivery) {
  return Boolean(
    delivery?.httpOk === true &&
      delivery?.body?.ok === true &&
      delivery?.body?.journalCompleted === true &&
      text(delivery?.body?.brokerTransactionId) ===
        text(fill?.brokerTransactionId) &&
      text(delivery?.body?.tradeId)
  );
}

function summarizeFill(fill) {
  return {
    brokerAccountLabel: fill.brokerAccountLabel,
    journalAccount: fill.journalAccount,
    brokerTransactionId: fill.brokerTransactionId,
    brokerOrderId: fill.brokerOrderId,
    symbol: fill.symbol,
    positionEffect: fill.positionEffect,
    side: fill.side,
    direction: fill.direction,
    quantity: fill.quantity,
    fillPrice: fill.fillPrice,
    fillTime: fill.fillTime,
    commission: fill.commission,
    futuresExchangeFee: fill.futuresExchangeFee,
    otherFees: fill.otherFees,
    totalFees: fill.totalFees,
  };
}

export function computeEngine8RealFillQueryStart({
  deliveryEnabled,
  recoveryMode,
  bootstrapStartedAt,
  lastBrokerFillTimeSeen,
  now,
  lookbackMinutes,
  recoveryOverlapMinutes,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);

  if (!Number.isFinite(nowMs)) {
    throw new Error("ENGINE8_REAL_FILL_QUERY_NOW_INVALID");
  }

  const lookback = positiveInt(lookbackMinutes, 15);
  const overlap = positiveInt(recoveryOverlapMinutes, 5);
  const rollingStartMs = nowMs - lookback * 60_000;

  if (!deliveryEnabled) {
    return new Date(rollingStartMs).toISOString();
  }

  const bootstrapMs = validDateMs(bootstrapStartedAt);

  if (bootstrapMs === null) {
    throw new Error("ENGINE8_REAL_FILL_BOOTSTRAP_NOT_INITIALIZED");
  }

  if (!recoveryMode) {
    return new Date(Math.max(bootstrapMs, rollingStartMs)).toISOString();
  }

  const lastFillMs = validDateMs(lastBrokerFillTimeSeen);

  if (lastFillMs === null) {
    return new Date(bootstrapMs).toISOString();
  }

  return new Date(
    Math.max(
      bootstrapMs,
      lastFillMs - overlap * 60_000
    )
  ).toISOString();
}

function latestFillForAccount(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const leftTime = Date.parse(left.fill.fillTime);
    const rightTime = Date.parse(right.fill.fillTime);

    if (leftTime !== rightTime) return rightTime - leftTime;

    return text(right.fill.brokerTransactionId).localeCompare(
      text(left.fill.brokerTransactionId)
    );
  })[0];
}

export async function observeSchwabRealFills({
  lookbackMinutes = null,
  recoveryOverlapMinutes = null,
  recoveryMode = false,
  deliver = null,
  engine10BaseUrl = null,
  now = new Date(),
} = {}) {
  const config = getSchwabConfig();
  const resolvedLookbackMinutes = positiveInt(
    lookbackMinutes ?? process.env.ENGINE8_REAL_FILL_LOOKBACK_MINUTES,
    15
  );
  const resolvedRecoveryOverlapMinutes = positiveInt(
    recoveryOverlapMinutes ??
      process.env.ENGINE8_REAL_FILL_RECOVERY_OVERLAP_MINUTES,
    5
  );
  const deliveryEnabled =
    deliver === null
      ? boolEnv("ENGINE8_REAL_FILL_DELIVERY_ENABLED", false)
      : deliver === true;

  const endDate = now.toISOString();
  const bootstrapStartedAt =
    getEngine8RealFillBootstrapStartedAt();

  const result = {
    active: true,
    engine: "engine8.schwabRealFillObserver.v2",
    contractVersion: "engine8.schwabRealFillObserver.v2",
    mode: deliveryEnabled
      ? recoveryMode
        ? "READ_ONLY_BROKER_RECOVERY_WITH_ENGINE10_DELIVERY"
        : "READ_ONLY_BROKER_OBSERVER_WITH_ENGINE10_DELIVERY"
      : "READ_ONLY_BROKER_OBSERVER_DRY_RUN",
    broker: "SCHWAB",
    accountMode: "REAL",
    readOnlyBrokerObservation: true,
    brokerWritesAllowed: false,
    paperExecutionUsed: false,
    contractIdsCreated: false,
    deliveryEnabled,
    recoveryMode: recoveryMode === true,
    lookbackMinutes: resolvedLookbackMinutes,
    recoveryOverlapMinutes: resolvedRecoveryOverlapMinutes,
    bootstrapStartedAt,
    endDate,
    accountsRead: 0,
    transactionsRead: 0,
    futuresFillsNormalized: 0,
    alreadyDelivered: 0,
    delivered: 0,
    pending: 0,
    skipped: 0,
    normalizationErrors: 0,
    accountErrors: 0,
    watermarkAdvanced: 0,
    watermarkHeld: 0,
    accountWindows: [],
    fills: [],
    errors: [],
    evaluatedAt: nowIso(),
  };

  let baseUrl = null;

  if (deliveryEnabled) {
    if (!bootstrapStartedAt) {
      return {
        ...result,
        ok: false,
        status: "BLOCKED_ENGINE8_REAL_FILL_BOOTSTRAP_NOT_INITIALIZED",
        errors: ["ENGINE8_REAL_FILL_BOOTSTRAP_NOT_INITIALIZED"],
      };
    }

    baseUrl = journalBaseUrl(engine10BaseUrl);

    if (!baseUrl) {
      return {
        ...result,
        ok: false,
        status: "BLOCKED_ENGINE10_BASE_URL_MISSING",
        errors: ["ENGINE8_REAL_JOURNAL_BASE_URL_OR_CORE_BASE_REQUIRED"],
      };
    }

    if (!config.adminSecret) {
      return {
        ...result,
        ok: false,
        status: "BLOCKED_ENGINE8_ADMIN_SECRET_MISSING",
        errors: [
          "ENGINE8_ADMIN_SECRET_REQUIRED_FOR_ENGINE10_REAL_FILL_ROUTE",
        ],
      };
    }
  }

  let accountsResult;

  try {
    accountsResult = await getSchwabAccountNumbers();
  } catch (error) {
    return {
      ...result,
      ok: false,
      status: "SCHWAB_ACCOUNT_DISCOVERY_FAILED",
      errors: [String(error?.message || error)],
    };
  }

  const candidates = [];
  const accountRuns = new Map();

  for (const account of accountsResult.accounts || []) {
    if (!account?.accountHash || !account?.maskedAccountNumber) {
      result.skipped += 1;
      continue;
    }

    const accountIdentity = resolveSchwabJournalAccount(
      account.maskedAccountNumber
    );

    if (!accountIdentity.ok) {
      result.accountErrors += 1;
      result.errors.push({
        account: account.maskedAccountNumber,
        error: accountIdentity.reason,
      });
      continue;
    }

    const brokerAccountLabel =
      accountIdentity.brokerAccountLabel;
    const existingWatermark =
      getEngine8RealFillAccountWatermark(brokerAccountLabel);

    let startDate;

    try {
      startDate = computeEngine8RealFillQueryStart({
        deliveryEnabled,
        recoveryMode,
        bootstrapStartedAt,
        lastBrokerFillTimeSeen:
          existingWatermark?.lastBrokerFillTimeSeen || null,
        now,
        lookbackMinutes: resolvedLookbackMinutes,
        recoveryOverlapMinutes:
          resolvedRecoveryOverlapMinutes,
      });
    } catch (error) {
      result.accountErrors += 1;
      result.errors.push({
        account: account.maskedAccountNumber,
        error: String(error?.message || error),
      });
      continue;
    }

    const accountRun = {
      brokerAccountLabel,
      journalAccount: accountIdentity.journalAccount,
      startDate,
      endDate,
      existingWatermark,
      candidates: [],
      failed: false,
    };

    accountRuns.set(brokerAccountLabel, accountRun);
    result.accountWindows.push({
      brokerAccountLabel,
      journalAccount: accountIdentity.journalAccount,
      startDate,
      endDate,
      recoveryMode: recoveryMode === true,
    });

    let transactions;

    try {
      transactions = await fetchTradeTransactions({
        accountHash: account.accountHash,
        startDate,
        endDate,
      });
      result.accountsRead += 1;
      result.transactionsRead += transactions.length;
    } catch (error) {
      accountRun.failed = true;
      result.accountErrors += 1;
      result.errors.push({
        account: account.maskedAccountNumber,
        error: String(error?.message || error),
      });
      continue;
    }

    for (const transaction of transactions) {
      const normalized = normalizeSchwabRealFutureTransaction({
        transaction,
        maskedAccountNumber: account.maskedAccountNumber,
        observedAt: nowIso(),
      });

      if (!normalized.ok) {
        if (normalized.skipped) {
          result.skipped += 1;
        } else {
          accountRun.failed = true;
          result.normalizationErrors += 1;
          result.errors.push({
            account: account.maskedAccountNumber,
            brokerTransactionId:
              normalized.brokerTransactionId || null,
            error: normalized.reason,
          });
        }
        continue;
      }

      accountRun.candidates.push(normalized);
      candidates.push(normalized);
    }
  }

  candidates.sort((left, right) => {
    const leftTime = Date.parse(left.fill.fillTime);
    const rightTime = Date.parse(right.fill.fillTime);

    if (leftTime !== rightTime) return leftTime - rightTime;

    return text(left.fill.brokerTransactionId).localeCompare(
      text(right.fill.brokerTransactionId)
    );
  });

  for (const candidate of candidates) {
    const { fill, dedupeKey } = candidate;
    const accountRun = accountRuns.get(fill.brokerAccountLabel);
    result.futuresFillsNormalized += 1;

    const existing = getEngine8RealFillRecord(dedupeKey);

    if (existing?.delivered === true) {
      result.alreadyDelivered += 1;
      result.fills.push({
        ...summarizeFill(fill),
        deliveryStatus: "ALREADY_DELIVERED",
        tradeId: existing.engine10TradeId || null,
      });
      continue;
    }

    upsertEngine8RealFillRecord(dedupeKey, {
      broker: "SCHWAB",
      journalAccount: fill.journalAccount,
      brokerAccountLabel: fill.brokerAccountLabel,
      brokerTransactionId: fill.brokerTransactionId,
      brokerOrderId: fill.brokerOrderId,
      fillTime: fill.fillTime,
      normalizedFill: fill,
      delivered: false,
      deliveryStatus: deliveryEnabled
        ? "PENDING_ENGINE10"
        : "DRY_RUN_ONLY",
    });

    if (!deliveryEnabled) {
      result.pending += 1;
      result.fills.push({
        ...summarizeFill(fill),
        deliveryStatus: "DRY_RUN_ONLY",
      });
      continue;
    }

    let delivery;

    try {
      delivery = await deliverToEngine10({
        fill,
        baseUrl,
        adminSecret: config.adminSecret,
      });
    } catch (error) {
      if (accountRun) accountRun.failed = true;
      result.pending += 1;
      upsertEngine8RealFillRecord(dedupeKey, {
        delivered: false,
        deliveryStatus: "ENGINE10_DELIVERY_FAILED",
        attemptCount: Number(existing?.attemptCount || 0) + 1,
        lastAttemptAt: nowIso(),
        lastError: String(error?.message || error),
      });
      result.fills.push({
        ...summarizeFill(fill),
        deliveryStatus: "ENGINE10_DELIVERY_FAILED",
        error: String(error?.message || error),
      });
      continue;
    }

    if (isEngine10Acknowledgement(fill, delivery)) {
      result.delivered += 1;
      upsertEngine8RealFillRecord(dedupeKey, {
        delivered: true,
        deliveryStatus: "ENGINE10_ACKNOWLEDGED",
        attemptCount: Number(existing?.attemptCount || 0) + 1,
        lastAttemptAt: nowIso(),
        deliveredAt: nowIso(),
        engine10TradeId: text(delivery.body.tradeId),
        engine10Status: text(delivery.body.status) || null,
        engine10RemainingQty:
          Number.isFinite(Number(delivery.body.remainingQty))
            ? Number(delivery.body.remainingQty)
            : null,
        engine10Duplicate: delivery.body.duplicate === true,
        engine10EventType:
          text(delivery.body.eventType) || null,
        lastError: null,
      });
      result.fills.push({
        ...summarizeFill(fill),
        deliveryStatus: "ENGINE10_ACKNOWLEDGED",
        tradeId: delivery.body.tradeId,
        engine10Status: delivery.body.status || null,
        remainingQty: delivery.body.remainingQty ?? null,
        duplicate: delivery.body.duplicate === true,
      });
    } else {
      if (accountRun) accountRun.failed = true;
      result.pending += 1;
      upsertEngine8RealFillRecord(dedupeKey, {
        delivered: false,
        deliveryStatus: "ENGINE10_NOT_ACKNOWLEDGED",
        attemptCount: Number(existing?.attemptCount || 0) + 1,
        lastAttemptAt: nowIso(),
        engine10HttpStatus: delivery.httpStatus,
        lastError:
          text(delivery?.body?.error || delivery?.body?.reason) ||
          `ENGINE10_HTTP_${delivery.httpStatus}`,
      });
      result.fills.push({
        ...summarizeFill(fill),
        deliveryStatus: "ENGINE10_NOT_ACKNOWLEDGED",
        httpStatus: delivery.httpStatus,
        engine10Error:
          delivery?.body?.error || delivery?.body?.reason || null,
      });
    }
  }

  if (deliveryEnabled) {
    for (const accountRun of accountRuns.values()) {
      if (accountRun.failed) {
        result.watermarkHeld += 1;
        continue;
      }

      const latest = latestFillForAccount(accountRun.candidates);

      updateEngine8RealFillAccountWatermark(
        accountRun.brokerAccountLabel,
        {
          brokerAccountLabel:
            accountRun.brokerAccountLabel,
          journalAccount:
            accountRun.journalAccount,
          lastSuccessfulPollAt: endDate,
          ...(latest
            ? {
                lastBrokerFillTimeSeen:
                  latest.fill.fillTime,
                lastBrokerTransactionIdSeen:
                  latest.fill.brokerTransactionId,
              }
            : {}),
        }
      );

      result.watermarkAdvanced += 1;
    }
  }

  return {
    ...result,
    ok:
      result.accountErrors === 0 &&
      result.pending === 0,
    status:
      result.accountErrors > 0
        ? "COMPLETED_WITH_ACCOUNT_ERRORS"
        : result.pending > 0
          ? "COMPLETED_WITH_PENDING_ENGINE10_DELIVERIES"
          : deliveryEnabled
            ? recoveryMode
              ? "REAL_FILL_RECOVERY_COMPLETE"
              : "REAL_FILL_OBSERVER_DELIVERY_COMPLETE"
            : "REAL_FILL_OBSERVER_DRY_RUN_COMPLETE",
    evaluatedAt: nowIso(),
  };
}

export default {
  computeEngine8RealFillQueryStart,
  observeSchwabRealFills,
};
