// services/core/jobs/createEngine26ManualHardSignal.js

import { createEngine8PaperTradeTicket } from "../logic/engine26/createEngine8PaperTradeTicket.js";
import { executeTradeTicket } from "../logic/trading/engine8Paper.js";

function parseTargets(value) {
  return String(value || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
}

function readInput() {
  const symbol = process.env.SYMBOL || "ES";
  const strategyId = process.env.STRATEGY_ID || "intraday_scalp@10m";
  const direction = process.env.DIRECTION || "SHORT";
  const entryPrice = Number(process.env.ENTRY);
  const stopPrice = Number(process.env.STOP);
  const targets = parseTargets(process.env.TARGETS);
  const contracts = Number(process.env.CONTRACTS || 3);

  if (!Number.isFinite(entryPrice)) {
    throw new Error("Missing ENTRY. Example: ENTRY=7582");
  }

  if (!Number.isFinite(stopPrice)) {
    throw new Error("Missing STOP. Example: STOP=7591.75");
  }

  if (targets.length < 3) {
    throw new Error("TARGETS must have at least 3 comma-separated prices.");
  }

  return {
    symbol,
    strategyId,
    direction,
    entryPrice,
    stopPrice,
    targets,
    contracts,
  };
}

async function main() {
  const input = readInput();

  const ticketResult = createEngine8PaperTradeTicket({
    ...input,
    rawText: `TAKE ${input.direction} ${input.symbol} ${input.entryPrice}`,
    engine6: {
      paperDecision: "FORCED_PAPER_ALLOW",
      paperAllowed: true,
      reasonCodes: ["BRIAN_MANUAL_ENGINE_PIPELINE_TEST"],
    },
  });

  if (!ticketResult.ok) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          stage: "CREATE_ENGINE8_TICKET",
          rejectedReason: ticketResult.rejectedReason,
          geometry: ticketResult.geometry,
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const execution = await executeTradeTicket(ticketResult.ticket);

  console.log(
    JSON.stringify(
      {
        ok: execution?.ok === true,
        stage: "ENGINE8_PAPER_EXECUTION",
        ticket: {
          idempotencyKey: ticketResult.ticket.idempotencyKey,
          symbol: ticketResult.ticket.symbol,
          strategyId: ticketResult.ticket.strategyId,
          direction: ticketResult.ticket.direction,
          assetType: ticketResult.ticket.assetType,
          contracts: ticketResult.ticket.contracts,
          entry: ticketResult.ticket.entry,
          stop: ticketResult.ticket.stop,
          targets: ticketResult.ticket.targets,
          blocks: ticketResult.ticket.blocks,
          engine6: ticketResult.ticket.engine6,
          engine7: ticketResult.ticket.engine7,
          noRealExecution: ticketResult.ticket.noRealExecution,
          schwabExecutionAllowed: ticketResult.ticket.schwabExecutionAllowed,
        },
        execution,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err.message,
        stack: err.stack,
      },
      null,
      2
    )
  );
  process.exit(1);
});
