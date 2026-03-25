import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const JOURNAL_FILE = path.resolve(DATA_DIR, "trade-journal.json");
const SNAPSHOT_FILE = path.resolve(DATA_DIR, "strategy-snapshot.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function clone(v) {
  if (v == null) return v;
  return JSON.parse(JSON.stringify(v));
}

function toUpper(v) {
  return String(v || "").trim().toUpperCase();
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeSymbol(sym) {
  return String(sym || "").trim().toUpperCase();
}

function strategyTimeframe(strategyId, explicitTf) {
  const tf = String(explicitTf || "").trim();
  if (tf) return tf;

  const id = String(strategyId || "").trim();
  const at = id.split("@")[1];
  return at || "";
}

function directionFromSide(side) {
  const s = toUpper(side);

  if (s === "BUY" || s === "BUY_TO_OPEN") return "LONG";
  if (s === "SELL_SHORT" || s === "SELL_TO_OPEN") return "SHORT";

  return null;
}

function directionFromTicket(ticket, order) {
  const bias = String(ticket?.engine5?.bias || "").trim().toLowerCase();
  if (bias === "long") return "LONG";
  if (bias === "short") return "SHORT";

  return directionFromSide(ticket?.side) || directionFromSide(order?.side) || "UNKNOWN";
}

function accountModeFromTicket(ticket, order) {
  const paper = order?.paper === true || ticket?.paper !== false;
  return paper ? "PAPER" : "LIVE";
}

function getAction(ticket, order, result) {
  const a =
    toUpper(order?.action) ||
    toUpper(result?.action) ||
    toUpper(ticket?.action);

  if (a) return a;

  const side = toUpper(ticket?.side || order?.side);
  const exitLike = side.includes("SELL") || side.includes("CLOSE") || side.includes("EXIT");
  return exitLike ? "EXIT" : "NEW_ENTRY";
}

function getEventTime(order, result) {
  return order?.filledAt || result?.filledAt || order?.ts || result?.ts || nowIso();
}

function getEntryQty(order, result, ticket) {
  const n =
    toNumberOrNull(order?.filledQty) ??
    toNumberOrNull(result?.filledQty) ??
    toNumberOrNull(order?.qty) ??
    toNumberOrNull(ticket?.qty);

  return Number.isFinite(n) ? n : 0;
}

function getEntryPrice(order, result, ticket) {
  return (
    toNumberOrNull(order?.avgPrice) ??
    toNumberOrNull(result?.avgPrice) ??
    toNumberOrNull(order?.option?.midPrice) ??
    toNumberOrNull(result?.option?.midPrice) ??
    toNumberOrNull(ticket?.option?.midPrice) ??
    toNumberOrNull(order?.intendedMidpoint) ??
    toNumberOrNull(ticket?.entry?.intendedMidpoint) ??
    null
  );
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
    id: zone?.id ?? null,
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
    (strategyNode?.context?.active?.negotiated ? "NEGOTIATED" : null) ||
    (strategyNode?.context?.active?.institutional ? "INSTITUTIONAL" : null) ||
    (strategyNode?.context?.active?.shelf ? "SHELF" : null) ||
    "UNKNOWN"
  );
}

function buildFrozenSetup(strategySnapshot, strategyId) {
  const snapshotTime = strategySnapshot?.now || nowIso();
  const strategyNode = strategySnapshot?.strategies?.[strategyId] || null;

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
    action: strategyNode?.engine15Decision?.action || "UNKNOWN",
    executionBias:
      strategyNode?.engine15Decision?.executionBias ||
      strategyNode?.executionBias ||
      "UNKNOWN",
    qualityScore,
    qualityGrade,
    permission,
    sizeMultiplier,
    zoneType: zoneTypeFromStrategyNode(strategyNode),
    activeZone: activeZoneFromStrategyNode(strategyNode),
    engine15Decision: clone(strategyNode?.engine15Decision || null),
    engine15: clone(strategyNode?.engine15 || null),
    permissionRaw: clone(strategyNode?.permission || null),
    engine6v2: clone(strategyNode?.engine6v2 || null),
    confluence: clone(strategyNode?.confluence || null),
    engine16: clone(strategyNode?.engine16 || strategySnapshot?.engine16 || null),
    momentum: clone(strategyNode?.momentum || strategySnapshot?.momentum || null),
    context: clone(strategyNode?.context || null),
  };
}

