import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

const JOURNAL_DIR =
  process.env.TRADE_JOURNAL_DIR ||
  "/var/data/replay/journal";

const JOURNAL_FILE = path.resolve(
  JOURNAL_DIR,
  "trade-journal.json"
);

const SNAPSHOT_FILE = path.resolve(
  DATA_DIR,
  "strategy-snapshot.json"
);
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOURNAL_DIR)) {
    fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;

    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();

  const tempFile = `${file}.tmp`;

  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, file);
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function firstDefined(...values) {
  return values.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== ""
  );
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  return Math.round(number * 100) / 100;
}

function strategyTimeframe(strategyId, explicitTimeframe) {
  const explicit = String(explicitTimeframe || "").trim();
  if (explicit) return explicit;

  const id = String(strategyId || "").trim();
  return id.split("@")[1] || "";
}

function directionFromSide(side) {
  const normalized = toUpper(side);

  if (
    normalized === "BUY" ||
    normalized === "BUY_TO_OPEN"
  ) {
    return "LONG";
  }

  if (
    normalized === "SELL_SHORT" ||
    normalized === "SELL_TO_OPEN"
  ) {
    return "SHORT";
  }

  return null;
}

function directionFromPayload(ticket, order, result) {
  const direct = toUpper(
    firstDefined(
      order?.direction,
      result?.direction,
      ticket?.direction,
      ticket?.sourceSignal?.direction
    )
  );

  if (direct === "LONG" || direct === "SHORT") {
    return direct;
  }

  const bias = String(ticket?.engine5?.bias || "")
    .trim()
    .toLowerCase();

  if (bias === "long") return "LONG";
  if (bias === "short") return "SHORT";

  return (
    directionFromSide(ticket?.side) ||
    directionFromSide(order?.side) ||
    directionFromSide(result?.side) ||
    "UNKNOWN"
  );
}

function accountModeFromPayload(ticket, order, result) {
  const paper =
    order?.paper === true ||
    result?.paper === true ||
    ticket?.paper !== false;

  return paper ? "PAPER" : "LIVE";
}

function getAction(ticket, order, result) {
  const action = toUpper(
    firstDefined(
      result?.eventType,
      order?.eventType,
      ticket?.eventType,
      result?.action,
      order?.action,
      ticket?.action
    )
  );

  if (action === "ENTRY_FILLED") return "NEW_ENTRY";
  if (action === "PARTIAL_CLOSE") return "REDUCE";
  if (action === "FULL_CLOSE") return "EXIT";

  if (action) return action;

  const side = toUpper(
    firstDefined(
      ticket?.side,
      order?.side,
      result?.side
    )
  );

  const exitLike =
    side.includes("SELL") ||
    side.includes("CLOSE") ||
    side.includes("EXIT");

  return exitLike ? "EXIT" : "NEW_ENTRY";
}

function getFillStatus(ticket, order, result) {
  return toUpper(
    firstDefined(
      result?.fillStatus,
      order?.fillStatus,
      ticket?.fillStatus,
      result?.status,
      order?.status,
      ticket?.status
    )
  );
}

function getEventTime(ticket, order, result) {
  return (
    firstDefined(
      result?.fillTime,
      order?.fillTime,
      ticket?.fillTime,
      result?.filledAt,
      order?.filledAt,
      ticket?.filledAt,
      result?.ts,
      order?.ts,
      ticket?.ts
    ) || nowIso()
  );
}

function getExecutionPrice(ticket, order, result) {
  return (
    toNumberOrNull(result?.fillPrice) ??
    toNumberOrNull(order?.fillPrice) ??
    toNumberOrNull(ticket?.fillPrice) ??
    toNumberOrNull(result?.avgPrice) ??
    toNumberOrNull(order?.avgPrice) ??
    toNumberOrNull(ticket?.avgPrice) ??
    toNumberOrNull(result?.option?.midPrice) ??
    toNumberOrNull(order?.option?.midPrice) ??
    toNumberOrNull(ticket?.option?.midPrice) ??
    toNumberOrNull(order?.intendedMidpoint) ??
    toNumberOrNull(ticket?.entry?.intendedMidpoint) ??
    null
  );
}

function getFillQuantity(ticket, order, result) {
  return (
    toNumberOrNull(result?.fillQuantity) ??
    toNumberOrNull(order?.fillQuantity) ??
    toNumberOrNull(ticket?.fillQuantity) ??
    toNumberOrNull(result?.filledQty) ??
    toNumberOrNull(order?.filledQty) ??
    toNumberOrNull(ticket?.filledQty) ??
    toNumberOrNull(result?.qty) ??
    toNumberOrNull(order?.qty) ??
    toNumberOrNull(ticket?.qty) ??
    0
  );
}

function getReportedRemainingQuantity(ticket, order, result) {
  return (
    toNumberOrNull(result?.remainingQuantity) ??
    toNumberOrNull(order?.remainingQuantity) ??
    toNumberOrNull(ticket?.remainingQuantity) ??
    toNumberOrNull(result?.remainingQty) ??
    toNumberOrNull(order?.remainingQty) ??
    toNumberOrNull(ticket?.remainingQty) ??
    null
  );
}

function getCanonicalIdentity(ticket, order, result) {
  const sourceSignal =
    ticket?.sourceSignal ||
    order?.sourceSignal ||
    result?.sourceSignal ||
    {};

  return {
    executionId: normalizeId(
      firstDefined(
        result?.executionId,
        order?.executionId,
        ticket?.executionId
      )
    ),

    idempotencyKey: normalizeId(
      firstDefined(
        result?.idempotencyKey,
        order?.idempotencyKey,
        ticket?.idempotencyKey
      )
    ),

    orderId: normalizeId(
      firstDefined(
        result?.orderId,
        order?.orderId,
        ticket?.orderId
      )
    ),

    tradeId: normalizeId(
      firstDefined(
        result?.tradeId,
        order?.tradeId,
        ticket?.tradeId,
        result?.journal?.tradeId
      )
    ),

    planId: normalizeId(
      firstDefined(
        result?.planId,
        order?.planId,
        ticket?.planId,
        sourceSignal?.planId
      )
    ),

    candidateId: normalizeId(
      firstDefined(
        result?.candidateId,
        order?.candidateId,
        ticket?.candidateId,
        sourceSignal?.candidateId
      )
    ),

    zoneId: normalizeId(
      firstDefined(
        result?.zoneId,
        order?.zoneId,
        ticket?.zoneId,
        sourceSignal?.zoneId
      )
    ),

    laneId: normalizeId(
      firstDefined(
        result?.laneId,
        order?.laneId,
        ticket?.laneId,
        sourceSignal?.laneId,
        result?.strategy1Provenance?.laneId,
        order?.strategy1Provenance?.laneId,
        ticket?.strategy1Provenance?.laneId
      )
    ),

    setupClass: normalizeId(
      firstDefined(
        result?.setupClass,
        order?.setupClass,
        ticket?.setupClass,
        sourceSignal?.setupClass,
        result?.strategy1Provenance?.setupClass,
        order?.strategy1Provenance?.setupClass,
        ticket?.strategy1Provenance?.setupClass
      )
    ),

    setupGrade: normalizeId(
      firstDefined(
        result?.setupGrade,
        order?.setupGrade,
        ticket?.setupGrade,
        sourceSignal?.setupGrade,
        result?.strategy1Provenance?.setupGrade,
        order?.strategy1Provenance?.setupGrade,
        ticket?.strategy1Provenance?.setupGrade
      )
    ),

    identitySetupKey: normalizeId(
      firstDefined(
        result?.identitySetupKey,
        order?.identitySetupKey,
        ticket?.identitySetupKey,
        sourceSignal?.identitySetupKey,
        result?.strategy1Provenance?.identitySetupKey,
        order?.strategy1Provenance?.identitySetupKey,
        ticket?.strategy1Provenance?.identitySetupKey
      )
    ),

    candidateIdentityVersion: normalizeId(
      firstDefined(
        result?.candidateIdentityVersion,
        order?.candidateIdentityVersion,
        ticket?.candidateIdentityVersion,
        sourceSignal?.candidateIdentityVersion,
        result?.strategy1Provenance?.candidateIdentityVersion,
        order?.strategy1Provenance?.candidateIdentityVersion,
        ticket?.strategy1Provenance?.candidateIdentityVersion
      )
    ),

    strategyId: normalizeId(
      firstDefined(
        result?.strategyId,
        order?.strategyId,
        ticket?.strategyId,
        sourceSignal?.strategyId
      )
    ),

    symbol: normalizeSymbol(
      firstDefined(
        result?.symbol,
        order?.symbol,
        ticket?.symbol,
        sourceSignal?.symbol
      )
    ),

    direction: directionFromPayload(ticket, order, result),

    setupType: normalizeId(
      firstDefined(
        result?.setupType,
        order?.setupType,
        ticket?.setupType,
        sourceSignal?.setupType
      )
    ),

    snapshotTime: normalizeId(
      firstDefined(
        result?.snapshotTime,
        order?.snapshotTime,
        ticket?.snapshotTime,
        sourceSignal?.snapshotTime
      )
    ),
  };
}

function getStrategy1Provenance(ticket, order, result) {
  const source =
    result?.strategy1Provenance ||
    order?.strategy1Provenance ||
    ticket?.strategy1Provenance ||
    ticket?.sourceSignal?.strategy1Provenance ||
    null;

  if (!source || typeof source !== "object") {
    return null;
  }

  return clone(source);
}

function readStrategySnapshot() {
  return readJson(SNAPSHOT_FILE, {
    ok: false,
    now: nowIso(),
    strategies: {},
  });
}

function activeZoneFromStrategyNode(strategyNode) {
  const zone =
    strategyNode?.confluence?.context?.activeZone ||
    strategyNode?.engine15Decision?.activeZone ||
    strategyNode?.context?.active?.negotiated ||
    strategyNode?.context?.active?.institutional ||
    strategyNode?.context?.active?.shelf ||
    null;

  if (!zone) return null;

  return {
    id: normalizeId(zone?.id),
    lo: toNumberOrNull(zone?.lo),
    hi: toNumberOrNull(zone?.hi),
    mid: toNumberOrNull(zone?.mid),
    strength: zone?.strength ?? null,
    source: zone?.source ?? null,
  };
}

function zoneTypeFromStrategyNode(strategyNode) {
  return (
    strategyNode?.confluence?.context?.activeZone?.zoneType ||
    strategyNode?.context?.zoneType ||
    (strategyNode?.context?.active?.negotiated
      ? "NEGOTIATED"
      : null) ||
    (strategyNode?.context?.active?.institutional
      ? "INSTITUTIONAL"
      : null) ||
    (strategyNode?.context?.active?.shelf
      ? "SHELF"
      : null) ||
    "UNKNOWN"
  );
}

