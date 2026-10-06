// services/core/logic/trading/runEngine8PaperLifecycleExecution.js
//
// Controlled canonical Engine 8 REDUCE / EXIT gateway.
//
// Responsibilities:
// - accept only REDUCE and EXIT lifecycle actions
// - resolve the existing Engine 10 opening trade
// - preserve opening lifecycle identity
// - create unique management execution/order identities
// - reuse those identities for an idempotent retry
// - call executeTradeTicket() exactly once per logical management event
// - persist JOURNAL_RESOLVED or JOURNAL_PENDING state
// - reconcile Engine 10 without resubmitting the paper order
// - activate the acceptance lock only after final EXIT acknowledgement:
//
//     journalCompleted === true
//     Engine 10 status === CLOSED
//     remainingQty === 0
//     tradeId is present
//
// This gateway must never create a second opening Journal trade.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

import {
  executeTradeTicket,
} from "./engine8Paper.js";

import {
  getTradeById,
  listTrades,
  applyEngine8ExecutionToJournal,
} from "../journal/tradeJournalStore.js";

import {
  markEngine8AcceptanceTradeCompleted,
} from "./engine8AcceptanceState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(
  __dirname,
  "../../data"
);

const LIFECYCLE_STATE_FILE = path.resolve(
  DATA_DIR,
  "engine8-paper-lifecycle-state.json"
);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function positiveInteger(value) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