function readStrategySnapshot() {
  return readJson(SNAPSHOT_FILE, {
    ok: false,
    now: nowIso(),
    strategies: {},
  });
}

function makeTradeId({ symbol, strategyId, eventTime }) {
  const safeSymbol = normalizeSymbol(symbol) || "UNK";
  const safeStrategy = String(strategyId || "unknown")
    .replace(/[^a-zA-Z0-9@_-]/g, "-")
    .replace(/@/g, "_");
  const safeTime = String(eventTime || nowIso()).replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(2).toString("hex");

  return `TRD-${safeSymbol}-${safeStrategy}-${safeTime}-${suffix}`;
}

function readJournalTrades() {
  const trades = readJson(JOURNAL_FILE, []);
  return Array.isArray(trades) ? trades : [];
}

function writeJournalTrades(trades) {
  writeJson(JOURNAL_FILE, Array.isArray(trades) ? trades : []);
}

function findExistingTrade(trades, { orderId, idempotencyKey }) {
  return (
    trades.find(
      (t) =>
        t?.orderLink?.orderId === orderId ||
        t?.orderLink?.idempotencyKey === idempotencyKey
    ) || null
  );
}

function findOpenTradeForExecution(trades, ticket, order, result) {
  const symbol = normalizeSymbol(order?.symbol || ticket?.symbol || result?.symbol);
  const strategyId = String(order?.strategyId || ticket?.strategyId || result?.strategyId || "").trim();
  const direction =
    String(ticket?.engine5?.bias || "").trim().toLowerCase() ||
    String(result?.direction || "").trim().toLowerCase() ||
    "";

  const openTrades = trades.filter((t) => t?.status === "OPEN");

  let candidates = openTrades.filter(
    (t) =>
      normalizeSymbol(t?.symbol) === symbol &&
      String(t?.strategyId || "").trim() === strategyId
  );

  if (direction === "long" || direction === "short") {
    candidates = candidates.filter(
      (t) => String(t?.direction || "").trim().toUpperCase() === direction.toUpperCase()
    );
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const ta = Date.parse(a?.createdAt || 0) || 0;
    const tb = Date.parse(b?.createdAt || 0) || 0;
    return tb - ta;
  });

  return candidates[0];
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

function minutesBetweenIso(startIso, endIso) {
  const a = Date.parse(startIso || "");
  const b = Date.parse(endIso || "");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 60000));
}

function computeResultFromRealizedPnL(realizedPnL) {
  const n = toNumberOrNull(realizedPnL);
  if (n == null) return null;
  if (n > 0) return "WIN";
  if (n < 0) return "LOSS";
  return "BREAKEVEN";
}

function buildExitEventType(action, remainingQty) {
  const a = toUpper(action);
  if (a === "REDUCE") return "PARTIAL_CLOSE";
  if (a === "EXIT" && remainingQty === 0) return "FULL_CLOSE";
  if (a === "EXIT") return "UNKNOWN_EXIT";
  return "UNKNOWN_EXIT";
}

export async function listTrades(filters = {}) {
  let trades = readJournalTrades();

  const symbol = normalizeSymbol(filters?.symbol);
  const strategyId = String(filters?.strategyId || "").trim();
  const status = toUpper(filters?.status);
  const accountMode = toUpper(filters?.accountMode);

  if (symbol) {
    trades = trades.filter((t) => normalizeSymbol(t?.symbol) === symbol);
  }

  if (strategyId) {
    trades = trades.filter((t) => String(t?.strategyId || "") === strategyId);
  }

  if (status) {
    trades = trades.filter((t) => toUpper(t?.status) === status);
  }

  if (accountMode) {
    trades = trades.filter((t) => toUpper(t?.accountMode) === accountMode);
  }

  trades.sort((a, b) => {
    const ta = Date.parse(a?.createdAt || 0) || 0;
    const tb = Date.parse(b?.createdAt || 0) || 0;
    return tb - ta;
  });

  return { ok: true, trades };
}