function buildFrozenSetup(strategySnapshot, strategyId) {
  const snapshotTime =
    strategySnapshot?.now ||
    nowIso();

  const strategyNode =
    strategySnapshot?.strategies?.[strategyId] ||
    null;

  if (!strategyNode) {
    return {
      snapshotTime,
      strategyType: "NONE",
      readinessLabel: "UNKNOWN",
      action: "UNKNOWN",
      executionBias: "UNKNOWN",
      qualityScore: 0,
      qualityGrade: "UNKNOWN",
      permission: "UNKNOWN",
      sizeMultiplier: null,
      zoneType: "UNKNOWN",
      activeZone: null,
      engine15Decision: null,
      engine15: null,
      permissionRaw: null,
      engine6v2: null,
      confluence: null,
      engine16: strategySnapshot?.engine16 || null,
      momentum: strategySnapshot?.momentum || null,
      context: null,
    };
  }

  const qualityScore =
    Number(strategyNode?.engine15Decision?.qualityScore) ||
    Number(strategyNode?.confluence?.scores?.total) ||
    Number(strategyNode?.confluence?.total) ||
    0;

  const qualityGrade =
    strategyNode?.engine15Decision?.qualityGrade ||
    strategyNode?.confluence?.scores?.label ||
    strategyNode?.confluence?.label ||
    "UNKNOWN";

  const permission =
    strategyNode?.permission?.permission ||
    strategyNode?.engine15Decision?.permission ||
    "UNKNOWN";

  const sizeMultiplier =
    strategyNode?.permission?.sizeMultiplier ??
    strategyNode?.engine15Decision?.sizeMultiplier ??
    null;

  return {
    snapshotTime,

    strategyType:
      strategyNode?.engine15Decision?.strategyType ||
      strategyNode?.engine15?.strategyType ||
      strategyNode?.engine16?.strategyType ||
      "NONE",

    readinessLabel:
      strategyNode?.engine15Decision?.readinessLabel ||
      strategyNode?.engine15?.readiness ||
      strategyNode?.engine16?.readinessLabel ||
      "UNKNOWN",

    action:
      strategyNode?.engine15Decision?.action ||
      "UNKNOWN",

    executionBias:
      strategyNode?.engine15Decision?.executionBias ||
      strategyNode?.executionBias ||
      "UNKNOWN",

    qualityScore,
    qualityGrade,
    permission,
    sizeMultiplier,

    zoneType:
      zoneTypeFromStrategyNode(strategyNode),

    activeZone:
      activeZoneFromStrategyNode(strategyNode),

    engine15Decision:
      clone(strategyNode?.engine15Decision || null),

    engine15:
      clone(strategyNode?.engine15 || null),

    permissionRaw:
      clone(strategyNode?.permission || null),

    engine6v2:
      clone(strategyNode?.engine6v2 || null),

    confluence:
      clone(strategyNode?.confluence || null),

    engine16:
      clone(
        strategyNode?.engine16 ||
        strategySnapshot?.engine16 ||
        null
      ),

    momentum:
      clone(
        strategyNode?.momentum ||
        strategySnapshot?.momentum ||
        null
      ),

    context:
      clone(strategyNode?.context || null),
  };
}

function getEngine9Plan(ticket, order, result, strategyNode) {
  const plan =
    result?.engine9OfficialManagementPlan ||
    order?.engine9OfficialManagementPlan ||
    ticket?.engine9OfficialManagementPlan ||
    ticket?.sourceSignal?.engine9OfficialManagementPlan ||
    result?.openingPlan ||
    order?.openingPlan ||
    ticket?.openingPlan ||
    strategyNode?.engine9OfficialManagementPlan ||
    {};

  const planId = normalizeId(
    firstDefined(
      result?.planId,
      order?.planId,
      ticket?.planId,
      ticket?.sourceSignal?.planId,
      plan?.planId
    )
  );

  return {
    planId,

    officialEntryPrice:
      toNumberOrNull(
        firstDefined(
          result?.officialEntryPrice,
          order?.officialEntryPrice,
          ticket?.officialEntryPrice,
          plan?.officialEntryPrice
        )
      ),

    officialStopPrice:
      toNumberOrNull(
        firstDefined(
          result?.officialStopPrice,
          order?.officialStopPrice,
          ticket?.officialStopPrice,
          plan?.officialStopPrice
        )
      ),

    officialStopDistancePoints:
      toNumberOrNull(
        firstDefined(
          result?.officialStopDistancePoints,
          order?.officialStopDistancePoints,
          ticket?.officialStopDistancePoints,
          plan?.officialStopDistancePoints
        )
      ),

    officialTargets:
      clone(
        firstDefined(
          result?.officialTargets,
          order?.officialTargets,
          ticket?.officialTargets,
          plan?.officialTargets
        ) || []
      ),

    threeBlockManagement:
      clone(
        firstDefined(
          result?.threeBlockManagement,
          order?.threeBlockManagement,
          ticket?.threeBlockManagement,
          plan?.threeBlockManagement
        ) || null
      ),

    runnerPlan:
      clone(
        firstDefined(
          result?.runnerPlan,
          order?.runnerPlan,
          ticket?.runnerPlan,
          plan?.runnerPlan
        ) || null
      ),

    engine9PlanStatus:
      normalizeId(
        firstDefined(
          result?.engine9PlanStatus,
          order?.engine9PlanStatus,
          ticket?.engine9PlanStatus,
          plan?.planStatus,
          plan?.engine9PlanStatus
        )
      ),
  };
}

function getEngine7Risk(ticket, order, result, strategyNode) {
  const sizing =
    result?.engine7PositionSizing ||
    order?.engine7PositionSizing ||
    ticket?.engine7PositionSizing ||
    ticket?.sourceSignal?.engine7PositionSizing ||
    strategyNode?.engine7PositionSizing ||
    {};

  const estimatedTotalRiskDollars =
    toNumberOrNull(
      firstDefined(
        result?.estimatedTotalRiskDollars,
        order?.estimatedTotalRiskDollars,
        ticket?.estimatedTotalRiskDollars,
        sizing?.estimatedTotalRiskDollars
      )
    );

  return {
    engine7PlanId:
      normalizeId(
        firstDefined(
          result?.engine7PlanId,
          order?.engine7PlanId,
          ticket?.engine7PlanId,
          sizing?.planId,
          sizing?.engine7PlanId
        )
      ),

    engine7FinalContracts:
      toNumberOrNull(
        firstDefined(
          result?.engine7FinalContracts,
          order?.engine7FinalContracts,
          ticket?.engine7FinalContracts,
          sizing?.finalContracts,
          sizing?.engine7FinalContracts
        )
      ),

    riskBudgetDollars:
      toNumberOrNull(
        firstDefined(
          result?.riskBudgetDollars,
          order?.riskBudgetDollars,
          ticket?.riskBudgetDollars,
          sizing?.riskBudgetDollars
        )
      ),

    permissionAdjustedRiskBudget:
      toNumberOrNull(
        firstDefined(
          result?.permissionAdjustedRiskBudget,
          order?.permissionAdjustedRiskBudget,
          ticket?.permissionAdjustedRiskBudget,
          sizing?.permissionAdjustedRiskBudget
        )
      ),

    officialStopDistancePoints:
      toNumberOrNull(
        firstDefined(
          result?.officialStopDistancePoints,
          order?.officialStopDistancePoints,
          ticket?.officialStopDistancePoints,
          sizing?.officialStopDistancePoints
        )
      ),

    dollarsPerPoint:
      toNumberOrNull(
        firstDefined(
          result?.dollarsPerPoint,
          order?.dollarsPerPoint,
          ticket?.dollarsPerPoint,
          sizing?.dollarsPerPoint
        )
      ),

    rawRiskPerContract:
      toNumberOrNull(
        firstDefined(
          result?.rawRiskPerContract,
          order?.rawRiskPerContract,
          ticket?.rawRiskPerContract,
          sizing?.rawRiskPerContract
        )
      ),

    estimatedSlippageRiskPerContract:
      toNumberOrNull(
        firstDefined(
          result?.estimatedSlippageRiskPerContract,
          order?.estimatedSlippageRiskPerContract,
          ticket?.estimatedSlippageRiskPerContract,
          sizing?.estimatedSlippageRiskPerContract
        )
      ),

    commissionDollarsPerContractRoundTrip:
      toNumberOrNull(
        firstDefined(
          result?.commissionDollarsPerContractRoundTrip,
          order?.commissionDollarsPerContractRoundTrip,
          ticket?.commissionDollarsPerContractRoundTrip,
          sizing?.commissionDollarsPerContractRoundTrip
        )
      ),

    effectiveRiskPerContract:
      toNumberOrNull(
        firstDefined(
          result?.effectiveRiskPerContract,
          order?.effectiveRiskPerContract,
          ticket?.effectiveRiskPerContract,
          sizing?.effectiveRiskPerContract
        )
      ),

    estimatedTotalRiskDollars,

    frozenOpeningRiskDollars:
      estimatedTotalRiskDollars,
  };
}

function makeTradeId({
  symbol,
  strategyId,
  eventTime,
}) {
  const safeSymbol =
    normalizeSymbol(symbol) ||
    "UNK";

  const safeStrategy =
    String(strategyId || "unknown")
      .replace(/[^a-zA-Z0-9@_-]/g, "-")
      .replace(/@/g, "_");

  const safeTime =
    String(eventTime || nowIso())
      .replace(/[:.]/g, "-");

  const suffix =
    crypto.randomBytes(2).toString("hex");

  return `TRD-${safeSymbol}-${safeStrategy}-${safeTime}-${suffix}`;
}

function readJournalTrades() {
  const trades = readJson(JOURNAL_FILE, []);
  return Array.isArray(trades) ? trades : [];
}

function writeJournalTrades(trades) {
  writeJson(
    JOURNAL_FILE,
    Array.isArray(trades) ? trades : []
  );
}

function sameNonEmpty(a, b) {
  const left = normalizeId(a);
  const right = normalizeId(b);

  return Boolean(left && right && left === right);
}

function findExistingOpeningTrade(
  trades,
  identity
) {
  if (identity.orderId) {
    const match = trades.find((trade) =>
      sameNonEmpty(
        trade?.identity?.orderId ||
        trade?.orderLink?.orderId,
        identity.orderId
      )
    );

    if (match) return match;
  }

  if (identity.idempotencyKey) {
    const match = trades.find((trade) =>
      sameNonEmpty(
        trade?.identity?.idempotencyKey ||
        trade?.orderLink?.idempotencyKey,
        identity.idempotencyKey
      )
    );

    if (match) return match;
  }

  if (identity.executionId) {
    const match = trades.find((trade) =>
      sameNonEmpty(
        trade?.identity?.openingExecutionId ||
        trade?.identity?.executionId,
        identity.executionId
      )
    );

    if (match) return match;
  }

  if (identity.candidateId) {
    const match = trades.find(
      (trade) =>
        trade?.status === "OPEN" &&
        sameNonEmpty(
          trade?.identity?.candidateId,
          identity.candidateId
        ) &&
        normalizeSymbol(trade?.symbol) ===
          normalizeSymbol(identity.symbol) &&
        String(trade?.strategyId || "") ===
          String(identity.strategyId || "") &&
        toUpper(trade?.direction) ===
          toUpper(identity.direction)
    );

    if (match) return match;
  }

  return null;
}

function eventAlreadyRecorded(
  trade,
  identity
) {
  const events =
    Array.isArray(trade?.events)
      ? trade.events
      : [];

  return (
    events.find((event) => {
      if (
        identity.executionId &&
        sameNonEmpty(
          event?.executionId,
          identity.executionId
        )
      ) {
        return true;
      }

      if (
        identity.idempotencyKey &&
        sameNonEmpty(
          event?.idempotencyKey,
          identity.idempotencyKey
        )
      ) {
        return true;
      }

      if (
        identity.orderId &&
        sameNonEmpty(
          event?.orderId,
          identity.orderId
        )
      ) {
        return true;
      }

      return false;
    }) || null
  );
}

