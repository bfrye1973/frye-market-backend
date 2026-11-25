// services/core/routes/engine26ManualHardSignal.js

import express from "express";
import { createEngine8PaperTradeTicket } from "../logic/engine26/createEngine8PaperTradeTicket.js";
import { executeTradeTicket } from "../logic/trading/engine8Paper.js";

const router = express.Router();

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDirection(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeSymbol(value) {
  return String(value || "ES").trim().toUpperCase();
}

function normalizeTargets(value) {
  if (Array.isArray(value)) {
    return value.map(toNumber).filter((n) => Number.isFinite(n));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((x) => toNumber(x.trim()))
      .filter((n) => Number.isFinite(n));
  }

  return [];
}

function validatePayload(body = {}) {
  const symbol = normalizeSymbol(body.symbol || "ES");
  const strategyId = body.strategyId || "intraday_scalp@10m";
  const direction = normalizeDirection(body.direction);
  const entryPrice = toNumber(body.entryPrice ?? body.entry ?? body.ENTRY);
  const stopPrice = toNumber(body.stopPrice ?? body.stop ?? body.STOP);
  const targets = normalizeTargets(body.targets ?? body.TARGETS);
  const contracts = toNumber(body.contracts ?? body.CONTRACTS ?? 3);

  if (!["LONG", "SHORT"].includes(direction)) {
    return {
      ok: false,
      rejectedReason: "INVALID_DIRECTION",
      normalized: null,
    };
  }

  if (!Number.isFinite(entryPrice)) {
    return {
      ok: false,
      rejectedReason: "MISSING_ENTRY_PRICE",
      normalized: null,
    };
  }

  if (!Number.isFinite(stopPrice)) {
    return {
      ok: false,
      rejectedReason: "MISSING_STOP_PRICE",
      normalized: null,
    };
  }

  if (!Array.isArray(targets) || targets.length < 3) {
    return {
      ok: false,
      rejectedReason: "THREE_TARGETS_REQUIRED",
      normalized: null,
    };
  }

  if (!Number.isFinite(contracts) || contracts <= 0) {
    return {
      ok: false,
      rejectedReason: "INVALID_CONTRACTS",
      normalized: null,
    };
  }

  return {
    ok: true,
    rejectedReason: null,
    normalized: {
      symbol,
      strategyId,
      direction,
      entryPrice,
      stopPrice,
      targets,
      contracts: Math.max(1, Math.floor(contracts)),
      rawText: body.rawText || "CHART_GEOMETRY_TOOL",
    },
  };
}

function buildTicketSummary(ticket) {
  if (!ticket) return null;

  return {
    idempotencyKey: ticket.idempotencyKey,
    symbol: ticket.symbol,
    strategyId: ticket.strategyId,
    direction: ticket.direction,
    assetType: ticket.assetType,
    accountMode: ticket.accountMode,
    paper: ticket.paper,
    paperOnly: ticket.paperOnly,
    dryRun: ticket.dryRun,
    testOnly: ticket.testOnly,
    contracts: ticket.contracts,
    entry: ticket.entry,
    stop: ticket.stop,
    targets: ticket.targets,
    blocks: ticket.blocks,
    sourceSignal: ticket.sourceSignal,
    engine6: ticket.engine6,
    engine7: ticket.engine7,
    geometry: ticket.geometry,
    noRealExecution: ticket.noRealExecution,
    realExecutionAllowed: ticket.realExecutionAllowed,
    brokerExecutionAllowed: ticket.brokerExecutionAllowed,
    schwabExecutionAllowed: ticket.schwabExecutionAllowed,
  };
}

router.post("/engine26/manual-hard-signal", async (req, res) => {
  try {
    const payload = validatePayload(req.body || {});

    if (!payload.ok) {
      return res.status(400).json({
        ok: false,
        stage: "VALIDATE_ENGINE26_MANUAL_HARD_SIGNAL",
        rejected: true,
        rejectedReason: payload.rejectedReason,
      });
    }

    const input = payload.normalized;

    const ticketResult = createEngine8PaperTradeTicket({
      ...input,
      rawText: input.rawText,
      source: "BRIAN_MANUAL_HARD_SIGNAL",
      signalType: "ENGINE6_FORCED_PAPER_TRADE_TEST",
      permissionOverrideReason: "BRIAN_MANUAL_ENGINE_PIPELINE_TEST",
      engine6: {
        paperDecision: "FORCED_PAPER_ALLOW",
        paperAllowed: true,
        reasonCodes: ["BRIAN_MANUAL_ENGINE_PIPELINE_TEST"],
      },
    });

    if (!ticketResult.ok) {
      return res.status(400).json({
        ok: false,
        stage: "CREATE_ENGINE8_TICKET",
        rejected: true,
        rejectedReason: ticketResult.rejectedReason,
        geometry: ticketResult.geometry,
      });
    }

    const execution = await executeTradeTicket(ticketResult.ticket);

    return res.json({
      ok: execution?.ok === true,
      stage: "ENGINE8_PAPER_EXECUTION",
      rejected: false,
      ticket: buildTicketSummary(ticketResult.ticket),
      execution,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      stage: "ENGINE26_MANUAL_HARD_SIGNAL_ERROR",
      error: err?.message || String(err),
    });
  }
});

export default router;
