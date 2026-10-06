// services/core/logic/engine26/createEngine8PaperTradeTicket.js

import { buildTradeGeometry } from "./tradeGeometryReader.js";

function nowStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function normalizeDirection(direction) {
  return String(direction || "").trim().toUpperCase();
}

function normalizeSymbol(symbol = "ES") {
  return String(symbol || "ES").trim().toUpperCase();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildIdempotencyKey({
  symbol,
  strategyId,
  direction,
  entryPrice,
  source = "BRIAN",
}) {
  return [
    source,
    normalizeSymbol(symbol),
    strategyId || "intraday_scalp@10m",
    normalizeDirection(direction),
    String(entryPrice),
    nowStamp(),
  ].join("|");
}

function buildBlocksFromGeometry(geometry, contracts = 3) {
  const blocks = geometry?.blocks || [];

  return blocks.map((block, index) => {
    const isRunner = block.label === "P3_RUNNER";

    return {
      blockId: isRunner ? "RUNNER" : block.label,
      role:
        block.label === "P1"
          ? "TP1"
          : block.label === "P2"
            ? "TP2"
            : "RUNNER",
      qty: index === 2 ? contracts - 2 : 1,
      targetPrice: block.targetPrice,
      stopPrice: block.stopPrice,
      rr: block.rr,
      rewardPoints: block.rewardPoints,
      riskPoints: block.riskPoints,
    };
  });
}

function createEngine8PaperTradeTicket(input = {}) {
  const {
    symbol = "ES",
    strategyId = "intraday_scalp@10m",
    direction,
    entryPrice,
    stopPrice,
    targets,
    contracts = 3,
    rawText = null,
    source = "BRIAN_MANUAL_HARD_SIGNAL",
    signalType = "ENGINE6_FORCED_PAPER_TRADE_TEST",
    permissionOverrideReason = "BRIAN_MANUAL_ENGINE_PIPELINE_TEST",
    engine6 = null,
    engine7 = null,
  } = input;

  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedDirection = normalizeDirection(direction);
  const safeContracts = Math.max(1, Number(contracts || 3));

  const geometry = buildTradeGeometry({
    symbol: normalizedSymbol,
    strategyId,
    direction: normalizedDirection,
    entryPrice,
    stopPrice,
    targets,
  });

  if (!geometry.valid) {
    return {
      ok: false,
      ticket: null,
      geometry,
      rejected: true,
      rejectedReason: geometry.invalidReason || "INVALID_GEOMETRY",
    };
  }

  const blocks = buildBlocksFromGeometry(geometry, safeContracts);

  const ticket = {
    idempotencyKey: buildIdempotencyKey({
      symbol: normalizedSymbol,
      strategyId,
      direction: normalizedDirection,
      entryPrice: geometry.entryPrice,
      source: "BRIAN",
    }),

    symbol: normalizedSymbol,
    strategyId,

    intent: "ENTRY",
    action: "NEW_ENTRY",
    direction: normalizedDirection,
    assetType: "FUTURES",

    accountMode: "PAPER",
    paper: true,
    paperOnly: true,
    dryRun: true,
    testOnly: true,

    contracts: safeContracts,

    entry: {
      price: toNumber(geometry.entryPrice),
    },

    stop: {
      price: toNumber(geometry.stopPrice),
    },

    targets: blocks.map((block) => block.targetPrice),
    blocks,

    sourceSignal: {
      source,
      signalType,
      rawText,
      entryPrice: toNumber(geometry.entryPrice),
      stopPrice: toNumber(geometry.stopPrice),
      targets: blocks.map((block) => block.targetPrice),
    },

    engine6: {
      permission: "ALLOW",
      forcedPaperApproval: true,
      permissionOverride: true,
      permissionOverrideReason,
      originalDecision: engine6?.decision || engine6?.paperDecision || null,
      originalAllowed: engine6?.allowed ?? engine6?.paperAllowed ?? null,
      reasonCodes: engine6?.reasonCodes || [],
    },

    engine7: {
      sizingMode: "TEST_FIXED_3_BLOCKS",
      finalR: 1,
      contracts: safeContracts,
      ...(engine7 || {}),
    },

    geometry: {
      riskPoints: geometry.riskPoints,
      p2Rr: geometry.p2Rr,
      bestRr: geometry.bestRr,
      display: geometry.display,
    },

    noRealExecution: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
  };

  return {
    ok: true,
    rejected: false,
    rejectedReason: null,
    geometry,
    ticket,
  };
}

export {
  createEngine8PaperTradeTicket,
  buildBlocksFromGeometry,
};