function findTradeForLifecycleUpdate(
  trades,
  identity
) {
  if (identity.tradeId) {
    const match = trades.find((trade) =>
      sameNonEmpty(
        trade?.tradeId,
        identity.tradeId
      )
    );

    if (match) return match;
  }

  if (identity.executionId) {
    const match = trades.find((trade) =>
      Array.isArray(trade?.events) &&
      trade.events.some((event) =>
        sameNonEmpty(
          event?.executionId,
          identity.executionId
        )
      )
    );

    if (match) return match;
  }

  if (identity.idempotencyKey) {
    const match = trades.find((trade) =>
      Array.isArray(trade?.events) &&
      trade.events.some((event) =>
        sameNonEmpty(
          event?.idempotencyKey,
          identity.idempotencyKey
        )
      )
    );

    if (match) return match;
  }

  if (identity.orderId) {
    const match = trades.find((trade) =>
      Array.isArray(trade?.events) &&
      trade.events.some((event) =>
        sameNonEmpty(
          event?.orderId,
          identity.orderId
        )
      )
    );

    if (match) return match;
  }

  if (identity.candidateId) {
    const match = trades.find(
      (trade) =>
        trade?.status === "OPEN" &&
        sameNonEmpty(
          trade?.identity?.candidateId,
          identity.candidateId
        ) &&
        normalizeSymbol(trade?.symbol) ===
          normalizeSymbol(identity.symbol) &&
        String(trade?.strategyId || "") ===
          String(identity.strategyId || "") &&
        toUpper(trade?.direction) ===
          toUpper(identity.direction)
    );

    if (match) return match;
  }

  const candidates = trades.filter(
    (trade) =>
      trade?.status === "OPEN" &&
      normalizeSymbol(trade?.symbol) ===
        normalizeSymbol(identity.symbol) &&
      String(trade?.strategyId || "") ===
        String(identity.strategyId || "") &&
      (
        !identity.direction ||
        identity.direction === "UNKNOWN" ||
        toUpper(trade?.direction) ===
          toUpper(identity.direction)
      )
  );

  candidates.sort((a, b) => {
    const left =
      Date.parse(a?.createdAt || 0) || 0;

    const right =
      Date.parse(b?.createdAt || 0) || 0;

    return right - left;
  });

  return candidates[0] || null;
}

function baseReview() {
  return {
    grade: null,
    notes: "",
    mistakeFlags: [],
    followedPlan: null,
    tags: [],
  };
}

function minutesBetweenIso(
  startIso,
  endIso
) {
  const start = Date.parse(startIso || "");
  const end = Date.parse(endIso || "");

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.round((end - start) / 60000)
  );
}

function computeResultFromRealizedPnL(
  realizedPnL
) {
  const pnl =
    toNumberOrNull(realizedPnL);

  if (pnl === null) return null;
  if (pnl > 0) return "WIN";
  if (pnl < 0) return "LOSS";

  return "BREAKEVEN";
}

function computeEventPnl({
  trade,
  closePrice,
  qtyClosed,
}) {
  const entryPrice =
    toNumberOrNull(trade?.entry?.price);

  const qty =
    toNumberOrNull(qtyClosed);

  if (
    entryPrice === null ||
    closePrice === null ||
    qty === null ||
    qty <= 0
  ) {
    return {
      eventRealizedPoints: null,
      eventRealizedPnL: null,
      pnlBasis: "MISSING_PRICE",
    };
  }

  const assetType =
    toUpper(
      trade?.assetType ||
      "EQUITY"
    );

  const direction =
    toUpper(
      trade?.direction ||
      "UNKNOWN"
    );

  if (assetType === "OPTION") {
    const premiumDifference =
      closePrice - entryPrice;

    const signedDifference =
      direction === "SHORT"
        ? -premiumDifference
        : premiumDifference;

    return {
      eventRealizedPoints:
        round2(signedDifference * qty),

      eventRealizedPnL:
        round2(
          signedDifference *
          qty *
          100
        ),

      pnlBasis: "OPTION_PREMIUM",
    };
  }

  const dollarsPerPoint =
    toNumberOrNull(
      trade?.riskBasis?.dollarsPerPoint
    );

  const priceDifference =
    direction === "SHORT"
      ? entryPrice - closePrice
      : closePrice - entryPrice;

  const realizedPoints =
    round2(priceDifference * qty);

  const realizedPnL =
    dollarsPerPoint !== null
      ? round2(
          priceDifference *
          qty *
          dollarsPerPoint
        )
      : round2(
          priceDifference *
          qty
        );

  return {
    eventRealizedPoints:
      realizedPoints,

    eventRealizedPnL:
      realizedPnL,

    pnlBasis:
      dollarsPerPoint !== null
        ? "FUTURES_CONTRACT"
        : "EQUITY_SHARE",
  };
}

function sumEventField(events, key) {
  const rows =
    Array.isArray(events)
      ? events
      : [];

  let total = 0;
  let found = false;

  for (const event of rows) {
    const value =
      toNumberOrNull(event?.[key]);

    if (value !== null) {
      total += value;
      found = true;
    }
  }

  return found
    ? round2(total)
    : null;
}

function resolveManagementEvent({
  action,
  ticket,
  order,
  result,
  remainingQty,
}) {
  const targetId =
    normalizeId(
      firstDefined(
        result?.targetId,
        order?.targetId,
        ticket?.targetId
      )
    );

  const blockId =
    normalizeId(
      firstDefined(
        result?.blockId,
        order?.blockId,
        ticket?.blockId
      )
    );

  const managementAction =
    normalizeId(
      firstDefined(
        result?.managementAction,
        order?.managementAction,
        ticket?.managementAction
      )
    );

  const exitReason =
    toUpper(
      firstDefined(
        result?.exitReason,
        order?.exitReason,
        ticket?.exitReason
      )
    );

  const stopReason =
    normalizeId(
      firstDefined(
        result?.stopReason,
        order?.stopReason,
        ticket?.stopReason
      )
    );

  let eventType = "UNKNOWN_EXIT";

  if (toUpper(blockId) === "BLOCK_1") {
    eventType = "BLOCK_1_EXIT";
  } else if (toUpper(blockId) === "BLOCK_2") {
    eventType = "BLOCK_2_EXIT";
  } else if (
    remainingQty === 0 &&
    exitReason === "STOP_EXIT"
  ) {
    eventType = "FINAL_EXIT";
  } else if (exitReason === "STOP_EXIT") {
    eventType = "STOP_EXIT";
  } else if (
    remainingQty === 0 &&
    (
      exitReason === "FINAL_EXIT" ||
      toUpper(action) === "EXIT"
    )
  ) {
    eventType = "FINAL_EXIT";
  } else if (
    exitReason === "TARGET_EXIT" ||
    targetId
  ) {
    eventType = "TARGET_EXIT";
  } else if (toUpper(action) === "REDUCE") {
    eventType = "PARTIAL_CLOSE";
  } else if (
    toUpper(action) === "EXIT" &&
    remainingQty === 0
  ) {
    eventType = "FULL_CLOSE";
  }

  return {
    eventType,
    targetId,
    blockId,
    managementAction,
    exitReason:
      exitReason || null,
    stopReason,
  };
}

function appendRunnerArmedEvent({
  trade,
  eventTime,
  identity,
  management,
}) {
  const targetId =
    toUpper(management?.targetId);

  const blockId =
    toUpper(management?.blockId);

  const activatesRunner =
    targetId === "T2" ||
    blockId === "BLOCK_2" ||
    toUpper(management?.managementAction) ===
      "ARM_RUNNER_MANAGEMENT";

  if (!activatesRunner) return;

  const alreadyArmed =
    trade.events.some(
      (event) =>
        event?.eventType ===
        "RUNNER_ARMED"
    );

  if (alreadyArmed) return;

  trade.events.push({
    eventType: "RUNNER_ARMED",
    ts: eventTime,
    executionId: identity.executionId,
    idempotencyKey:
      identity.idempotencyKey,
    orderId: identity.orderId,
    tradeId: trade.tradeId,
    price: null,
    qtyClosed: 0,
    remainingQty:
      toNumberOrNull(
        trade?.qty?.remainingQty
      ),
    targetId:
      management?.targetId ||
      "T2",
    blockId: "BLOCK_3",
    managementAction:
      "ARM_RUNNER_MANAGEMENT",
    exitReason: null,
    stopReason: null,
    reason: "RUNNER_ARMED",
    action: "MANAGEMENT",
    source:
      "engine9_management_after_engine8_fill",
    eventRealizedPoints: null,
    eventRealizedPnL: null,
    pnlBasis: null,
  });
}

function updateSummary(trade) {
  trade.summary =
    trade.summary || {};

  trade.summary.realizedPoints =
    sumEventField(
      trade.events,
      "eventRealizedPoints"
    );

  trade.summary.realizedPnL =
    sumEventField(
      trade.events,
      "eventRealizedPnL"
    );

  const frozenRisk =
    toNumberOrNull(
      trade?.riskBasis
        ?.frozenOpeningRiskDollars
    );

  const realizedPnL =
    toNumberOrNull(
      trade?.summary?.realizedPnL
    );

  trade.summary.realizedR =
    frozenRisk !== null &&
    frozenRisk > 0 &&
    realizedPnL !== null
      ? round2(
          realizedPnL /
          frozenRisk
        )
      : null;
}


/* =========================================================
   ENGINE 10 REAL SCHWAB JOURNAL INGESTION
   ---------------------------------------------------------
   Read-only broker observation boundary.

   Engine 8 owns:
   - Schwab authentication
   - broker transaction reads
   - account-label normalization
   - signed-quantity semantics
   - side / direction normalization
   - fee extraction

   Engine 10 owns:
   - durable broker-fill idempotency
   - REAL campaign assembly
   - tradeId
   - scale-in / scale-out lifecycle
   - FIFO realized P&L from actual fills
   - final CLOSED acknowledgement

   This path is intentionally separate from Engine 8 PAPER
   execution functions below.
========================================================= */

function normalizeRealJournalAccount(value) {
  const account = toUpper(value);

  if (account === "INTRADAY" || account === "SWING") {
    return account;
  }

  return null;
}