export async function getTradeById(tradeId) {
  const trades = readJournalTrades();
  const trade = trades.find((t) => String(t?.tradeId) === String(tradeId)) || null;

  if (!trade) {
    return { ok: false, error: "TRADE_NOT_FOUND", tradeId };
  }

  return { ok: true, trade };
}

export async function createTradeJournalEntryFromEngine8Fill({
  ticket,
  order,
  result,
}) {
  const action = getAction(ticket, order, result);

  if (action !== "NEW_ENTRY") {
    return {
      ok: true,
      created: false,
      skipped: true,
      reason: "NOT_OPENING_FILL",
      action,
    };
  }

  const status = toUpper(order?.status || result?.status);
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

  const trades = readJournalTrades();
  const orderId = String(order?.orderId || result?.orderId || "").trim();
  const idempotencyKey = String(
    order?.idempotencyKey || result?.idempotencyKey || ticket?.idempotencyKey || ""
  ).trim();

  const existing = findExistingTrade(trades, { orderId, idempotencyKey });
  if (existing) {
    return {
      ok: true,
      created: false,
      skipped: true,
      reason: "TRADE_ALREADY_RECORDED",
      tradeId: existing.tradeId,
    };
  }

  const symbol = normalizeSymbol(order?.symbol || ticket?.symbol);
  const strategyId = String(order?.strategyId || ticket?.strategyId || "").trim();
  const eventTime = getEventTime(order, result);
  const qty = getEntryQty(order, result, ticket);
  const price = getEntryPrice(order, result, ticket);
  const direction = directionFromTicket(ticket, order);
  const timeframe = strategyTimeframe(strategyId, order?.timeframe || ticket?.timeframe);
  const accountMode = accountModeFromTicket(ticket, order);
  const assetType = toUpper(order?.assetType || ticket?.assetType || "EQUITY");

  const snapshot = readStrategySnapshot();
  const frozenSetup = buildFrozenSetup(snapshot, strategyId);

  const tradeId = makeTradeId({ symbol, strategyId, eventTime });

  const trade = {
    tradeId,
    symbol,
    strategyId,
    timeframe,
    direction,
    accountMode,
    assetType,
    status: "OPEN",
    result: null,

    orderLink: {
      orderId: orderId || null,
      idempotencyKey: idempotencyKey || null,
    },

    setup: frozenSetup,

    entry: {
      time: eventTime,
      price,
      qty,
      fillStatus: "FILLED",
      source: "ENGINE8_PAPER_FILL",
      orderType: toUpper(order?.orderType || ticket?.orderType || "MARKET"),
      orderId: orderId || null,
      idempotencyKey: idempotencyKey || null,
    },

    option:
      assetType === "OPTION"
        ? {
            right: order?.option?.right ?? ticket?.option?.right ?? null,
            expiration: order?.option?.expiration ?? ticket?.option?.expiration ?? null,
            strike: toNumberOrNull(order?.option?.strike ?? ticket?.option?.strike),
            contractSymbol:
              order?.option?.contractSymbol ?? ticket?.option?.contractSymbol ?? null,
            premiumEntry:
              toNumberOrNull(order?.avgPrice) ??
              toNumberOrNull(order?.option?.midPrice) ??
              toNumberOrNull(ticket?.option?.midPrice) ??
              null,
          }
        : null,

    events: [
      {
        eventType: "ENTRY_FILLED",
        ts: eventTime,
        price,
        qtyClosed: 0,
        remainingQty: qty,
        reason: "ENTRY_FILLED",
        action: "NEW_ENTRY",
        source: "engine8_execution",
      },
    ],

    qty: {
      originalQty: qty,
      remainingQty: qty,
    },

    summary: {
      openTime: eventTime,
      closeTime: null,
      durationMinutes: null,
      realizedPnL: null,
      realizedPoints: null,
      realizedR: null,
      percentReturn: null,
    },

    review: baseReview(),

    createdAt: eventTime,
    updatedAt: eventTime,
  };

  trades.unshift(trade);
  writeJournalTrades(trades);

  return {
    ok: true,
    created: true,
    tradeId,
    trade,
  };
}

