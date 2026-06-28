// services/core/logic/engine26/paperTradePlanner.js

const ENGINE = "engine26.paperTradePlanner.v1";
const MODE = "PAPER_ONLY";
const STRATEGY_ID = "intraday_scalp@10m";
const SYMBOL = "ES";
const TICK_SIZE_ES = 0.25;

function nowIso() {
  return new Date().toISOString();
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToTick(value, tick = TICK_SIZE_ES) {
  const n = toNum(value);
  if (n == null) return null;
  return Number((Math.round(n / tick) * tick).toFixed(2));
}

function roundPts(value) {
  const n = toNum(value);
  if (n == null) return null;
  return Number(n.toFixed(2));
}

function safeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function safeString(value) {
  return String(value || "").trim();
}

function sanitizeKeyPart(value) {
  return String(value || "UNKNOWN")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9@_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getEngine8Allowlist() {
  return String(process.env.ENGINE8_ALLOWLIST || "SPY,QQQ")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function makeNoTrade({
  symbol,
  strategyId,
  tf,
  status = "NO_PAPER_TRADE",
  blockers = [],
  warnings = [],
  reasonCodes = [],
  context = {},
}) {
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
  const uniqueReasonCodes = [...new Set(reasonCodes.filter(Boolean))];

  return {
    active: false,
    engine: ENGINE,
    mode: MODE,
    researchOnly: true,

    symbol: safeUpper(symbol),
    strategyId,
    tf,

    allowed: false,
    status,

    setupFamily: "IMBALANCE_TO_IMBALANCE_SCALP",
    setupType: context?.setupType || null,
    direction: context?.direction || "NONE",

    engine26PaperTradeTicket: null,
    paperTradeTicket: null,

    noRealExecution: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    requiresEngine8Paper: true,
    requiresEngine10Journal: true,

    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    reasonCodes: uniqueReasonCodes.length
      ? uniqueReasonCodes
      : uniqueBlockers.length
      ? uniqueBlockers
      : ["NO_PAPER_TRADE"],

    engineContext: context?.engineContext || null,
    createdAt: nowIso(),
  };
}

function getCurrentLevelAction(confluence) {
  return confluence?.context?.reaction?.currentLevelAction || null;
}

function getPaperScalpReaction(confluence) {
  return confluence?.context?.reaction?.paperScalpReaction || null;
}

function getPaperScalpParticipation(confluence) {
  return (
    confluence?.context?.volume?.engine22LifecycleParticipation
      ?.paperScalpParticipation || null
  );
}

function getLifecycleParticipation(confluence) {
  return confluence?.context?.volume?.engine22LifecycleParticipation || null;
}

function getCurrentPrice({
  permission,
  engine15Decision,
  engine22WaveStrategy,
  confluence,
}) {
  return roundToTick(
    permission?.paper?.currentPrice ??
      engine15Decision?.paperScalpReadiness?.currentPrice ??
      engine15Decision?.currentPrice ??
      engine22WaveStrategy?.currentLifecycleState?.confirmationContext?.reference
        ?.currentPrice ??
      engine22WaveStrategy?.currentLifecycleState?.currentPrice ??
      getCurrentLevelAction(confluence)?.currentPrice ??
      confluence?.price
  );
}

function getDirection({ permission, engine15Decision, engine22WaveStrategy }) {
  return safeUpper(
    permission?.paper?.direction ||
      engine15Decision?.paperScalpReadiness?.direction ||
      engine15Decision?.direction ||
      engine22WaveStrategy?.currentLifecycleState?.direction ||
      "NONE"
  );
}

function getSetupType({ permission, engine15Decision, engine22WaveStrategy }) {
  return (
    safeString(permission?.paper?.setupType) ||
    safeString(engine15Decision?.paperScalpReadiness?.setupType) ||
    safeString(engine22WaveStrategy?.currentLifecycleState?.key) ||
    safeString(engine22WaveStrategy?.waveOpportunity?.setupType) ||
    "UNKNOWN_SETUP"
  );
}

function getReferenceLevel(confluence) {
  const currentLevelAction = getCurrentLevelAction(confluence);
  const paperScalpReaction = getPaperScalpReaction(confluence);

  return roundToTick(
    paperScalpReaction?.referenceLevel ??
      currentLevelAction?.referenceLevel ??
      currentLevelAction?.level ??
      currentLevelAction?.zone?.mid ??
      currentLevelAction?.reference?.level
  );
}

function getReferenceType(confluence) {
  const currentLevelAction = getCurrentLevelAction(confluence);
  const paperScalpReaction = getPaperScalpReaction(confluence);

  return (
    safeString(paperScalpReaction?.referenceType) ||
    safeString(currentLevelAction?.referenceType) ||
    safeString(currentLevelAction?.zoneType) ||
    "REFERENCE"
  );
}

function getZoneId({ engine25Context, confluence, engine22WaveStrategy }) {
  const nearestZone =
    engine25Context?.esPermission?.nearestZone ||
    engine25Context?.zoneAwareRead?.nearestZone ||
    engine25Context?.nearestZone ||
    null;

  const activeZone = confluence?.context?.activeZone || null;
  const referenceLevel = getReferenceLevel(confluence);
  const referenceType = getReferenceType(confluence);

  return (
    safeString(nearestZone?.id) ||
    safeString(activeZone?.id) ||
    (referenceLevel != null
      ? `REFERENCE_${sanitizeKeyPart(referenceType)}_${sanitizeKeyPart(
          referenceLevel
        )}`
      : null) ||
    safeString(engine22WaveStrategy?.currentLifecycleState?.key) ||
    "UNKNOWN_ZONE"
  );
}

function getBarTime({ confluence }) {
  const currentLevelAction = getCurrentLevelAction(confluence);

  const raw =
    currentLevelAction?.lastCandle?.time ??
    currentLevelAction?.lastCandle?.t ??
    currentLevelAction?.lastCandle?.tSec ??
    currentLevelAction?.priorCandle?.time ??
    currentLevelAction?.priorCandle?.t ??
    currentLevelAction?.priorCandle?.tSec ??
    Math.floor(Date.now() / 1000);

  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : Math.floor(Date.now() / 1000);
}

function getStopPrice({ direction, engine15Decision, confluence, engine25Context }) {
  const riskModel = engine15Decision?.paperScalpReadiness?.riskModel || {};
  const directStop =
    toNum(riskModel?.stopLevel) ?? toNum(riskModel?.invalidationLevel);

  if (directStop != null) return roundToTick(directStop);

  const referenceLevel = getReferenceLevel(confluence);
  if (referenceLevel != null) {
    if (direction === "LONG") return roundToTick(referenceLevel - 2);
    if (direction === "SHORT") return roundToTick(referenceLevel + 2);
  }

  const nearestZone =
    engine25Context?.esPermission?.nearestZone ||
    engine25Context?.zoneAwareRead?.nearestZone ||
    engine25Context?.nearestZone ||
    null;

  const lo = toNum(nearestZone?.lo);
  const hi = toNum(nearestZone?.hi);

  if (direction === "LONG" && lo != null) return roundToTick(lo - 1);
  if (direction === "SHORT" && hi != null) return roundToTick(hi + 1);

  return null;
}

function getTargetPrice({
  direction,
  entryPrice,
  engine15Decision,
  permission,
  engine22WaveStrategy,
  engine25Context,
}) {
  const targetModel = engine15Decision?.paperScalpReadiness?.targetModel || {};

  const directTarget =
    toNum(targetModel?.targetLevel) ??
    toNum(permission?.paper?.targetLevel) ??
    toNum(engine22WaveStrategy?.currentLifecycleState?.confirmationContext?.targetLevel);

  if (directTarget != null) return roundToTick(directTarget);

  const targetPoints =
    toNum(permission?.paper?.targetPoints) ??
    toNum(targetModel?.desiredPoints) ??
    10;

  const nearestOpposingZone =
    engine25Context?.nearestOpposingZone ||
    engine25Context?.zoneAwareRead?.nearestOpposingZone ||
    null;

  const opposingLo = toNum(nearestOpposingZone?.lo);
  const opposingHi = toNum(nearestOpposingZone?.hi);

  if (direction === "LONG" && opposingLo != null) return roundToTick(opposingLo);
  if (direction === "SHORT" && opposingHi != null) return roundToTick(opposingHi);

  if (entryPrice == null) return null;

  if (direction === "LONG") return roundToTick(entryPrice + targetPoints);
  if (direction === "SHORT") return roundToTick(entryPrice - targetPoints);

  return null;
}

function hasCleanTargetPath({ direction, entryPrice, targetPrice, engine15Decision }) {
  const targetModel = engine15Decision?.paperScalpReadiness?.targetModel || {};
  const blockers = Array.isArray(engine15Decision?.paperScalpReadiness?.blockers)
    ? engine15Decision.paperScalpReadiness.blockers
    : [];

  if (blockers.includes("NO_CLEAN_PATH_TO_TARGET")) return false;

  if (targetModel?.targetPathRequired === true && targetModel?.targetLevel == null) {
    return false;
  }

  if (entryPrice == null || targetPrice == null) return false;

  if (direction === "LONG") return targetPrice > entryPrice;
  if (direction === "SHORT") return targetPrice < entryPrice;

  return false;
}

function buildPaperExitPlan({ direction, entryPrice }) {
  const sign = direction === "SHORT" ? -1 : 1;

  const block1Target = roundToTick(entryPrice + sign * 3.5);
  const block2Target = roundToTick(entryPrice + sign * 6.5);
  const block3Target = roundToTick(entryPrice + sign * 10);

  return {
    source: "paperExitPlanV0",
    exitPlanSource: "paperExitPlanV0",
    engine9Compatible: true,
    futureOwner: "Engine 9",
    exitModel: "THREE_BLOCKS",
    targetPoints: 10,

    block1: {
      targetPrice: block1Target,
      targetPts: 3.5,
      sizePct: 33,
    },
    block2: {
      targetPrice: block2Target,
      targetPts: 6.5,
      sizePct: 33,
    },
    block3: {
      targetPrice: block3Target,
      targetPts: 10,
      sizePct: 34,
    },
  };
}

function buildSizing() {
  return {
    source: "paperSizingV0",
    engine7Compatible: true,
    qty: 1,
    notes:
      "Paper-only fixed-size v1 until Engine 7 paper sizing and Engine 8/10 partial exits are defined.",
  };
}

function buildIdempotencyKey({
  symbol,
  strategyId,
  direction,
  setupType,
  zoneId,
  barTime,
}) {
  return [
    sanitizeKeyPart(symbol),
    sanitizeKeyPart(strategyId),
    MODE,
    sanitizeKeyPart(direction),
    sanitizeKeyPart(setupType),
    sanitizeKeyPart(zoneId),
    sanitizeKeyPart(barTime),
  ].join(":");
}

function isDuplicateOpenTrade({
  openPaperTrades,
  symbol,
  strategyId,
  direction,
  setupType,
  zoneId,
}) {
  const trades = Array.isArray(openPaperTrades) ? openPaperTrades : [];

  const expectedSymbol = safeUpper(symbol);
  const expectedStrategyId = safeString(strategyId);
  const expectedDirection = safeUpper(direction);
  const expectedSetupType = safeString(setupType);
  const expectedZoneId = safeString(zoneId);

  return trades.some((trade) => {
    const tradeSymbol = safeUpper(trade?.symbol);
    const tradeStrategyId = safeString(trade?.strategyId);
    const tradeDirection = safeUpper(trade?.direction);
    const tradeStatus = safeUpper(trade?.status);
    const tradeAccountMode = safeUpper(trade?.accountMode);

    const setup =
      trade?.setup?.engine26 ||
      trade?.setup?.paperTradePlan ||
      trade?.setup ||
      {};

    const tradeSetupType =
      safeString(setup?.setupType) ||
      safeString(trade?.signalEvent?.setupType) ||
      safeString(trade?.entry?.setupType);

    const tradeZoneId =
      safeString(setup?.zoneId) ||
      safeString(setup?.activeZone?.id) ||
      safeString(trade?.signalEvent?.zoneId);

    const sameBase =
      tradeSymbol === expectedSymbol &&
      tradeStrategyId === expectedStrategyId &&
      tradeDirection === expectedDirection &&
      tradeStatus === "OPEN" &&
      tradeAccountMode === "PAPER";

    if (!sameBase) return false;

    if (tradeSetupType && tradeZoneId) {
      return tradeSetupType === expectedSetupType && tradeZoneId === expectedZoneId;
    }

    return true;
  });
}

function buildEngineContext({
  engine22WaveStrategy,
  confluence,
  engine15Decision,
  permission,
  engine25Context,
}) {
  return {
    engine22: {
      currentLifecycleState: engine22WaveStrategy?.currentLifecycleState || null,
      waveOpportunity: engine22WaveStrategy?.waveOpportunity || null,
      tradeDecision: engine22WaveStrategy?.tradeDecision || null,
    },
    engine3: {
      currentLevelAction: getCurrentLevelAction(confluence),
      paperScalpReaction: getPaperScalpReaction(confluence),
    },
    engine4: {
      engine22LifecycleParticipation: getLifecycleParticipation(confluence),
      paperScalpParticipation: getPaperScalpParticipation(confluence),
    },
    engine15: {
      paperScalpReadiness: engine15Decision?.paperScalpReadiness || null,
      decision: engine15Decision || null,
    },
    engine6: {
      permission: permission || null,
      paper: permission?.paper || null,
    },
    engine25: engine25Context || null,
  };
}

export function buildEngine26PaperTradePlan({
  symbol,
  strategyId,
  tf,
  permission,
  engine22WaveStrategy,
  engine25Context,
  confluence,
  engine15Decision,
  openPaperTrades = [],
}) {
  const normalizedSymbol = safeUpper(symbol);
  const normalizedStrategyId = safeString(strategyId);
  const normalizedTf = safeString(tf || "10m");

  const paper = permission?.paper || null;

  const engineContext = buildEngineContext({
    engine22WaveStrategy,
    confluence,
    engine15Decision,
    permission,
    engine25Context,
  });

  const blockers = [];
  const warnings = [];
  const reasonCodes = [
    "PAPER_ONLY_RESEARCH_LANE",
    "ENGINE26_PLANNER_ONLY_V1",
    "NO_ENGINE8_CALL_IN_SNAPSHOT_BUILD",
    "NO_REAL_EXECUTION",
  ];

  if (normalizedSymbol !== SYMBOL) blockers.push("SYMBOL_NOT_ES");
  if (normalizedStrategyId !== STRATEGY_ID) {
    blockers.push("STRATEGY_NOT_INTRADAY_SCALP_10M");
  }

  if (!paper || typeof paper !== "object") {
    blockers.push("MISSING_PERMISSION_PAPER");
  } else {
    if (paper.allowed !== true) blockers.push("PAPER_PERMISSION_NOT_ALLOWED");
    if (paper.mode !== MODE) blockers.push("PAPER_PERMISSION_NOT_PAPER_ONLY");
    if (paper.decision !== "PAPER_ALLOW") {
      if (paper.decision === "PAPER_REDUCE") {
        warnings.push("PAPER_REDUCE_NO_TICKET_IN_V1");
      }
      blockers.push("PAPER_PERMISSION_NOT_ALLOWED");
    }
    if (paper.realExecutionAllowed !== false) {
      blockers.push("PAPER_PERMISSION_REAL_EXECUTION_TRUE");
    }
    if (paper.requiresEngine8Paper !== true) {
      blockers.push("PAPER_PERMISSION_MISSING_ENGINE8_REQUIREMENT");
    }
    if (paper.requiresEngine10Journal !== true) {
      blockers.push("PAPER_PERMISSION_MISSING_ENGINE10_REQUIREMENT");
    }
  }

  if (!engine22WaveStrategy?.currentLifecycleState) {
    blockers.push("MISSING_ENGINE22_CONTEXT");
  }

  if (!engine15Decision?.paperScalpReadiness) {
    blockers.push("MISSING_ENGINE15_PAPER_READINESS");
  }

  const direction = getDirection({
    permission,
    engine15Decision,
    engine22WaveStrategy,
  });

  const setupType = getSetupType({
    permission,
    engine15Decision,
    engine22WaveStrategy,
  });

  if (!direction || direction === "NONE") blockers.push("DIRECTION_NONE");

  const paperShortResearchEnabled =
    paper?.paperShortResearchEnabled === true || paper?.paperShortAllowed === true;

  if (direction === "SHORT" && !paperShortResearchEnabled) {
    blockers.push("PAPER_SHORTS_DISABLED");
  }

  const currentPrice = getCurrentPrice({
    permission,
    engine15Decision,
    engine22WaveStrategy,
    confluence,
  });

  const entryPrice = roundToTick(currentPrice);

  if (entryPrice == null) blockers.push("MISSING_CURRENT_PRICE");

  const stopPrice = getStopPrice({
    direction,
    engine15Decision,
    confluence,
    engine25Context,
  });

  if (stopPrice == null) blockers.push("NO_DEFINED_STOP_OR_INVALIDATION");

  const targetPrice = getTargetPrice({
    direction,
    entryPrice,
    engine15Decision,
    permission,
    engine22WaveStrategy,
    engine25Context,
  });

  const cleanTargetPath = hasCleanTargetPath({
    direction,
    entryPrice,
    targetPrice,
    engine15Decision,
  });

  if (!cleanTargetPath) blockers.push("NO_CLEAN_PATH_TO_TARGET");

  const zoneId = getZoneId({
    engine25Context,
    confluence,
    engine22WaveStrategy,
  });

  const duplicateOpen = isDuplicateOpenTrade({
    openPaperTrades,
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    direction,
    setupType,
    zoneId,
  });

  if (duplicateOpen) blockers.push("DUPLICATE_PAPER_TRADE_OPEN");

  const allowlist = getEngine8Allowlist();
  if (!allowlist.includes(normalizedSymbol)) {
    blockers.push("ENGINE8_ES_NOT_ALLOWLISTED");
  }

  const hasContractMismatch =
    paper?.decision === "PAPER_ALLOW" &&
    blockers.some((code) =>
      [
        "PAPER_PERMISSION_REAL_EXECUTION_TRUE",
        "PAPER_PERMISSION_MISSING_ENGINE8_REQUIREMENT",
        "PAPER_PERMISSION_MISSING_ENGINE10_REQUIREMENT",
        "MISSING_ENGINE22_CONTEXT",
        "MISSING_ENGINE15_PAPER_READINESS",
        "NO_DEFINED_STOP_OR_INVALIDATION",
        "NO_CLEAN_PATH_TO_TARGET",
        "MISSING_CURRENT_PRICE",
      ].includes(code)
    );

  if (hasContractMismatch) {
    blockers.push("CONTRACT_MISMATCH");
  }

  const baseContext = {
    setupType,
    direction,
    engineContext,
  };

  if (blockers.length) {
    const status = blockers.includes("ENGINE8_ES_NOT_ALLOWLISTED")
      ? "BLOCKED_ENGINE8_ES_NOT_ALLOWLISTED"
      : "NO_PAPER_TRADE";

    return {
      engine26PaperTradePlan: makeNoTrade({
        symbol: normalizedSymbol,
        strategyId: normalizedStrategyId,
        tf: normalizedTf,
        status,
        blockers,
        warnings,
        reasonCodes: [...reasonCodes, ...blockers],
        context: baseContext,
      }),
      engine26PaperTradeTicket: null,
      engine26PaperTradeExecution: null,
    };
  }

  const sizing = buildSizing();
  const paperExitPlan = buildPaperExitPlan({
    direction,
    entryPrice,
  });

  const barTime = getBarTime({ confluence });

  const idempotencyKey = buildIdempotencyKey({
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    direction,
    setupType,
    zoneId,
    barTime,
  });

  const targetPoints =
    direction === "SHORT"
      ? roundPts(entryPrice - targetPrice)
      : roundPts(targetPrice - entryPrice);

  const stopDistancePts =
    direction === "SHORT"
      ? roundPts(stopPrice - entryPrice)
      : roundPts(entryPrice - stopPrice);

  const ticket = {
    idempotencyKey,
    paper: true,
    mode: MODE,

    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    timeframe: normalizedTf,

    assetType: "FUTURE",
    intent: "ENTRY",
    action: "NEW_ENTRY",
    side: direction === "LONG" ? "BUY" : "SELL_SHORT",
    direction,
    qty: sizing.qty,

    entry: {
      price: entryPrice,
      intendedMidpoint: entryPrice,
    },

    stop: {
      price: stopPrice,
      reason: "Engine 26 paper scalp invalidation / stop level.",
    },

    takeProfit: {
      price: targetPrice,
      reason: "10-point imbalance-to-imbalance target model.",
    },

    paperExitPlan,

    engine6: permission,
    engine7: sizing,

    signalEvent: {
      setupFamily: "IMBALANCE_TO_IMBALANCE_SCALP",
      setupType,
      zoneId,
      signalPrice: entryPrice,
      direction,
      source: ENGINE,
    },

    noRealExecution: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
  };

  const plan = {
    active: true,
    engine: ENGINE,
    mode: MODE,
    researchOnly: true,

    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    tf: normalizedTf,

    allowed: true,
    status: "READY_TO_PAPER_EXECUTE",

    setupFamily: "IMBALANCE_TO_IMBALANCE_SCALP",
    setupType,
    direction,

    currentPrice: entryPrice,
    entryPrice,
    entryTrigger: "ENGINE6_PAPER_PERMISSION_APPROVED",

    stopPrice,
    invalidationLevel: stopPrice,
    stopReason: "Engine 26 paper scalp invalidation / stop level.",
    stopDistancePts,

    targetPrice,
    targetPoints,
    exitModel: "THREE_BLOCKS",

    targets: {
      block1: paperExitPlan.block1,
      block2: paperExitPlan.block2,
      block3: paperExitPlan.block3,
    },

    paperExitPlan,
    sizing,

    zoneId,
    barTime,
    idempotencyKey,

    noRealExecution: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    requiresEngine8Paper: true,
    requiresEngine10Journal: true,

    engineContext,

    blockers: [],
    warnings,
    reasonCodes: [
      ...reasonCodes,
      "ENGINE6_PAPER_PERMISSION_APPROVED",
      "IMBALANCE_TO_IMBALANCE_SCALP",
      "THREE_BLOCK_EXIT_MODEL",
      "ENGINE7_PAPER_SIZING_V0",
      "ENGINE9_COMPATIBLE_EXIT_PLAN_V0",
    ],

    createdAt: nowIso(),
  };

  return {
    engine26PaperTradePlan: plan,
    engine26PaperTradeTicket: ticket,
    engine26PaperTradeExecution: null,
  };
}