function clone(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true,
    });
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDataDir();

  const tempFile = `${file}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(value, null, 2)
  );

  fs.renameSync(tempFile, file);
}

function defaultLifecycleStore() {
  return {
    engine:
      "engine8.paperLifecycleState.v1",

    contractVersion:
      "engine8.paperLifecycleState.v1",

    records: {},

    updatedAt:
      null,
  };
}

function readLifecycleStore() {
  const stored = readJson(
    LIFECYCLE_STATE_FILE,
    {}
  );

  const records =
    stored &&
    typeof stored.records === "object" &&
    stored.records !== null &&
    !Array.isArray(stored.records)
      ? stored.records
      : {};

  return {
    ...defaultLifecycleStore(),
    ...(stored &&
    typeof stored === "object" &&
    !Array.isArray(stored)
      ? stored
      : {}),
    records,
  };
}

function writeLifecycleStore(store) {
  writeJsonAtomic(
    LIFECYCLE_STATE_FILE,
    {
      ...store,
      updatedAt: nowIso(),
    }
  );
}

function getLifecycleRecord(
  lifecycleKey
) {
  const store =
    readLifecycleStore();

  return (
    store.records?.[lifecycleKey] ||
    null
  );
}

function saveLifecycleRecord(
  lifecycleKey,
  record
) {
  const store =
    readLifecycleStore();

  store.records[lifecycleKey] = {
    ...record,
    lifecycleKey,
    updatedAt: nowIso(),
  };

  writeLifecycleStore(store);

  return store.records[lifecycleKey];
}

function makeExecutionId(action) {
  return [
    "E8M",
    action,
    Date.now(),
    crypto
      .randomBytes(4)
      .toString("hex"),
  ].join("-");
}

function makeOrderId(action) {
  return [
    "E8O",
    "MGMT",
    action,
    Date.now(),
    crypto
      .randomBytes(4)
      .toString("hex"),
  ].join("-");
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(
      String(value),
      "utf8"
    )
    .digest("hex")
    .slice(0, 24);
}

function makeLifecycleKey({
  tradeId,
  action,
  lifecycleEventId,
}) {
  return [
    text(tradeId),
    upper(action),
    text(lifecycleEventId),
  ].join("|");
}

function makeLifecycleIdempotencyKey({
  tradeId,
  action,
  lifecycleEventId,
}) {
  const source =
    makeLifecycleKey({
      tradeId,
      action,
      lifecycleEventId,
    });

  return (
    `ENGINE8:PAPER:LIFECYCLE:` +
    stableHash(source)
  );
}

function reject({
  status,
  reason,
  action = null,
  lifecycleEventId = null,
  tradeId = null,
  record = null,
}) {
  return {
    active: true,

    engine:
      "engine8.paperLifecycleGateway.v1",

    contractVersion:
      "engine8.paperLifecycleGateway.v1",

    mode:
      "CONTROLLED_PAPER_LIFECYCLE_EXECUTION",

    status,

    ok: false,
    rejected: true,

    reason,

    action:
      action || null,

    lifecycleEventId:
      lifecycleEventId || null,

    executionId:
      record?.executionId || null,

    idempotencyKey:
      record?.idempotencyKey || null,

    orderId:
      record?.orderId || null,

    tradeId:
      tradeId ||
      record?.tradeId ||
      null,

    orderCreated:
      record?.orderCreated === true,

    fillCreated:
      record?.fillCreated === true,

    journalCompleted:
      record?.journalCompleted === true,

    journalPending:
      record?.journalPending === true,

    acceptanceLockActivated:
      record?.acceptanceLockActivated ===
      true,

    noBrokerOrder: true,
    noSchwabCall: true,

    record:
      record || null,

    evaluatedAt:
      nowIso(),
  };
}

function validateEnvironment({
  source,
}) {
  if (
    process.env
      .ENGINE8_CANONICAL_EXECUTOR_ENABLED !==
    "1"
  ) {
    return {
      ok: false,
      status:
        "REJECTED_CANONICAL_EXECUTOR_DISABLED",
      reason:
        "ENGINE8_CANONICAL_EXECUTOR_ENABLED_NOT_SET",
    };
  }

  if (
    process.env
      .ENGINE8_PAPER_ONLY !==
    "1"
  ) {
    return {
      ok: false,
      status:
        "REJECTED_PAPER_MODE_DISABLED",
      reason:
        "ENGINE8_PAPER_ONLY_NOT_SET",
    };
  }

  if (
    process.env
      .ENGINE8_KILL_SWITCH ===
    "1"
  ) {
    return {
      ok: false,
      status:
        "REJECTED_KILL_SWITCH_ACTIVE",
      reason:
        "ENGINE8_KILL_SWITCH",
    };
  }

  if (
    process.env
      .ENGINE8_LIVE_TRADING_ENABLED ===
      "1" ||
    process.env
      .ENGINE8_ALLOW_LIVE_FUTURES ===
      "1"
  ) {
    return {
      ok: false,
      status:
        "REJECTED_LIVE_EXECUTION_FLAGS_PRESENT",
      reason:
        "LIVE_EXECUTION_NOT_ALLOWED",
    };
  }

  if (
    process.env.REPLAY_MODE === "1" ||
    process.env
      .ENGINE12_REPLAY_MODE ===
      "1"
  ) {
    return {
      ok: false,
      status:
        "REJECTED_REPLAY_MODE_ACTIVE",
      reason:
        "REPLAY_EXECUTION_FORBIDDEN",
    };
  }

  if (
    upper(source) !==
    "CANONICAL_PAPER_LIFECYCLE_ROUTE"
  ) {
    return {
      ok: false,
      status:
        "REJECTED_INVALID_EXECUTION_SOURCE",
      reason:
        "UNAPPROVED_ENGINE8_LIFECYCLE_CALLER",
    };
  }

  return {
    ok: true,
  };
}

function tradeIdentity(trade) {
  return {
    tradeId:
      text(trade?.tradeId) || null,

    planId:
      text(
        trade?.identity?.planId ||
        trade?.setup?.planId
      ) || null,

    candidateId:
      text(
        trade?.identity?.candidateId ||
        trade?.setup?.candidateId
      ) || null,

    zoneId:
      text(
        trade?.identity?.zoneId ||
        trade?.setup?.zoneId
      ) || null,

    strategyId:
      text(
        trade?.identity?.strategyId ||
        trade?.strategyId
      ) || null,

    symbol:
      upper(
        trade?.identity?.symbol ||
        trade?.symbol
      ) || null,

    direction:
      upper(
        trade?.identity?.direction ||
        trade?.direction
      ) || null,

    setupType:
      text(
        trade?.identity?.setupType ||
        trade?.setupType ||
        trade?.setup?.setupType
      ) || null,

    snapshotTime:
      text(
        trade?.identity?.snapshotTime ||
        trade?.setup?.snapshotTime
      ) || null,
  };
}

function identityMismatch(
  supplied,
  authoritative
) {
  const mismatches = [];

  const compare = (
    field,
    normalize = text
  ) => {
    const left =
      normalize(supplied?.[field]);

    const right =
      normalize(authoritative?.[field]);

    if (
      left &&
      right &&
      left !== right
    ) {
      mismatches.push({
        field,
        supplied:
          supplied[field],
        authoritative:
          authoritative[field],
      });
    }
  };

  compare("planId");
  compare("candidateId");
  compare("zoneId");
  compare("strategyId");
  compare("symbol", upper);
  compare("direction", upper);
  compare("setupType");

  return mismatches;
}

async function resolveOpeningTrade({
  tradeId,
  planId,
  candidateId,
  strategyId,
  symbol,
  direction,
}) {
  const normalizedTradeId =
    text(tradeId);

  if (normalizedTradeId) {
    const byId =
      await getTradeById(
        normalizedTradeId
      );

    if (
      byId?.ok === true &&
      byId?.trade
    ) {
      return {
        ok: true,
        trade:
          byId.trade,
        resolution:
          "TRADE_ID",
      };
    }

    return {
      ok: false,
      reason:
        "OPENING_TRADE_ID_NOT_FOUND",
    };
  }

  const listed =
    await listTrades({
      strategyId:
        text(strategyId) || undefined,

      symbol:
        upper(symbol) || undefined,

      status:
        "OPEN",

      accountMode:
        "PAPER",
    });

  const candidates =
    Array.isArray(listed?.trades)
      ? listed.trades.filter(
          (trade) => {
            const identity =
              tradeIdentity(trade);

            if (
              candidateId &&
              identity.candidateId !==
                text(candidateId)
            ) {
              return false;
            }

            if (
              planId &&
              identity.planId !==
                text(planId)
            ) {
              return false;
            }

            if (
              direction &&
              identity.direction !==
                upper(direction)
            ) {
              return false;
            }

            return true;
          }
        )
      : [];

  if (candidates.length === 0) {
    return {
      ok: false,
      reason:
        "OPEN_TRADE_NOT_FOUND",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      reason:
        "OPEN_TRADE_RESOLUTION_AMBIGUOUS",
      candidateTradeIds:
        candidates.map(
          (trade) => trade.tradeId
        ),
    };
  }

  return {
    ok: true,
    trade:
      candidates[0],
    resolution:
      candidateId
        ? "CANDIDATE_ID"
        : planId
          ? "PLAN_ID"
          : "OPEN_STRATEGY_TRADE",
  };
}

function buildManagementTicket({
  record,
  trade,
  request,
}) {
  const identity =
    tradeIdentity(trade);

  const action =
    upper(record.action);

  const direction =
    identity.direction;

  const side =
    direction === "LONG"
      ? "SELL"
      : direction === "SHORT"
        ? "BUY"
        : null;

  const fillPrice =
    numberOrNull(
      request.fillPrice
    );

  const remainingBefore =
    numberOrNull(
      trade?.qty?.remainingQty
    );

  const fillQuantity =
    positiveInteger(
      request.fillQuantity
    );

  const calculatedRemaining =
    remainingBefore !== null &&
    fillQuantity !== null
      ? Math.max(
          0,
          remainingBefore -
            fillQuantity
        )
      : null;

  const reportedRemaining =
    numberOrNull(
      request.remainingQuantity
    );

  const remainingQuantity =
    reportedRemaining !== null
      ? reportedRemaining
      : calculatedRemaining;

  return {
    executionId:
      record.executionId,

    idempotencyKey:
      record.idempotencyKey,

    orderId:
      record.orderId,

    tradeId:
      identity.tradeId,

    planId:
      identity.planId,

    candidateId:
      identity.candidateId,

    zoneId:
      identity.zoneId,

    strategyId:
      identity.strategyId,

    symbol:
      identity.symbol,

    direction:
      identity.direction,

    setupType:
      identity.setupType,

    snapshotTime:
      identity.snapshotTime,

    paper: true,

    assetType:
      upper(
        trade?.assetType ||
        request.assetType ||
        "FUTURES"
      ),

    timeframe:
      text(
        trade?.timeframe ||
        request.timeframe
      ),

    action,

    intent:
      action,

    side,

    qty:
      fillQuantity,

    fillQuantity,

    remainingQuantity,

    orderType:
      upper(
        request.orderType ||
        "MARKET"
      ),

    timeInForce:
      upper(
        request.timeInForce ||
        "DAY"
      ),

    // engine8Paper currently derives FUTURES avgPrice
    // from entry.price for both opening and management fills.
    entry: {
      price:
        fillPrice,
    },

    targetId:
      text(request.targetId) ||
      null,

    blockId:
      text(request.blockId) ||
      null,

    managementAction:
      text(
        request.managementAction
      ) || null,

    exitReason:
      upper(
        request.exitReason
      ) || null,

    stopReason:
      text(request.stopReason) ||
      null,

    sourceSignal: {
      engine:
        "engine8",

      eventSource:
        "CANONICAL_PAPER_LIFECYCLE",

      lifecycleEventId:
        record.lifecycleEventId,

      tradeId:
        identity.tradeId,

      planId:
        identity.planId,

      candidateId:
        identity.candidateId,

      zoneId:
        identity.zoneId,

      strategyId:
        identity.strategyId,

      symbol:
        identity.symbol,

      direction:
        identity.direction,

      setupType:
        identity.setupType,

      snapshotTime:
        identity.snapshotTime,
    },

    engine6: {
      permission:
        text(
          request?.engine6
            ?.permission
        ) || "ALLOW",

      decision:
        request?.engine6
          ?.decision || null,
    },
  };
}

function buildJournalOrder({
  ticket,
  executionResult,
}) {
  return {
    orderId:
      executionResult?.orderId ||
      ticket.orderId,

    idempotencyKey:
      ticket.idempotencyKey,

    executionId:
      ticket.executionId,

    tradeId:
      ticket.tradeId,

    planId:
      ticket.planId,

    candidateId:
      ticket.candidateId,

    zoneId:
      ticket.zoneId,

    strategyId:
      ticket.strategyId,

    symbol:
      ticket.symbol,

    direction:
      ticket.direction,

    setupType:
      ticket.setupType,

    snapshotTime:
      ticket.snapshotTime,

    paper: true,

    assetType:
      ticket.assetType,

    timeframe:
      ticket.timeframe,

    action:
      ticket.action,

    side:
      ticket.side,

    orderType:
      ticket.orderType,

    timeInForce:
      ticket.timeInForce,

    qty:
      ticket.qty,

    filledQty:
      executionResult?.filledQty ??
      ticket.fillQuantity,

    avgPrice:
      executionResult?.avgPrice ??
      ticket.entry?.price ??
      null,

    filledAt:
      executionResult?.filledAt ||
      nowIso(),

    status:
      executionResult?.status ||
      "filled",

    remainingQuantity:
      ticket.remainingQuantity,

    targetId:
      ticket.targetId,

    blockId:
      ticket.blockId,

    managementAction:
      ticket.managementAction,

    exitReason:
      ticket.exitReason,

    stopReason:
      ticket.stopReason,

    sourceSignal:
      ticket.sourceSignal,
  };
}

function resolveExecutionPayload(
  lowLevelResult
) {
  if (
    lowLevelResult?.duplicate === true &&
    lowLevelResult?.result
  ) {
    return {
      duplicate: true,
      result:
        lowLevelResult.result,
    };
  }

  return {
    duplicate: false,
    result:
      lowLevelResult,
  };
}

function resolveJournalState(
  executionResult
) {
  const journal =
    executionResult?.journal ||
    null;

  const tradeId =
    text(
      executionResult?.tradeId ||
      journal?.tradeId
    ) || null;

  const status =
    upper(
      journal?.status
    ) || null;

  const remainingQty =
    numberOrNull(
      journal?.remainingQty
    );

  const journalCompleted =
    journal?.journalCompleted ===
      true ||
    (
      journal?.ok === true &&
      Boolean(tradeId)
    );

  return {
    journal,

    tradeId,

    status,

    remainingQty,

    journalCompleted,

    journalPending:
      executionResult?.ok === true &&
      journalCompleted !== true,
  };
}

function buildPublicResult(record) {
  return {
    active: true,

    engine:
      "engine8.paperLifecycleGateway.v1",

    contractVersion:
      "engine8.paperLifecycleGateway.v1",

    mode:
      "CONTROLLED_PAPER_LIFECYCLE_EXECUTION",

    status:
      record.status,

    ok:
      record.ok === true,

    rejected:
      record.rejected === true,

    duplicate:
      record.duplicate === true,

    lifecycleEventId:
      record.lifecycleEventId,

    action:
      record.action,

    executionId:
      record.executionId,

    idempotencyKey:
      record.idempotencyKey,

    orderId:
      record.orderId,

    tradeId:
      record.tradeId,

    planId:
      record.planId,

    candidateId:
      record.candidateId,

    zoneId:
      record.zoneId,

    strategyId:
      record.strategyId,

    symbol:
      record.symbol,

    direction:
      record.direction,

    setupType:
      record.setupType,

    snapshotTime:
      record.snapshotTime,

    fillQuantity:
      record.fillQuantity,

    fillPrice:
      record.fillPrice,

    orderCreated:
      record.orderCreated === true,

    fillCreated:
      record.fillCreated === true,

    journalStatus:
      record.journalStatus,

    journalCompleted:
      record.journalCompleted === true,

    journalPending:
      record.journalPending === true,

    engine10Status:
      record.engine10Status,

    remainingQty:
      record.remainingQty,

    acceptanceTradeCompleted:
      record.acceptanceTradeCompleted ===
      true,

    acceptanceLockActivated:
      record.acceptanceLockActivated ===
      true,

    noBrokerOrder: true,
    noSchwabCall: true,

    record:
      clone(record),

    evaluatedAt:
      nowIso(),
  };
}

export async function runEngine8PaperLifecycleExecution({
  action,
  lifecycleEventId,
  tradeId,
  planId,
  candidateId,
  zoneId,
  strategyId,
  symbol,
  direction,
  setupType,
  fillQuantity,
  fillPrice,
  remainingQuantity = null,
  targetId = null,
  blockId = null,
  managementAction = null,
  exitReason = null,
  stopReason = null,
  orderType = "MARKET",
  timeInForce = "DAY",
  engine6 = null,
  source = "UNKNOWN",
} = {}) {
  const normalizedAction =
    upper(action);

  const normalizedLifecycleEventId =
    text(lifecycleEventId);

  const environment =
    validateEnvironment({
      source,
    });

  if (!environment.ok) {
    return reject({
      status:
        environment.status,

      reason:
        environment.reason,

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId,
    });
  }

  if (
    normalizedAction !== "REDUCE" &&
    normalizedAction !== "EXIT"
  ) {
    return reject({
      status:
        "REJECTED_INVALID_LIFECYCLE_ACTION",

      reason:
        "ONLY_REDUCE_OR_EXIT_ALLOWED",

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId,
    });
  }

  if (!normalizedLifecycleEventId) {
    return reject({
      status:
        "REJECTED_MISSING_LIFECYCLE_EVENT_ID",

      reason:
        "LIFECYCLE_EVENT_ID_REQUIRED_FOR_STABLE_RETRY",

      action:
        normalizedAction,

      tradeId,
    });
  }

  const normalizedFillQuantity =
    positiveInteger(
      fillQuantity
    );

  const normalizedFillPrice =
    numberOrNull(
      fillPrice
    );

  if (!normalizedFillQuantity) {
    return reject({
      status:
        "REJECTED_INVALID_FILL_QUANTITY",

      reason:
        "POSITIVE_INTEGER_FILL_QUANTITY_REQUIRED",

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId,
    });
  }

  if (
    normalizedFillPrice === null ||
    normalizedFillPrice <= 0
  ) {
    return reject({
      status:
        "REJECTED_INVALID_FILL_PRICE",

      reason:
        "POSITIVE_FILL_PRICE_REQUIRED",

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId,
    });
  }

  const resolved =
    await resolveOpeningTrade({
      tradeId,
      planId,
      candidateId,
      strategyId,
      symbol,
      direction,
    });

  if (!resolved.ok) {
    return reject({
      status:
        "REJECTED_OPENING_TRADE_NOT_RESOLVED",

      reason:
        resolved.reason,

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId,
    });
  }

  const trade =
    resolved.trade;

  if (
    upper(trade?.status) !== "OPEN"
  ) {
    return reject({
      status:
        "REJECTED_TRADE_NOT_OPEN",

      reason:
        `TRADE_STATUS_${upper(
          trade?.status ||
          "UNKNOWN"
        )}`,

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId:
        trade?.tradeId,
    });
  }

  const authoritativeIdentity =
    tradeIdentity(trade);

  const mismatches =
    identityMismatch(
      {
        planId,
        candidateId,
        zoneId,
        strategyId,
        symbol,
        direction,
        setupType,
      },
      authoritativeIdentity
    );

  if (mismatches.length > 0) {
    return {
      ...reject({
        status:
          "REJECTED_LIFECYCLE_IDENTITY_MISMATCH",

        reason:
          "SUPPLIED_IDENTITY_DOES_NOT_MATCH_OPENING_TRADE",

        action:
          normalizedAction,

        lifecycleEventId:
          normalizedLifecycleEventId,

        tradeId:
          authoritativeIdentity.tradeId,
      }),

      identityMismatches:
        mismatches,
    };
  }

  const remainingBefore =
    numberOrNull(
      trade?.qty?.remainingQty
    );

  if (
    remainingBefore === null ||
    remainingBefore <= 0
  ) {
    return reject({
      status:
        "REJECTED_NO_REMAINING_POSITION",

      reason:
        "OPEN_TRADE_HAS_NO_REMAINING_QUANTITY",

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId:
        authoritativeIdentity.tradeId,
    });
  }

  if (
    normalizedFillQuantity >
    remainingBefore
  ) {
    return reject({
      status:
        "REJECTED_EXIT_QUANTITY_EXCEEDS_REMAINING",

      reason:
        "FILL_QUANTITY_EXCEEDS_OPEN_POSITION",

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId:
        authoritativeIdentity.tradeId,
    });
  }

  const lifecycleKey =
    makeLifecycleKey({
      tradeId:
        authoritativeIdentity.tradeId,

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,
    });

  const existingRecord =
    getLifecycleRecord(
      lifecycleKey
    );

  if (existingRecord) {
    return {
      ...buildPublicResult({
        ...existingRecord,
        duplicate: true,
      }),

      duplicate: true,

      reason:
        "LIFECYCLE_EVENT_ALREADY_PREPARED_OR_EXECUTED",
    };
  }

  const executionId =
    makeExecutionId(
      normalizedAction
    );

  const orderId =
    makeOrderId(
      normalizedAction
    );

  const idempotencyKey =
    makeLifecycleIdempotencyKey({
      tradeId:
        authoritativeIdentity.tradeId,

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,
    });

  let record =
    saveLifecycleRecord(
      lifecycleKey,
      {
        lifecycleEventId:
          normalizedLifecycleEventId,

        lifecycleKey,

        action:
          normalizedAction,

        executionId,

        idempotencyKey,

        orderId,

        tradeId:
          authoritativeIdentity.tradeId,

        planId:
          authoritativeIdentity.planId,

        candidateId:
          authoritativeIdentity.candidateId,

        zoneId:
          authoritativeIdentity.zoneId,

        strategyId:
          authoritativeIdentity.strategyId,

        symbol:
          authoritativeIdentity.symbol,

        direction:
          authoritativeIdentity.direction,

        setupType:
          authoritativeIdentity.setupType,

        snapshotTime:
          authoritativeIdentity.snapshotTime,

        openingResolution:
          resolved.resolution,

        fillQuantity:
          normalizedFillQuantity,

        fillPrice:
          normalizedFillPrice,

        remainingBefore,

        requestedRemainingQuantity:
          numberOrNull(
            remainingQuantity
          ),

        status:
          "LIFECYCLE_EXECUTION_PREPARED",

        ok: false,
        rejected: false,
        duplicate: false,

        orderCreated: false,
        fillCreated: false,

        journalStatus:
          "NOT_ATTEMPTED",

        journalCompleted:
          false,

        journalPending:
          false,

        engine10Status:
          null,

        remainingQty:
          remainingBefore,

        acceptanceTradeCompleted:
          false,

        acceptanceLockActivated:
          false,

        preparedAt:
          nowIso(),

        executedAt:
          null,

        resolvedAt:
          null,

        journalPayload:
          null,

        lowLevelResult:
          null,

        acceptanceResult:
          null,
      }
    );

  const request = {
    fillQuantity:
      normalizedFillQuantity,

    fillPrice:
      normalizedFillPrice,

    remainingQuantity,

    targetId,
    blockId,
    managementAction,
    exitReason,
    stopReason,
    orderType,
    timeInForce,
    engine6,
  };

  const ticket =
    buildManagementTicket({
      record,
      trade,
      request,
    });

  if (!ticket.side) {
    record =
      saveLifecycleRecord(
        lifecycleKey,
        {
          ...record,

          status:
            "LIFECYCLE_EXECUTION_REJECTED",

          rejected: true,

          reason:
            "OPENING_DIRECTION_INVALID",

          journalStatus:
            "NOT_ATTEMPTED",
        }
      );

    return buildPublicResult(
      record
    );
  }

  let lowLevelResult;

  try {
    lowLevelResult =
      await executeTradeTicket(
        ticket
      );
  } catch (error) {
    record =
      saveLifecycleRecord(
        lifecycleKey,
        {
          ...record,

          status:
            "LIFECYCLE_EXECUTOR_THROWN",

          ok: false,

          rejected: true,

          error:
            "LOW_LEVEL_EXECUTOR_THROWN",

          detail:
            String(
              error?.message ||
              error
            ),

          journalStatus:
            "NOT_ATTEMPTED",
        }
      );

    return buildPublicResult(
      record
    );
  }

  const normalizedExecution =
    resolveExecutionPayload(
      lowLevelResult
    );

  const executionResult =
    normalizedExecution.result ||
    {};

  const filled =
    executionResult?.ok === true &&
    upper(
      executionResult?.status
    ) === "FILLED";

  const journalState =
    resolveJournalState(
      executionResult
    );

  const journalOrder =
    buildJournalOrder({
      ticket,
      executionResult,
    });

  const journalPayload = {
    ticket:
      clone(ticket),

    order:
      clone(journalOrder),

    result:
      clone(executionResult),
  };

  const journalResolved =
    journalState.journalCompleted ===
      true &&
    Boolean(
      journalState.tradeId
    );

  record =
    saveLifecycleRecord(
      lifecycleKey,
      {
        ...record,

        status:
          filled
            ? journalResolved
              ? "LIFECYCLE_FILL_JOURNAL_RESOLVED"
              : "LIFECYCLE_FILL_JOURNAL_PENDING"
            : normalizedExecution.duplicate
              ? "LIFECYCLE_DUPLICATE_RETURNED"
              : "LIFECYCLE_EXECUTION_REJECTED",

        ok:
          executionResult?.ok ===
          true,

        rejected:
          executionResult?.rejected ===
          true,

        duplicate:
          normalizedExecution.duplicate,

        orderCreated:
          filled,

        fillCreated:
          filled,

        orderId:
          executionResult?.orderId ||
          record.orderId,

        tradeId:
          journalState.tradeId ||
          record.tradeId,

        journalStatus:
          journalResolved
            ? "JOURNAL_RESOLVED"
            : filled
              ? "JOURNAL_PENDING"
              : "NOT_RESOLVED",

        journalCompleted:
          journalResolved,

        journalPending:
          filled &&
          !journalResolved,

        engine10Status:
          journalState.status,

        remainingQty:
          journalState.remainingQty,

        executedAt:
          nowIso(),

        resolvedAt:
          journalResolved
            ? nowIso()
            : null,

        journalPayload,

        lowLevelResult:
          clone(lowLevelResult),
      }
    );

  const finalExitAcknowledged =
    normalizedAction === "EXIT" &&
    record.journalCompleted === true &&
    upper(
      record.engine10Status
    ) === "CLOSED" &&
    Number(
      record.remainingQty
    ) === 0 &&
    Boolean(
      text(record.tradeId)
    );

  if (finalExitAcknowledged) {
    const acceptanceResult =
      markEngine8AcceptanceTradeCompleted({
        tradeId:
          record.tradeId,

        executionId:
          record.executionId,

        orderId:
          record.orderId,

        idempotencyKey:
          record.idempotencyKey,

        planId:
          record.planId,

        candidateId:
          record.candidateId,

        strategyId:
          record.strategyId,

        symbol:
          record.symbol,

        action:
          "EXIT",

        engine10Status:
          record.engine10Status,

        remainingQty:
          record.remainingQty,

        journalCompleted:
          true,

        closedAt:
          executionResult?.filledAt ||
          nowIso(),
      });

    record =
      saveLifecycleRecord(
        lifecycleKey,
        {
          ...record,

          acceptanceResult:
            clone(
              acceptanceResult
            ),

          acceptanceTradeCompleted:
            acceptanceResult
              ?.state
              ?.acceptanceTradeCompleted ===
            true,

          acceptanceLockActivated:
            acceptanceResult
              ?.acceptanceLockActivated ===
            true,

          status:
            acceptanceResult?.ok ===
            true
              ? "FINAL_EXIT_ACCEPTANCE_COMPLETED"
              : "FINAL_EXIT_JOURNALED_ACCEPTANCE_LOCK_FAILED",
        }
      );
  }

  return buildPublicResult(
    record
  );
}

/**
 * Retry only Engine 10 Journal synchronization.
 *
 * This function must never call executeTradeTicket().
 * It cannot create another order or another paper fill.
 */
export async function reconcileEngine8PaperLifecycleJournal({
  tradeId,
  action,
  lifecycleEventId,
  source = "UNKNOWN",
} = {}) {
  const normalizedAction =
    upper(action);

  const normalizedLifecycleEventId =
    text(lifecycleEventId);

  const environment =
    validateEnvironment({
      source,
    });

  if (!environment.ok) {
    return reject({
      status:
        environment.status,

      reason:
        environment.reason,

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId,
    });
  }

  if (
    normalizedAction !== "REDUCE" &&
    normalizedAction !== "EXIT"
  ) {
    return reject({
      status:
        "REJECTED_INVALID_LIFECYCLE_ACTION",

      reason:
        "ONLY_REDUCE_OR_EXIT_ALLOWED",

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId,
    });
  }

  const lifecycleKey =
    makeLifecycleKey({
      tradeId,
      action:
        normalizedAction,
      lifecycleEventId:
        normalizedLifecycleEventId,
    });

  let record =
    getLifecycleRecord(
      lifecycleKey
    );

  if (!record) {
    return reject({
      status:
        "REJECTED_LIFECYCLE_RECORD_NOT_FOUND",

      reason:
        "NO_PERSISTED_LIFECYCLE_EVENT_TO_RECONCILE",

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId,
    });
  }

  if (
    record.journalCompleted === true
  ) {
    return {
      ...buildPublicResult({
        ...record,
        duplicate: true,
      }),

      duplicate: true,

      reason:
        "JOURNAL_ALREADY_RESOLVED",
    };
  }

  if (
    record.fillCreated !== true ||
    !record.journalPayload
  ) {
    return reject({
      status:
        "REJECTED_NO_PERSISTED_FILL_FOR_RECONCILIATION",

      reason:
        "JOURNAL_RECONCILIATION_REQUIRES_PERSISTED_FILL",

      action:
        normalizedAction,

      lifecycleEventId:
        normalizedLifecycleEventId,

      tradeId:
        record.tradeId,

      record,
    });
  }

  let journalResult;

  try {
    journalResult =
      await applyEngine8ExecutionToJournal({
        ticket:
          record.journalPayload.ticket,

        order:
          record.journalPayload.order,

        result:
          record.journalPayload.result,
      });
  } catch (error) {
    record =
      saveLifecycleRecord(
        lifecycleKey,
        {
          ...record,

          status:
            "LIFECYCLE_FILL_JOURNAL_PENDING",

          journalStatus:
            "JOURNAL_PENDING",

          journalCompleted:
            false,

          journalPending:
            true,

          reconciliationError:
            String(
              error?.message ||
              error
            ),

          lastReconciliationAt:
            nowIso(),
        }
      );

    return buildPublicResult(
      record
    );
  }

  const resolvedTradeId =
    text(
      journalResult?.tradeId ||
      record.tradeId
    ) || null;

  const resolvedStatus =
    upper(
      journalResult?.status
    ) || null;

  const resolvedRemainingQty =
    numberOrNull(
      journalResult?.remainingQty
    );

  const journalCompleted =
    journalResult?.ok === true &&
    Boolean(
      resolvedTradeId
    );

  record =
    saveLifecycleRecord(
      lifecycleKey,
      {
        ...record,

        status:
          journalCompleted
            ? "LIFECYCLE_FILL_JOURNAL_RESOLVED"
            : "LIFECYCLE_FILL_JOURNAL_PENDING",

        tradeId:
          resolvedTradeId,

        journalStatus:
          journalCompleted
            ? "JOURNAL_RESOLVED"
            : "JOURNAL_PENDING",

        journalCompleted,

        journalPending:
          !journalCompleted,

        engine10Status:
          resolvedStatus,

        remainingQty:
          resolvedRemainingQty,

        resolvedAt:
          journalCompleted
            ? nowIso()
            : null,

        lastReconciliationAt:
          nowIso(),

        journalReconciliationResult:
          clone(
            journalResult
          ),
      }
    );

  const finalExitAcknowledged =
    normalizedAction === "EXIT" &&
    journalCompleted === true &&
    resolvedStatus === "CLOSED" &&
    resolvedRemainingQty === 0 &&
    Boolean(
      resolvedTradeId
    );

  if (finalExitAcknowledged) {
    const acceptanceResult =
      markEngine8AcceptanceTradeCompleted({
        tradeId:
          resolvedTradeId,

        executionId:
          record.executionId,

        orderId:
          record.orderId,

        idempotencyKey:
          record.idempotencyKey,

        planId:
          record.planId,

        candidateId:
          record.candidateId,

        strategyId:
          record.strategyId,

        symbol:
          record.symbol,

        action:
          "EXIT",

        engine10Status:
          resolvedStatus,

        remainingQty:
          resolvedRemainingQty,

        journalCompleted:
          true,

        closedAt:
          nowIso(),
      });

    record =
      saveLifecycleRecord(
        lifecycleKey,
        {
          ...record,

          acceptanceResult:
            clone(
              acceptanceResult
            ),

          acceptanceTradeCompleted:
            acceptanceResult
              ?.state
              ?.acceptanceTradeCompleted ===
            true,

          acceptanceLockActivated:
            acceptanceResult
              ?.acceptanceLockActivated ===
            true,

          status:
            acceptanceResult?.ok ===
            true
              ? "FINAL_EXIT_ACCEPTANCE_COMPLETED"
              : "FINAL_EXIT_JOURNALED_ACCEPTANCE_LOCK_FAILED",
        }
      );
  }

  return buildPublicResult(
    record
  );
}

export function getEngine8PaperLifecycleRecord({
  tradeId,
  action,
  lifecycleEventId,
} = {}) {
  const lifecycleKey =
    makeLifecycleKey({
      tradeId,
      action,
      lifecycleEventId,
    });

  return getLifecycleRecord(
    lifecycleKey
  );
}

export default {
  runEngine8PaperLifecycleExecution,
  reconcileEngine8PaperLifecycleJournal,
  getEngine8PaperLifecycleRecord,
};