export async function applyEngine8ExecutionToJournal({
  ticket,
  order,
  result,
}) {
  const action = getAction(ticket, order, result);

  if (action === "NEW_ENTRY") {
    return createTradeJournalEntryFromEngine8Fill({ ticket, order, result });
  }

  if (action !== "REDUCE" && action !== "EXIT") {
    return {
      ok: true,
      updated: false,
      skipped: true,
      reason: "ACTION_NOT_HANDLED",
      action,
    };
  }

  const status = toUpper(order?.status || result?.status);
  if (status !== "FILLED") {
    return {
      ok: true,
      updated: false,
      skipped: true,
      reason: "ORDER_NOT_FILLED",
      action,
      status,
    };
  }

  const trades = readJournalTrades();
  const trade = findOpenTradeForExecution(trades, ticket, order, result);

  if (!trade) {
    return {
      ok: false,
      updated: false,
      error: "OPEN_TRADE_NOT_FOUND_FOR_EXECUTION",
      action,
      symbol: order?.symbol || ticket?.symbol || null,
      strategyId: order?.strategyId || ticket?.strategyId || null,
    };
  }

  const qtyClosed =
    toNumberOrNull(order?.filledQty) ??
    toNumberOrNull(result?.filledQty) ??
    toNumberOrNull(order?.qty) ??
    toNumberOrNull(ticket?.qty) ??
    0;

  const closePrice =
    toNumberOrNull(order?.avgPrice) ??
    toNumberOrNull(result?.avgPrice) ??
    toNumberOrNull(order?.option?.midPrice) ??
    toNumberOrNull(result?.option?.midPrice) ??
    toNumberOrNull(ticket?.option?.midPrice) ??
    toNumberOrNull(order?.intendedMidpoint) ??
    toNumberOrNull(ticket?.entry?.intendedMidpoint) ??
    null;

  const prevRemaining = toNumberOrNull(trade?.qty?.remainingQty) ?? 0;
  const nextRemaining = Math.max(0, prevRemaining - qtyClosed);
  const eventTime = getEventTime(order, result);

  const eventType = buildExitEventType(action, nextRemaining);
  const reason =
    eventType === "PARTIAL_CLOSE"
      ? "PARTIAL_CLOSE"
      : eventType === "FULL_CLOSE"
        ? "FULL_CLOSE"
        : "UNKNOWN_EXIT";

  trade.events = Array.isArray(trade.events) ? trade.events : [];
  trade.events.push({
    eventType,
    ts: eventTime,
    price: closePrice,
    qtyClosed,
    remainingQty: nextRemaining,
    reason,
    action,
    source: "engine8_execution",
  });

  trade.qty = trade.qty || {};
  trade.qty.originalQty =
    toNumberOrNull(trade.qty.originalQty) ??
    toNumberOrNull(trade.entry?.qty) ??
    prevRemaining;
  trade.qty.remainingQty = nextRemaining;

  const entryPrice = toNumberOrNull(trade?.entry?.price);
  let realizedPoints = toNumberOrNull(trade?.summary?.realizedPoints) ?? 0;

  if (entryPrice != null && closePrice != null && qtyClosed > 0) {
    const dir = String(trade?.direction || "").toUpperCase();
    const priceDelta =
      dir === "SHORT"
        ? entryPrice - closePrice
        : closePrice - entryPrice;

    realizedPoints += priceDelta * qtyClosed;
  }

  trade.summary = trade.summary || {};
  trade.summary.realizedPoints = realizedPoints;

  if (nextRemaining === 0) {
    trade.status = "CLOSED";
    trade.summary.closeTime = eventTime;
    trade.summary.durationMinutes = minutesBetweenIso(trade.summary.openTime, eventTime);
    trade.summary.realizedPnL = realizedPoints;
    trade.summary.percentReturn = null;
    trade.summary.realizedR = null;
    trade.result = computeResultFromRealizedPnL(realizedPoints);
  } else {
    trade.status = "OPEN";
  }

  trade.updatedAt = eventTime;

  writeJournalTrades(trades);

  return {
    ok: true,
    updated: true,
    tradeId: trade.tradeId,
    status: trade.status,
    remainingQty: nextRemaining,
    eventType,
    trade,
  };
}