function normalizeRealInstrumentRoot(symbol, explicitRoot = null) {
  const directRoot = toUpper(explicitRoot);

  if (directRoot) {
    return directRoot.replace(/^\//, "");
  }

  const raw = toUpper(symbol)
    .replace(/:.*$/, "")
    .replace(/^\//, "");

  if (!raw) return null;

  const futuresMatch = raw.match(/^([A-Z0-9]+?)[FGHJKMNQUVXZ]\d{1,2}$/);

  if (futuresMatch?.[1]) {
    return futuresMatch[1];
  }

  return raw;
}

function realFuturesDollarsPerPoint(rootSymbol) {
  switch (toUpper(rootSymbol)) {
    case "MES":
      return 5;
    case "ES":
      return 50;
    case "MNQ":
      return 2;
    case "NQ":
      return 20;
    case "MYM":
      return 0.5;
    case "YM":
      return 5;
    case "M2K":
      return 5;
    case "RTY":
      return 50;
    default:
      return null;
  }
}

function normalizeRealFee(value) {
  const n = toNumberOrNull(value);
  return n === null ? 0 : Math.abs(n);
}

function normalizeRealBrokerFill(fill = {}) {
  const broker = toUpper(fill?.broker || "SCHWAB");
  const source = toUpper(fill?.source || "SCHWAB_BROKER_FILL");
  const accountMode = toUpper(fill?.accountMode || "REAL");
  const journalAccount = normalizeRealJournalAccount(fill?.journalAccount);

  const brokerTransactionId = normalizeId(
    firstDefined(
      fill?.brokerTransactionId,
      fill?.activityId,
      fill?.transactionId
    )
  );

  const brokerOrderId = normalizeId(
    firstDefined(
      fill?.brokerOrderId,
      fill?.orderId
    )
  );

  const symbol = normalizeId(fill?.symbol);
  const instrumentRoot = normalizeRealInstrumentRoot(
    symbol,
    firstDefined(
      fill?.instrumentRoot,
      fill?.rootSymbol
    )
  );

  const positionEffect = toUpper(fill?.positionEffect);
  const side = toUpper(fill?.side);
  const direction = toUpper(fill?.direction);
  const quantity = toNumberOrNull(fill?.quantity);
  const fillPrice = toNumberOrNull(fill?.fillPrice);
  const fillTime = normalizeId(fill?.fillTime);
  const brokerStatus = toUpper(fill?.brokerStatus || "VALID");
  const eventType = toUpper(fill?.eventType || "TRADE");
  const assetType = toUpper(fill?.assetType || "FUTURE");

  const commission = normalizeRealFee(fill?.commission);
  const futuresExchangeFee = normalizeRealFee(
    fill?.futuresExchangeFee
  );

  const explicitOtherFees = normalizeRealFee(fill?.otherFees);

  const explicitTotalFees = toNumberOrNull(fill?.totalFees);

  const totalFees =
    explicitTotalFees !== null
      ? Math.abs(explicitTotalFees)
      : round2(
          commission +
          futuresExchangeFee +
          explicitOtherFees
        );

  const dollarsPerPoint =
    toNumberOrNull(fill?.dollarsPerPoint) ??
    realFuturesDollarsPerPoint(instrumentRoot);

  const brokerDedupeKey =
    broker &&
    journalAccount &&
    brokerTransactionId
      ? `${broker}|${journalAccount}|${brokerTransactionId}`
      : null;

  return {
    source,
    broker,
    accountMode,
    journalAccount,

    brokerAccountLabel:
      normalizeId(fill?.brokerAccountLabel),

    brokerTransactionId,
    brokerOrderId,
    brokerDedupeKey,

    brokerStatus,
    eventType,

    symbol,
    instrumentRoot,
    assetType,

    positionEffect,
    side,
    direction,
    quantity,
    fillPrice,
    fillTime,

    commission,
    futuresExchangeFee,
    otherFees: explicitOtherFees,
    totalFees,

    dollarsPerPoint,

    paper: fill?.paper === true,
    readOnlyBrokerObservation:
      fill?.readOnlyBrokerObservation === true,
  };
}

function validateRealBrokerFill(fill) {
  const errors = [];

  if (fill.source !== "SCHWAB_BROKER_FILL") {
    errors.push("INVALID_REAL_FILL_SOURCE");
  }

  if (fill.broker !== "SCHWAB") {
    errors.push("INVALID_REAL_FILL_BROKER");
  }

  if (fill.accountMode !== "REAL") {
    errors.push("INVALID_REAL_ACCOUNT_MODE");
  }

  if (!fill.journalAccount) {
    errors.push("INVALID_REAL_JOURNAL_ACCOUNT");
  }

  if (!fill.brokerTransactionId) {
    errors.push("MISSING_BROKER_TRANSACTION_ID");
  }

  if (!fill.brokerDedupeKey) {
    errors.push("MISSING_BROKER_DEDUPE_KEY");
  }

  if (fill.eventType !== "TRADE") {
    errors.push("INVALID_BROKER_EVENT_TYPE");
  }

  if (fill.brokerStatus !== "VALID") {
    errors.push("BROKER_TRANSACTION_NOT_VALID");
  }

  if (fill.assetType !== "FUTURE") {
    errors.push("UNSUPPORTED_REAL_ASSET_TYPE");
  }

  if (!fill.symbol || !fill.instrumentRoot) {
    errors.push("MISSING_REAL_INSTRUMENT");
  }

  if (
    fill.positionEffect !== "OPENING" &&
    fill.positionEffect !== "CLOSING"
  ) {
    errors.push("INVALID_POSITION_EFFECT");
  }

  if (fill.side !== "BUY" && fill.side !== "SELL") {
    errors.push("INVALID_NORMALIZED_SIDE");
  }

  if (
    fill.direction !== "LONG" &&
    fill.direction !== "SHORT"
  ) {
    errors.push("INVALID_NORMALIZED_DIRECTION");
  }

  const expectedSide =
    fill.positionEffect === "OPENING"
      ? (
          fill.direction === "LONG"
            ? "BUY"
            : "SELL"
        )
      : (
          fill.direction === "LONG"
            ? "SELL"
            : "BUY"
        );

  if (fill.side && fill.side !== expectedSide) {
    errors.push("REAL_FILL_SIDE_DIRECTION_MISMATCH");
  }

  if (
    fill.quantity === null ||
    fill.quantity <= 0
  ) {
    errors.push("INVALID_REAL_FILL_QUANTITY");
  }

  if (fill.fillPrice === null) {
    errors.push("MISSING_REAL_FILL_PRICE");
  }

  if (
    !fill.fillTime ||
    !Number.isFinite(Date.parse(fill.fillTime))
  ) {
    errors.push("INVALID_REAL_FILL_TIME");
  }

  if (fill.paper === true) {
    errors.push("REAL_FILL_MARKED_PAPER");
  }

  if (fill.readOnlyBrokerObservation !== true) {
    errors.push("REAL_FILL_NOT_READ_ONLY_OBSERVATION");
  }

  return errors;
}

function realCampaignMatches(trade, fill) {
  return (
    toUpper(trade?.accountMode) === "REAL" &&
    toUpper(trade?.source) === "SCHWAB_BROKER_FILL" &&
    toUpper(
      trade?.journalAccount ||
      trade?.brokerImport?.accountAlias
    ) === fill.journalAccount &&
    toUpper(
      trade?.normalizedInstrumentRoot ||
      trade?.instrumentRoot ||
      trade?.symbol
    ) === fill.instrumentRoot &&
    toUpper(trade?.direction) === fill.direction
  );
}

function findRealOpenCampaigns(trades, fill) {
  return trades.filter(
    (trade) =>
      toUpper(trade?.status) === "OPEN" &&
      realCampaignMatches(trade, fill)
  );
}

function findMostRecentRealCampaign(trades, fill) {
  const candidates = trades
    .filter((trade) => realCampaignMatches(trade, fill))
    .sort((a, b) => {
      const left = Date.parse(
        a?.updatedAt ||
        a?.summary?.closeTime ||
        a?.createdAt ||
        0
      ) || 0;

      const right = Date.parse(
        b?.updatedAt ||
        b?.summary?.closeTime ||
        b?.createdAt ||
        0
      ) || 0;

      return right - left;
    });

  return candidates[0] || null;
}

function findRealFillDuplicate(trades, fill) {
  for (const trade of trades) {
    const events = Array.isArray(trade?.events)
      ? trade.events
      : [];

    const event = events.find(
      (row) =>
        sameNonEmpty(
          row?.brokerDedupeKey,
          fill.brokerDedupeKey
        ) ||
        (
          toUpper(row?.broker) === fill.broker &&
          toUpper(row?.journalAccount) ===
            fill.journalAccount &&
          sameNonEmpty(
            row?.brokerTransactionId,
            fill.brokerTransactionId
          )
        )
    );

    if (event) {
      return {
        trade,
        event,
      };
    }
  }

  return null;
}

function realEventTimeIsOutOfOrder(trade, fillTime) {
  const incoming = Date.parse(fillTime || "");

  if (!Number.isFinite(incoming)) {
    return false;
  }

  const brokerEvents = (
    Array.isArray(trade?.events)
      ? trade.events
      : []
  )
    .filter((event) =>
      normalizeId(event?.brokerTransactionId)
    )
    .map((event) => Date.parse(event?.ts || ""))
    .filter(Number.isFinite);

  if (!brokerEvents.length) {
    return false;
  }

  return incoming < Math.max(...brokerEvents);
}

function weightedAverageLots(lots) {
  const rows = Array.isArray(lots) ? lots : [];

  let quantity = 0;
  let weighted = 0;

  for (const lot of rows) {
    const qty = toNumberOrNull(lot?.qty);
    const price = toNumberOrNull(lot?.price);

    if (
      qty === null ||
      qty <= 0 ||
      price === null
    ) {
      continue;
    }

    quantity += qty;
    weighted += qty * price;
  }

  return quantity > 0
    ? round2(weighted / quantity)
    : null;
}

function cloneRemainingLots(trade) {
  const lots =
    trade?.brokerImport?.remainingLots ||
    trade?.realBroker?.remainingLots ||
    [];

  return Array.isArray(lots)
    ? clone(lots)
    : [];
}

function consumeRealFifoLots({
  lots,
  quantity,
  closePrice,
  direction,
  dollarsPerPoint,
  closingBrokerTransactionId = null,
  closingBrokerOrderId = null,
  closingFillTime = null,
}) {
  const working = clone(lots || []);
  const closedContracts = [];

  let remainingToClose = quantity;
  let realizedPoints = 0;

  while (
    remainingToClose > 0 &&
    working.length
  ) {
    const lot =
      working[0];

    const lotQty =
      toNumberOrNull(
        lot?.qty
      ) ?? 0;

    const lotPrice =
      toNumberOrNull(
        lot?.price
      );

    if (
      lotQty <= 0 ||
      lotPrice === null
    ) {
      working.shift();
      continue;
    }

    const matchedQty =
      Math.min(
        remainingToClose,
        lotQty
      );

    const pointsPerContract =
      direction === "SHORT"
        ? lotPrice - closePrice
        : closePrice - lotPrice;

    /*
     * Canonical Engine 10 per-contract identity.
     *
     * New REAL opening fills are expanded to qty:1 lots and each lot
     * carries its own durable contractId. Legacy qty>1 lots remain
     * readable, but exact contractId analytics require one contractId
     * per unit.
     */
    for (
      let i = 0;
      i < matchedQty;
      i += 1
    ) {
      const contractId =
        normalizeId(
          lot?.contractId
        );

      if (!contractId) {
        return {
          ok: false,
          error:
            "REAL_FIFO_CONTRACT_ID_MISSING",
          openingBrokerTransactionId:
            normalizeId(
              lot?.brokerTransactionId
            ),
        };
      }

      const contractRealizedPoints =
        round2(
          pointsPerContract
        );

      const contractGrossRealizedPnL =
        dollarsPerPoint !== null
          ? round2(
              pointsPerContract *
              dollarsPerPoint
            )
          : null;

      closedContracts.push({
        contractId,

        openingBrokerTransactionId:
          normalizeId(
            lot?.brokerTransactionId
          ),

        openingFillTime:
          normalizeId(
            lot?.fillTime
          ),

        closingBrokerTransactionId:
          normalizeId(
            closingBrokerTransactionId
          ),

        closingBrokerOrderId:
          normalizeId(
            closingBrokerOrderId
          ),

        closingFillTime:
          normalizeId(
            closingFillTime
          ),

        entryPrice:
          lotPrice,

        exitPrice:
          closePrice,

        quantity:
          1,

        direction,

        status:
          "CLOSED",

        realizedPoints:
          contractRealizedPoints,

        grossRealizedPnL:
          contractGrossRealizedPnL,

        pnlBasis:
          dollarsPerPoint !== null
            ? "FUTURES_CONTRACT"
            : "FUTURES_POINTS_ONLY",
      });
    }

    realizedPoints +=
      pointsPerContract *
      matchedQty;

    const nextLotQty =
      lotQty -
      matchedQty;

    if (
      nextLotQty <= 0
    ) {
      working.shift();
    } else {
      /*
       * This branch exists only for legacy qty>1 lots.
       * New contractId-aware REAL lots are always qty:1.
       */
      working[0] = {
        ...lot,
        qty:
          nextLotQty,
      };
    }

    remainingToClose -=
      matchedQty;
  }

  if (
    remainingToClose > 0
  ) {
    return {
      ok: false,
      error:
        "REAL_FIFO_LOTS_INSUFFICIENT",
      remainingToClose,
    };
  }

  const roundedPoints =
    round2(
      realizedPoints
    );

  const grossRealizedPnL =
    dollarsPerPoint !== null
      ? round2(
          realizedPoints *
          dollarsPerPoint
        )
      : null;

  const closedContractsGrossPnL =
    closedContracts.reduce(
      (sum, contract) =>
        sum +
        (
          toNumberOrNull(
            contract
              ?.grossRealizedPnL
          ) || 0
        ),
      0
    );

  if (
    grossRealizedPnL !== null &&
    round2(
      closedContractsGrossPnL
    ) !== grossRealizedPnL
  ) {
    return {
      ok: false,
      error:
        "REAL_CLOSED_CONTRACT_RECONCILIATION_FAILED",
      grossEventRealizedPnL:
        grossRealizedPnL,
      closedContractsGrossPnL:
        round2(
          closedContractsGrossPnL
        ),
    };
  }

  return {
    ok: true,

    remainingLots:
      working,

    closedContracts,

    eventRealizedPoints:
      roundedPoints,

    grossEventRealizedPnL:
      grossRealizedPnL,
  };
}

function sumRealEventFees(events) {
  let commission = 0;
  let futuresExchangeFee = 0;
  let otherFees = 0;
  let totalFees = 0;

  for (const event of Array.isArray(events) ? events : []) {
    commission +=
      normalizeRealFee(event?.commission);

    futuresExchangeFee +=
      normalizeRealFee(
        event?.futuresExchangeFee
      );

    otherFees +=
      normalizeRealFee(event?.otherFees);

    totalFees +=
      normalizeRealFee(event?.totalFees);
  }

  return {
    commission: round2(commission),
    futuresExchangeFee:
      round2(futuresExchangeFee),
    otherFees: round2(otherFees),
    totalFees: round2(totalFees),
  };
}

function updateRealTradeAccounting(trade) {
  trade.events =
    Array.isArray(trade?.events)
      ? trade.events
      : [];

  trade.summary =
    trade.summary || {};

  trade.brokerImport =
    trade.brokerImport || {};

  const grossRealizedPoints =
    sumEventField(
      trade.events,
      "eventRealizedPoints"
    );

  const grossRealizedPnL =
    sumEventField(
      trade.events,
      "grossEventRealizedPnL"
    );

  const fees =
    sumRealEventFees(trade.events);

  trade.summary.realizedPoints =
    grossRealizedPoints;

  // Existing Journal semantics:
  // realizedPnL remains GROSS realized trade P&L.
  trade.summary.realizedPnL =
    grossRealizedPnL;

  trade.summary.grossRealizedPnL =
    grossRealizedPnL;

  trade.summary.actualCommission =
    fees.commission;

  trade.summary.futuresExchangeFees =
    fees.futuresExchangeFee;

  trade.summary.otherBrokerFees =
    fees.otherFees;

  trade.summary.actualFees =
    fees.totalFees;

  trade.summary.netRealizedPnL =
    grossRealizedPnL !== null
      ? round2(
          grossRealizedPnL -
          fees.totalFees
        )
      : round2(
          0 -
          fees.totalFees
        );

  trade.brokerImport.grossRealizedTradePnL =
    trade.summary.grossRealizedPnL;

  trade.brokerImport.actualCommission =
    trade.summary.actualCommission;

  trade.brokerImport.futuresExchangeFees =
    trade.summary.futuresExchangeFees;

  trade.brokerImport.actualFees =
    trade.summary.actualFees;

  trade.brokerImport.netRealizedTradePnL =
    trade.summary.netRealizedPnL;

  const remainingLots =
    cloneRemainingLots(trade);

  trade.brokerImport.remainingLots =
    remainingLots;

  trade.brokerImport.remainingAverageEntry =
    weightedAverageLots(remainingLots);
}

function buildRealBrokerEvent({
  trade,
  fill,
  eventType,
  remainingQty,
  eventRealizedPoints = null,
  grossEventRealizedPnL = null,
  closedContracts = [],
}) {
  const netEventRealizedPnL =
    grossEventRealizedPnL !== null
      ? round2(
          grossEventRealizedPnL -
          fill.totalFees
        )
      : null;

  return {
    eventType,
    ts: fill.fillTime,

    tradeId: trade.tradeId,

    broker: fill.broker,
    source: fill.source,
    accountMode: "REAL",
    journalAccount: fill.journalAccount,

    brokerTransactionId:
      fill.brokerTransactionId,

    brokerOrderId:
      fill.brokerOrderId,

    brokerDedupeKey:
      fill.brokerDedupeKey,

    brokerStatus:
      fill.brokerStatus,

    symbol: fill.symbol,
    instrumentRoot:
      fill.instrumentRoot,

    positionEffect:
      fill.positionEffect,

    side:
      fill.side,

    direction:
      fill.direction,

    price:
      fill.fillPrice,

    fillQuantity:
      fill.quantity,

    qtyClosed:
      fill.positionEffect === "CLOSING"
        ? fill.quantity
        : 0,

    remainingQty,

    commission:
      fill.commission,

    futuresExchangeFee:
      fill.futuresExchangeFee,

    otherFees:
      fill.otherFees,

    totalFees:
      fill.totalFees,

    eventRealizedPoints,

    grossEventRealizedPnL,

    closedContracts:
      Array.isArray(
        closedContracts
      )
        ? clone(
            closedContracts
          )
        : [],

    // Compatibility with existing Journal event readers.
    eventRealizedPnL:
      grossEventRealizedPnL,

    netEventRealizedPnL,

    pnlBasis:
      fill.dollarsPerPoint !== null
        ? "FUTURES_CONTRACT"
        : "FUTURES_POINTS_ONLY",

    action:
      fill.positionEffect === "OPENING"
        ? (
            eventType === "REAL_ENTRY_FILL"
              ? "NEW_ENTRY"
              : "SCALE_IN"
          )
        : (
            remainingQty === 0
              ? "EXIT"
              : "REDUCE"
          ),

    reason:
      eventType,

    readOnlyBrokerObservation: true,
  };
}

function makeRealTradeId(fill) {
  return makeTradeId({
    symbol:
      fill.instrumentRoot,

    strategyId:
      "schwab_real@broker",

    eventTime:
      fill.fillTime,
  });
}


function makeRealContractId({
  tradeId,
  openingBrokerTransactionId,
  ordinal,
}) {
  const safeTradeId =
    normalizeId(tradeId) ||
    "UNKNOWN_TRADE";

  const safeOpeningId =
    normalizeId(
      openingBrokerTransactionId
    ) ||
    "UNKNOWN_OPENING";

  const safeOrdinal =
    Number.isInteger(ordinal) &&
    ordinal > 0
      ? ordinal
      : 1;

  return `${safeTradeId}|CTR|${safeOpeningId}|${safeOrdinal}`;
}

function buildRealOpeningContracts({
  tradeId,
  fill,
}) {
  const quantity =
    toNumberOrNull(
      fill?.quantity
    ) ?? 0;

  const contracts = [];

  for (
    let ordinal = 1;
    ordinal <= quantity;
    ordinal += 1
  ) {
    contracts.push({
      contractId:
        makeRealContractId({
          tradeId,
          openingBrokerTransactionId:
            fill.brokerTransactionId,
          ordinal,
        }),

      tradeId,

      broker:
        fill.broker,

      journalAccount:
        fill.journalAccount,

      brokerAccountLabel:
        fill.brokerAccountLabel,

      symbol:
        fill.instrumentRoot,

      brokerSymbol:
        fill.symbol,

      direction:
        fill.direction,

      status:
        "OPEN",

      openingBrokerTransactionId:
        fill.brokerTransactionId,

      openingBrokerOrderId:
        fill.brokerOrderId,

      openingFillTime:
        fill.fillTime,

      entryPrice:
        fill.fillPrice,

      closingBrokerTransactionId:
        null,

      closingBrokerOrderId:
        null,

      closingFillTime:
        null,

      exitPrice:
        null,

      realizedPoints:
        null,

      grossRealizedPnL:
        null,

      pnlBasis:
        fill.dollarsPerPoint !== null
          ? "FUTURES_CONTRACT"
          : "FUTURES_POINTS_ONLY",
    });
  }

  return contracts;
}

function getRealContractRegistry(trade) {
  const contracts =
    trade?.realBroker?.contracts ||
    trade?.brokerImport?.contracts ||
    [];

  return Array.isArray(contracts)
    ? clone(contracts)
    : [];
}

function setRealContractRegistry(
  trade,
  contracts
) {
  const rows =
    Array.isArray(contracts)
      ? clone(contracts)
      : [];

  trade.realBroker =
    trade.realBroker || {};

  trade.realBroker.contracts =
    clone(rows);

  trade.brokerImport =
    trade.brokerImport || {};

  // Mirror for Journal/frontend compatibility while realBroker.contracts
  // remains the canonical Engine 10 REAL per-contract registry.
  trade.brokerImport.contracts =
    clone(rows);
}

function closeRealContractRegistry({
  trade,
  closedContracts,
  fill,
}) {
  const registry =
    getRealContractRegistry(
      trade
    );

  if (!registry.length) {
    return {
      ok: false,
      error:
        "REAL_CONTRACT_REGISTRY_MISSING",
    };
  }

  const byId =
    new Map(
      registry.map(
        (contract) => [
          contract?.contractId,
          contract,
        ]
      )
    );

  for (
    const closed
    of Array.isArray(
      closedContracts
    )
      ? closedContracts
      : []
  ) {
    const contractId =
      normalizeId(
        closed?.contractId
      );

    const contract =
      byId.get(
        contractId
      );

    if (!contract) {
      return {
        ok: false,
        error:
          "REAL_CONTRACT_ID_NOT_FOUND_FOR_CLOSE",
        contractId,
      };
    }

    if (
      toUpper(
        contract?.status
      ) !== "OPEN"
    ) {
      return {
        ok: false,
        error:
          "REAL_CONTRACT_ALREADY_CLOSED",
        contractId,
      };
    }

    contract.status =
      "CLOSED";

    contract.closingBrokerTransactionId =
      fill.brokerTransactionId;

    contract.closingBrokerOrderId =
      fill.brokerOrderId;

    contract.closingFillTime =
      fill.fillTime;

    contract.exitPrice =
      fill.fillPrice;

    contract.realizedPoints =
      closed.realizedPoints;

    contract.grossRealizedPnL =
      closed.grossRealizedPnL;

    contract.pnlBasis =
      closed.pnlBasis;
  }

  setRealContractRegistry(
    trade,
    registry
  );

  return {
    ok: true,
  };
}

function createRealCampaign({
  trades,
  fill,
}) {
  const tradeId =
    makeRealTradeId(fill);

  const openingContracts =
    buildRealOpeningContracts({
      tradeId,
      fill,
    });

  const openingLots =
    openingContracts.map(
      (contract) => ({
        contractId:
          contract.contractId,

        brokerTransactionId:
          fill.brokerTransactionId,

        qty:
          1,

        price:
          fill.fillPrice,

        fillTime:
          fill.fillTime,
      })
    );

  const trade = {
    tradeId,

    identity: {
      tradeId,
      brokerTransactionId:
        fill.brokerTransactionId,
      brokerOrderId:
        fill.brokerOrderId,
      brokerDedupeKey:
        fill.brokerDedupeKey,
      strategyId:
        "schwab_real@broker",
      symbol:
        fill.instrumentRoot,
      direction:
        fill.direction,
      setupType:
        "SCHWAB_REAL_BROKER_CAMPAIGN",
    },

    source:
      "SCHWAB_BROKER_FILL",

    broker:
      "SCHWAB",

    accountMode:
      "REAL",

    journalAccount:
      fill.journalAccount,

    brokerAccountLabel:
      fill.brokerAccountLabel,

    symbol:
      fill.instrumentRoot,

    brokerSymbol:
      fill.symbol,

    normalizedInstrumentRoot:
      fill.instrumentRoot,

    strategyId:
      "schwab_real@broker",

    timeframe:
      "BROKER",

    direction:
      fill.direction,

    setupType:
      "SCHWAB_REAL_BROKER_CAMPAIGN",

    assetType:
      "FUTURES",

    status:
      "OPEN",

    result:
      null,

    entry: {
      time:
        fill.fillTime,

      firstFillPrice:
        fill.fillPrice,

      price:
        fill.fillPrice,

      qty:
        fill.quantity,

      fillStatus:
        "FILLED",

      source:
        "SCHWAB_BROKER_FILL",

      orderType:
        "BROKER_EXECUTION",

      brokerTransactionId:
        fill.brokerTransactionId,

      brokerOrderId:
        fill.brokerOrderId,
    },

    realBroker: {
      broker:
        "SCHWAB",

      journalAccount:
        fill.journalAccount,

      brokerAccountLabel:
        fill.brokerAccountLabel,

      brokerSymbol:
        fill.symbol,

      normalizedInstrumentRoot:
        fill.instrumentRoot,

      dollarsPerPoint:
        fill.dollarsPerPoint,

      remainingLots:
        clone(openingLots),

      contracts:
        clone(openingContracts),
    },

    // Kept for Journal frontend compatibility with earlier TOS imports.
    brokerImport: {
      broker:
        "SCHWAB_THINKORSWIM",

      accountAlias:
        fill.journalAccount,

      brokerSymbol:
        fill.symbol,

      dollarsPerPoint:
        fill.dollarsPerPoint,

      remainingLots:
        clone(openingLots),

      contracts:
        clone(openingContracts),

      remainingAverageEntry:
        fill.fillPrice,

      grossRealizedTradePnL:
        null,

      actualCommission:
        fill.commission,

      futuresExchangeFees:
        fill.futuresExchangeFee,

      actualFees:
        fill.totalFees,

      netRealizedTradePnL:
        round2(
          0 -
          fill.totalFees
        ),

      dailyAccountPnL:
        null,
    },

    events: [],

    qty: {
      originalQty:
        fill.quantity,

      remainingQty:
        fill.quantity,

      cumulativeOpeningQuantity:
        fill.quantity,

      cumulativeFilledQuantity:
        fill.quantity,

      cumulativeExitQuantity:
        0,
    },

    summary: {
      openTime:
        fill.fillTime,

      closeTime:
        null,

      durationMinutes:
        null,

      realizedPoints:
        null,

      realizedPnL:
        null,

      grossRealizedPnL:
        null,

      actualCommission:
        fill.commission,

      futuresExchangeFees:
        fill.futuresExchangeFee,

      otherBrokerFees:
        fill.otherFees,

      actualFees:
        fill.totalFees,

      netRealizedPnL:
        round2(
          0 -
          fill.totalFees
        ),

      realizedR:
        null,

      percentReturn:
        null,

      // Daily futures settlement/account P&L is a separate
      // concept and is not manufactured by broker-fill ingestion.
      dailyAccountPnL:
        null,
    },

    review:
      baseReview(),

    createdAt:
      fill.fillTime,

    updatedAt:
      fill.fillTime,
  };

  trade.events.push(
    buildRealBrokerEvent({
      trade,
      fill,
      eventType:
        "REAL_ENTRY_FILL",
      remainingQty:
        fill.quantity,
    })
  );

  updateRealTradeAccounting(trade);

  trades.unshift(trade);

  return trade;
}

function applyRealScaleIn({
  trade,
  fill,
}) {
  const previousRemaining =
    toNumberOrNull(
      trade?.qty?.remainingQty
    ) ?? 0;

  const nextRemaining =
    round2(
      previousRemaining +
      fill.quantity
    );

  const currentLots =
    cloneRemainingLots(trade);

  const newContracts =
    buildRealOpeningContracts({
      tradeId:
        trade.tradeId,
      fill,
    });

  for (
    const contract
    of newContracts
  ) {
    currentLots.push({
      contractId:
        contract.contractId,

      brokerTransactionId:
        fill.brokerTransactionId,

      qty:
        1,

      price:
        fill.fillPrice,

      fillTime:
        fill.fillTime,
    });
  }

  const contractRegistry = [
    ...getRealContractRegistry(
      trade
    ),
    ...newContracts,
  ];

  setRealContractRegistry(
    trade,
    contractRegistry
  );

  trade.realBroker =
    trade.realBroker || {};

  trade.realBroker.remainingLots =
    clone(currentLots);

  trade.brokerImport =
    trade.brokerImport || {};

  trade.brokerImport.remainingLots =
    clone(currentLots);

  trade.qty =
    trade.qty || {};

  trade.qty.remainingQty =
    nextRemaining;

  trade.qty.cumulativeOpeningQuantity =
    round2(
      (
        toNumberOrNull(
          trade?.qty?.cumulativeOpeningQuantity
        ) ?? 0
      ) +
      fill.quantity
    );

  trade.qty.cumulativeFilledQuantity =
    trade.qty.cumulativeOpeningQuantity;

  trade.qty.originalQty =
    Math.max(
      toNumberOrNull(
        trade?.qty?.originalQty
      ) ?? 0,
      nextRemaining
    );

  trade.entry =
    trade.entry || {};

  trade.entry.qty =
    trade.qty.originalQty;

  trade.entry.price =
    weightedAverageLots(
      currentLots
    );

  trade.events.push(
    buildRealBrokerEvent({
      trade,
      fill,
      eventType:
        "REAL_SCALE_IN_FILL",
      remainingQty:
        nextRemaining,
    })
  );

  trade.updatedAt =
    fill.fillTime;

  updateRealTradeAccounting(trade);

  return {
    trade,
    remainingQty:
      nextRemaining,
    eventType:
      "REAL_SCALE_IN_FILL",
  };
}

function applyRealClosingFill({
  trade,
  fill,
}) {
  const previousRemaining =
    toNumberOrNull(
      trade?.qty?.remainingQty
    ) ?? 0;

  if (
    fill.quantity >
    previousRemaining
  ) {
    return {
      ok: false,
      error:
        "REAL_EXIT_QUANTITY_EXCEEDS_REMAINING_QUANTITY",
      previousRemaining,
      fillQuantity:
        fill.quantity,
    };
  }

  const fifo =
    consumeRealFifoLots({
      lots:
        cloneRemainingLots(trade),
      quantity:
        fill.quantity,
      closePrice:
        fill.fillPrice,
      direction:
        fill.direction,
      dollarsPerPoint:
        fill.dollarsPerPoint,
      closingBrokerTransactionId:
        fill.brokerTransactionId,
      closingBrokerOrderId:
        fill.brokerOrderId,
      closingFillTime:
        fill.fillTime,
    });

  if (!fifo.ok) {
    return fifo;
  }

  const nextRemaining =
    round2(
      previousRemaining -
      fill.quantity
    );

  trade.realBroker =
    trade.realBroker || {};

  trade.realBroker.remainingLots =
    clone(fifo.remainingLots);

  trade.brokerImport =
    trade.brokerImport || {};

  trade.brokerImport.remainingLots =
    clone(fifo.remainingLots);

  trade.qty =
    trade.qty || {};

  trade.qty.remainingQty =
    nextRemaining;

  trade.qty.cumulativeExitQuantity =
    round2(
      (
        toNumberOrNull(
          trade?.qty?.cumulativeExitQuantity
        ) ?? 0
      ) +
      fill.quantity
    );

  const eventType =
    nextRemaining === 0
      ? "REAL_FINAL_EXIT"
      : "REAL_PARTIAL_EXIT";

  trade.events.push(
    buildRealBrokerEvent({
      trade,
      fill,
      eventType,
      remainingQty:
        nextRemaining,
      eventRealizedPoints:
        fifo.eventRealizedPoints,
      grossEventRealizedPnL:
        fifo.grossEventRealizedPnL,
      closedContracts:
        fifo.closedContracts,
    })
  );

  const registryClose =
    closeRealContractRegistry({
      trade,
      closedContracts:
        fifo.closedContracts,
      fill,
    });

  if (!registryClose.ok) {
    return registryClose;
  }

  updateRealTradeAccounting(trade);

  if (nextRemaining === 0) {
    trade.status =
      "CLOSED";

    trade.summary.closeTime =
      fill.fillTime;

    trade.summary.durationMinutes =
      minutesBetweenIso(
        trade.summary.openTime ||
        trade.entry?.time,
        fill.fillTime
      );

    trade.result =
      computeResultFromRealizedPnL(
        firstDefined(
          trade.summary.netRealizedPnL,
          trade.summary.realizedPnL
        )
      );

    const alreadyClosed =
      trade.events.some(
        (event) =>
          event?.eventType ===
          "TRADE_CLOSED"
      );

    if (!alreadyClosed) {
      trade.events.push({
        eventType:
          "TRADE_CLOSED",

        ts:
          fill.fillTime,

        tradeId:
          trade.tradeId,

        broker:
          fill.broker,

        source:
          "engine10_journal",

        accountMode:
          "REAL",

        journalAccount:
          fill.journalAccount,

        brokerTransactionId:
          fill.brokerTransactionId,

        brokerOrderId:
          fill.brokerOrderId,

        brokerDedupeKey:
          `${fill.brokerDedupeKey}|TRADE_CLOSED`,

        price:
          fill.fillPrice,

        fillQuantity:
          0,

        qtyClosed:
          0,

        remainingQty:
          0,

        eventRealizedPoints:
          null,

        grossEventRealizedPnL:
          null,

        eventRealizedPnL:
          null,

        netEventRealizedPnL:
          null,

        commission:
          0,

        futuresExchangeFee:
          0,

        otherFees:
          0,

        totalFees:
          0,

        finalResult:
          trade.result,

        realizedPoints:
          trade.summary.realizedPoints,

        grossRealizedPnL:
          trade.summary.grossRealizedPnL,

        realizedPnL:
          trade.summary.realizedPnL,

        actualFees:
          trade.summary.actualFees,

        netRealizedPnL:
          trade.summary.netRealizedPnL,

        action:
          "CLOSE",

        reason:
          "TRADE_CLOSED",

        readOnlyBrokerObservation:
          true,
      });
    }
  } else {
    trade.status =
      "OPEN";

    trade.result =
      null;
  }

  trade.updatedAt =
    fill.fillTime;

  return {
    ok: true,
    trade,
    remainingQty:
      nextRemaining,
    eventType,
  };
}

export async function ingestRealBrokerFill(
  normalizedFill = {}
) {
  const fill =
    normalizeRealBrokerFill(
      normalizedFill
    );

  const validationErrors =
    validateRealBrokerFill(fill);

  if (validationErrors.length) {
    return {
      ok: false,
      created: false,
      updated: false,
      duplicate: false,
      journalCompleted: false,
      error:
        "INVALID_REAL_BROKER_FILL",
      reasonCodes:
        validationErrors,
      brokerTransactionId:
        fill.brokerTransactionId,
    };
  }

  const trades =
    readJournalTrades();

  const duplicate =
    findRealFillDuplicate(
      trades,
      fill
    );

  if (duplicate) {
    return {
      ok: true,
      brokerTransactionId:
        fill.brokerTransactionId,
      tradeId:
        duplicate.trade.tradeId,
      created: false,
      updated: false,
      duplicate: true,
      status:
        duplicate.trade.status,
      remainingQty:
        toNumberOrNull(
          duplicate.trade?.qty?.remainingQty
        ) ?? 0,
      journalCompleted: true,
      eventType:
        duplicate.event.eventType,
      reason:
        "REAL_BROKER_FILL_ALREADY_RECORDED",
      trade:
        duplicate.trade,
    };
  }

  const openCampaigns =
    findRealOpenCampaigns(
      trades,
      fill
    );

  if (openCampaigns.length > 1) {
    return {
      ok: false,
      created: false,
      updated: false,
      duplicate: false,
      journalCompleted: false,
      error:
        "AMBIGUOUS_REAL_CAMPAIGN_MATCH",
      brokerTransactionId:
        fill.brokerTransactionId,
      journalAccount:
        fill.journalAccount,
      instrumentRoot:
        fill.instrumentRoot,
      direction:
        fill.direction,
      matchingTradeIds:
        openCampaigns.map(
          (trade) =>
            trade.tradeId
        ),
    };
  }

  const openTrade =
    openCampaigns[0] || null;

  if (
    openTrade &&
    realEventTimeIsOutOfOrder(
      openTrade,
      fill.fillTime
    )
  ) {
    return {
      ok: false,
      created: false,
      updated: false,
      duplicate: false,
      journalCompleted: false,
      error:
        "REAL_FILL_OUT_OF_ORDER",
      brokerTransactionId:
        fill.brokerTransactionId,
      tradeId:
        openTrade.tradeId,
      fillTime:
        fill.fillTime,
    };
  }

  if (fill.positionEffect === "OPENING") {
    if (!openTrade) {
      const latestCampaign =
        findMostRecentRealCampaign(
          trades,
          fill
        );

      const latestCloseTime =
        normalizeId(
          latestCampaign?.summary?.closeTime
        );

      if (
        latestCampaign &&
        latestCloseTime &&
        Date.parse(fill.fillTime) <=
          Date.parse(latestCloseTime)
      ) {
        return {
          ok: false,
          created: false,
          updated: false,
          duplicate: false,
          journalCompleted: false,
          error:
            "REAL_FILL_OUT_OF_ORDER_AFTER_CLOSED_CAMPAIGN",
          brokerTransactionId:
            fill.brokerTransactionId,
          priorTradeId:
            latestCampaign.tradeId,
          fillTime:
            fill.fillTime,
          priorCloseTime:
            latestCloseTime,
        };
      }

      const trade =
        createRealCampaign({
          trades,
          fill,
        });

      writeJournalTrades(trades);

      return {
        ok: true,
        brokerTransactionId:
          fill.brokerTransactionId,
        tradeId:
          trade.tradeId,
        created: true,
        updated: false,
        duplicate: false,
        status:
          "OPEN",
        remainingQty:
          trade.qty.remainingQty,
        journalCompleted: true,
        eventType:
          "REAL_ENTRY_FILL",
        trade,
      };
    }

    const applied =
      applyRealScaleIn({
        trade:
          openTrade,
        fill,
      });

    writeJournalTrades(trades);

    return {
      ok: true,
      brokerTransactionId:
        fill.brokerTransactionId,
      tradeId:
        openTrade.tradeId,
      created: false,
      updated: true,
      duplicate: false,
      status:
        openTrade.status,
      remainingQty:
        applied.remainingQty,
      journalCompleted: true,
      eventType:
        applied.eventType,
      trade:
        openTrade,
    };
  }

  if (!openTrade) {
    return {
      ok: false,
      created: false,
      updated: false,
      duplicate: false,
      journalCompleted: false,
      error:
        "REAL_OPEN_CAMPAIGN_NOT_FOUND",
      brokerTransactionId:
        fill.brokerTransactionId,
      journalAccount:
        fill.journalAccount,
      instrumentRoot:
        fill.instrumentRoot,
      direction:
        fill.direction,
    };
  }

  const applied =
    applyRealClosingFill({
      trade:
        openTrade,
      fill,
    });

  if (!applied.ok) {
    return {
      ok: false,
      created: false,
      updated: false,
      duplicate: false,
      journalCompleted: false,
      brokerTransactionId:
        fill.brokerTransactionId,
      tradeId:
        openTrade.tradeId,
      ...applied,
    };
  }

  writeJournalTrades(trades);

  return {
    ok: true,
    brokerTransactionId:
      fill.brokerTransactionId,
    tradeId:
      openTrade.tradeId,
    created: false,
    updated: true,
    duplicate: false,
    status:
      openTrade.status,
    remainingQty:
      applied.remainingQty,
    journalCompleted: true,
    eventType:
      applied.eventType,
    trade:
      openTrade,
  };
}


export async function listTrades(
  filters = {}
) {
  let trades = readJournalTrades();

  const symbol =
    normalizeSymbol(filters?.symbol);

  const strategyId =
    String(
      filters?.strategyId || ""
    ).trim();

  const status =
    toUpper(filters?.status);

  const accountMode =
    toUpper(filters?.accountMode);

  if (symbol) {
    trades = trades.filter(
      (trade) =>
        normalizeSymbol(trade?.symbol) ===
        symbol
    );
  }

  if (strategyId) {
    trades = trades.filter(
      (trade) =>
        String(
          trade?.strategyId || ""
        ) === strategyId
    );
  }

  if (status) {
    trades = trades.filter(
      (trade) =>
        toUpper(trade?.status) ===
        status
    );
  }

  if (accountMode) {
    trades = trades.filter(
      (trade) =>
        toUpper(
          trade?.accountMode
        ) === accountMode
    );
  }

  trades.sort((a, b) => {
    const left =
      Date.parse(a?.createdAt || 0) ||
      0;

    const right =
      Date.parse(b?.createdAt || 0) ||
      0;

    return right - left;
  });

  return {
    ok: true,
    trades,
  };
}

export async function getTradeById(
  tradeId
) {
  const trades =
    readJournalTrades();

  const trade =
    trades.find(
      (item) =>
        String(item?.tradeId) ===
        String(tradeId)
    ) || null;

  if (!trade) {
    return {
      ok: false,
      error: "TRADE_NOT_FOUND",
      tradeId,
    };
  }

  return {
    ok: true,
    trade,
  };
}

export async function createTradeJournalEntryFromEngine8Fill({
  ticket = {},
  order = {},
  result = {},
}) {
  const action =
    getAction(ticket, order, result);

  if (action !== "NEW_ENTRY") {
    return {
      ok: true,
      created: false,
      skipped: true,
      reason: "NOT_OPENING_FILL",
      action,
    };
  }

  const status =
    getFillStatus(
      ticket,
      order,
      result
    );

  if (status !== "FILLED") {
    return {
      ok: true,
      created: false,
      skipped: true,
      reason: "ORDER_NOT_FILLED",
      action,
      status,
    };
  }

  const identity =
    getCanonicalIdentity(
      ticket,
      order,
      result
    );

  const trades =
    readJournalTrades();

  const existing =
    findExistingOpeningTrade(
      trades,
      identity
    );

  if (existing) {
    return {
      ok: true,
      created: false,
      skipped: true,
      reason:
        "TRADE_ALREADY_RECORDED",
      tradeId:
        existing.tradeId,
      status:
        existing.status,
      remainingQty:
        toNumberOrNull(
          existing?.qty?.remainingQty
        ),
      trade:
        existing,
    };
  }

  const eventTime =
    getEventTime(
      ticket,
      order,
      result
    );

  const fillQuantity =
    getFillQuantity(
      ticket,
      order,
      result
    );

  const fillPrice =
    getExecutionPrice(
      ticket,
      order,
      result
    );

  if (
    !identity.symbol ||
    !identity.strategyId
  ) {
    return {
      ok: false,
      created: false,
      error:
        "JOURNAL_IDENTITY_INCOMPLETE",
      missing: {
        symbol:
          !identity.symbol,
        strategyId:
          !identity.strategyId,
      },
    };
  }

  if (
    !Number.isFinite(fillQuantity) ||
    fillQuantity <= 0
  ) {
    return {
      ok: false,
      created: false,
      error:
        "INVALID_OPENING_FILL_QUANTITY",
      fillQuantity,
    };
  }

  const snapshot =
    readStrategySnapshot();

  const strategyNode =
    snapshot?.strategies?.[
      identity.strategyId
    ] || null;

  const frozenSetup =
    buildFrozenSetup(
      snapshot,
      identity.strategyId
    );

  const openingPlan =
    getEngine9Plan(
      ticket,
      order,
      result,
      strategyNode
    );

  const riskBasis =
    getEngine7Risk(
      ticket,
      order,
      result,
      strategyNode
    );

  const strategy1Provenance =
    getStrategy1Provenance(
      ticket,
      order,
      result
    );

  const tradeId =
    makeTradeId({
      symbol:
        identity.symbol,

      strategyId:
        identity.strategyId,

      eventTime,
    });

  const assetType =
    toUpper(
      firstDefined(
        result?.assetType,
        order?.assetType,
        ticket?.assetType
      ) || "EQUITY"
    );

  const timeframe =
    strategyTimeframe(
      identity.strategyId,
      firstDefined(
        result?.timeframe,
        order?.timeframe,
        ticket?.timeframe
      )
    );

  const trade = {
    tradeId,

    identity: {
      tradeId,
      openingExecutionId:
        identity.executionId,
      executionId:
        identity.executionId,
      idempotencyKey:
        identity.idempotencyKey,
      orderId:
        identity.orderId,
      planId:
        identity.planId ||
        openingPlan.planId,
      candidateId:
        identity.candidateId,
      zoneId:
        identity.zoneId,
      laneId:
        identity.laneId,
      strategyId:
        identity.strategyId,
      symbol:
        identity.symbol,
      direction:
        identity.direction,
      setupType:
        identity.setupType,
      setupClass:
        identity.setupClass,
      setupGrade:
        identity.setupGrade,
      identitySetupKey:
        identity.identitySetupKey,
      candidateIdentityVersion:
        identity.candidateIdentityVersion,
      snapshotTime:
        identity.snapshotTime ||
        frozenSetup.snapshotTime,
    },

    symbol:
      identity.symbol,

    strategyId:
      identity.strategyId,

    timeframe,

    direction:
      identity.direction,

    setupType:
      identity.setupType,

    laneId:
      identity.laneId,

    setupClass:
      identity.setupClass,

    setupGrade:
      identity.setupGrade,

    identitySetupKey:
      identity.identitySetupKey,

    candidateIdentityVersion:
      identity.candidateIdentityVersion,

    strategy1Provenance,

    accountMode:
      accountModeFromPayload(
        ticket,
        order,
        result
      ),

    assetType,

    status: "OPEN",
    result: null,

    orderLink: {
      orderId:
        identity.orderId,
      idempotencyKey:
        identity.idempotencyKey,
      executionId:
        identity.executionId,
    },

    setup: {
      ...frozenSetup,

      snapshotTime:
        identity.snapshotTime ||
        frozenSetup.snapshotTime,

      candidateId:
        identity.candidateId,

      zoneId:
        identity.zoneId,

      planId:
        identity.planId ||
        openingPlan.planId,

      setupType:
        identity.setupType,

      laneId:
        identity.laneId,

      setupClass:
        identity.setupClass,

      setupGrade:
        identity.setupGrade,

      identitySetupKey:
        identity.identitySetupKey,

      candidateIdentityVersion:
        identity.candidateIdentityVersion,
    },

    openingPlan,

    riskBasis,

    entry: {
      time:
        eventTime,

      price:
        fillPrice,

      qty:
        fillQuantity,

      fillStatus:
        "FILLED",

      source:
        "ENGINE8_PAPER_FILL",

      orderType:
        toUpper(
          firstDefined(
            result?.orderType,
            order?.orderType,
            ticket?.orderType
          ) || "MARKET"
        ),

      executionId:
        identity.executionId,

      orderId:
        identity.orderId,

      idempotencyKey:
        identity.idempotencyKey,
    },

    option:
      assetType === "OPTION"
        ? {
            right:
              firstDefined(
                result?.option?.right,
                order?.option?.right,
                ticket?.option?.right
              ) ?? null,

            expiration:
              firstDefined(
                result?.option?.expiration,
                order?.option?.expiration,
                ticket?.option?.expiration
              ) ?? null,

            strike:
              toNumberOrNull(
                firstDefined(
                  result?.option?.strike,
                  order?.option?.strike,
                  ticket?.option?.strike
                )
              ),

            contractSymbol:
              firstDefined(
                result?.option?.contractSymbol,
                order?.option?.contractSymbol,
                ticket?.option?.contractSymbol
              ) ?? null,

            premiumEntry:
              fillPrice,
          }
        : null,

    events: [
      {
        eventType:
          "ENTRY_FILLED",

        ts:
          eventTime,

        tradeId,

        executionId:
          identity.executionId,

        idempotencyKey:
          identity.idempotencyKey,

        orderId:
          identity.orderId,

        price:
          fillPrice,

        qtyClosed:
          0,

        fillQuantity,

        remainingQty:
          fillQuantity,

        targetId:
          null,

        blockId:
          null,

        managementAction:
          null,

        exitReason:
          null,

        stopReason:
          null,

        reason:
          "ENTRY_FILLED",

        action:
          "NEW_ENTRY",

        source:
          "engine8_execution",

        eventRealizedPoints:
          null,

        eventRealizedPnL:
          null,

        pnlBasis:
          assetType === "OPTION"
            ? "OPTION_PREMIUM"
            : riskBasis?.dollarsPerPoint
              ? "FUTURES_CONTRACT"
              : "EQUITY_SHARE",
      },
    ],

    qty: {
      originalQty:
        fillQuantity,

      remainingQty:
        fillQuantity,

      cumulativeFilledQuantity:
        toNumberOrNull(
          firstDefined(
            result
              ?.cumulativeFilledQuantity,
            order
              ?.cumulativeFilledQuantity,
            ticket
              ?.cumulativeFilledQuantity
          )
        ) ??
        fillQuantity,

      cumulativeExitQuantity:
        0,
    },

    summary: {
      openTime:
        eventTime,

      closeTime:
        null,

      durationMinutes:
        null,

      realizedPnL:
        null,

      realizedPoints:
        null,

      realizedR:
        null,

      percentReturn:
        null,
    },

    review:
      baseReview(),

    createdAt:
      eventTime,

    updatedAt:
      eventTime,
  };

  trades.unshift(trade);
  writeJournalTrades(trades);

  return {
    ok: true,
    created: true,
    skipped: false,
    tradeId,
    status: "OPEN",
    remainingQty:
      fillQuantity,
    trade,
  };
}

export async function applyEngine8ExecutionToJournal({
  ticket = {},
  order = {},
  result = {},
}) {
  const action =
    getAction(
      ticket,
      order,
      result
    );

  if (action === "NEW_ENTRY") {
    return createTradeJournalEntryFromEngine8Fill({
      ticket,
      order,
      result,
    });
  }

  if (
    action !== "REDUCE" &&
    action !== "EXIT"
  ) {
    return {
      ok: true,
      updated: false,
      skipped: true,
      reason:
        "ACTION_NOT_HANDLED",
      action,
    };
  }

  const status =
    getFillStatus(
      ticket,
      order,
      result
    );

  if (status !== "FILLED") {
    return {
      ok: true,
      updated: false,
      skipped: true,
      reason:
        "ORDER_NOT_FILLED",
      action,
      status,
    };
  }

  const identity =
    getCanonicalIdentity(
      ticket,
      order,
      result
    );

  const trades =
    readJournalTrades();

  const trade =
    findTradeForLifecycleUpdate(
      trades,
      identity
    );

  if (!trade) {
    return {
      ok: false,
      updated: false,
      error:
        "OPEN_TRADE_NOT_FOUND_FOR_EXECUTION",
      action,
      tradeId:
        identity.tradeId,
      executionId:
        identity.executionId,
      symbol:
        identity.symbol,
      strategyId:
        identity.strategyId,
    };
  }

  const duplicateEvent =
    eventAlreadyRecorded(
      trade,
      identity
    );

  if (duplicateEvent) {
    return {
      ok: true,
      updated: false,
      skipped: true,
      reason:
        "EXECUTION_EVENT_ALREADY_RECORDED",
      tradeId:
        trade.tradeId,
      status:
        trade.status,
      remainingQty:
        toNumberOrNull(
          trade?.qty?.remainingQty
        ),
      eventType:
        duplicateEvent.eventType,
      trade,
    };
  }

  if (trade.status === "CLOSED") {
    return {
      ok: true,
      updated: false,
      skipped: true,
      reason:
        "TRADE_ALREADY_CLOSED",
      tradeId:
        trade.tradeId,
      status:
        "CLOSED",
      remainingQty:
        0,
      trade,
    };
  }

  const fillQuantity =
    getFillQuantity(
      ticket,
      order,
      result
    );

  if (
    !Number.isFinite(fillQuantity) ||
    fillQuantity <= 0
  ) {
    return {
      ok: false,
      updated: false,
      error:
        "INVALID_EXIT_FILL_QUANTITY",
      action,
      fillQuantity,
      tradeId:
        trade.tradeId,
    };
  }

  const closePrice =
    getExecutionPrice(
      ticket,
      order,
      result
    );

  const previousRemaining =
    toNumberOrNull(
      trade?.qty?.remainingQty
    ) ?? 0;

  const reportedRemaining =
    getReportedRemainingQuantity(
      ticket,
      order,
      result
    );

  const calculatedRemaining =
    Math.max(
      0,
      previousRemaining -
      fillQuantity
    );

  const nextRemaining =
    reportedRemaining !== null
      ? Math.max(
          0,
          reportedRemaining
        )
      : calculatedRemaining;

  if (
    fillQuantity >
    previousRemaining
  ) {
    return {
      ok: false,
      updated: false,
      error:
        "EXIT_QUANTITY_EXCEEDS_REMAINING_QUANTITY",
      tradeId:
        trade.tradeId,
      previousRemaining,
      fillQuantity,
    };
  }

  const eventTime =
    getEventTime(
      ticket,
      order,
      result
    );

  const management =
    resolveManagementEvent({
      action,
      ticket,
      order,
      result,
      remainingQty:
        nextRemaining,
    });

  const pnl =
    computeEventPnl({
      trade,
      closePrice,
      qtyClosed:
        fillQuantity,
    });

  trade.events =
    Array.isArray(trade.events)
      ? trade.events
      : [];

  trade.events.push({
    eventType:
      management.eventType,

    ts:
      eventTime,

    tradeId:
      trade.tradeId,

    executionId:
      identity.executionId,

    idempotencyKey:
      identity.idempotencyKey,

    orderId:
      identity.orderId,

    price:
      closePrice,

    qtyClosed:
      fillQuantity,

    fillQuantity,

    remainingQty:
      nextRemaining,

    targetId:
      management.targetId,

    blockId:
      management.blockId,

    managementAction:
      management.managementAction,

    exitReason:
      management.exitReason,

    stopReason:
      management.stopReason,

    reason:
      management.eventType,

    action,

    source:
      "engine8_execution",

    eventRealizedPoints:
      pnl.eventRealizedPoints,

    eventRealizedPnL:
      pnl.eventRealizedPnL,

    pnlBasis:
      pnl.pnlBasis,
  });

  appendRunnerArmedEvent({
    trade,
    eventTime,
    identity,
    management,
  });

  trade.qty =
    trade.qty || {};

  trade.qty.originalQty =
    toNumberOrNull(
      trade.qty.originalQty
    ) ??
    toNumberOrNull(
      trade?.entry?.qty
    ) ??
    previousRemaining;

  trade.qty.remainingQty =
    nextRemaining;

  trade.qty.cumulativeExitQuantity =
    round2(
      (
        toNumberOrNull(
          trade?.qty
            ?.cumulativeExitQuantity
        ) ?? 0
      ) +
      fillQuantity
    );

  updateSummary(trade);

  if (nextRemaining === 0) {
    trade.status =
      "CLOSED";

    trade.summary.closeTime =
      eventTime;

    trade.summary.durationMinutes =
      minutesBetweenIso(
        trade.summary.openTime ||
        trade.entry?.time,
        eventTime
      );

    trade.summary.percentReturn =
      null;

    trade.result =
      computeResultFromRealizedPnL(
        trade.summary.realizedPnL
      );

    const alreadyClosed =
      trade.events.some(
        (event) =>
          event?.eventType ===
          "TRADE_CLOSED"
      );

    if (!alreadyClosed) {
      trade.events.push({
        eventType:
          "TRADE_CLOSED",

        ts:
          eventTime,

        tradeId:
          trade.tradeId,

        executionId:
          identity.executionId,

        idempotencyKey:
          identity.idempotencyKey,

        orderId:
          identity.orderId,

        price:
          closePrice,

        qtyClosed:
          0,

        fillQuantity:
          0,

        remainingQty:
          0,

        targetId:
          management.targetId,

        blockId:
          management.blockId,

        managementAction:
          management.managementAction,

        exitReason:
          management.exitReason,

        stopReason:
          management.stopReason,

        reason:
          "TRADE_CLOSED",

        action:
          "CLOSE",

        source:
          "engine10_journal",

        eventRealizedPoints:
          null,

        eventRealizedPnL:
          null,

        pnlBasis:
          null,

        finalResult:
          trade.result,

        realizedPoints:
          trade.summary.realizedPoints,

        realizedPnL:
          trade.summary.realizedPnL,

        realizedR:
          trade.summary.realizedR,
      });
    }
  } else {
    trade.status =
      "OPEN";

    trade.result =
      null;
  }

  if (
    trade.assetType === "OPTION" &&
    trade.option
  ) {
    const latestClosePrice =
      toNumberOrNull(closePrice);

    if (
      latestClosePrice !== null
    ) {
      trade.option.premiumLastExit =
        latestClosePrice;
    }
  }

  trade.updatedAt =
    eventTime;

  writeJournalTrades(trades);

  return {
    ok: true,
    updated: true,
    skipped: false,
    tradeId:
      trade.tradeId,
    status:
      trade.status,
    remainingQty:
      nextRemaining,
    eventType:
      management.eventType,
    journalCompleted:
      trade.status === "CLOSED" &&
      nextRemaining === 0,
    trade,
  };
}
