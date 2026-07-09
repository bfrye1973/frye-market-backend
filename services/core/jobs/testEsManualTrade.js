import readline from "readline";

const API_URL = "http://127.0.0.1:10000/api/trading/execute";
const STRATEGY_ID = "intraday_scalp@10m";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(String(answer || "").trim()));
  });
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDirection(value) {
  const v = String(value || "").trim().toUpperCase();

  if (v === "L" || v === "LONG") return "LONG";
  if (v === "S" || v === "SHORT") return "SHORT";

  return null;
}

function buildBlocks({ contracts, stopPrice, targets }) {
  const qty = Math.max(1, Math.floor(Number(contracts) || 1));

  if (qty === 1) {
    return [
      {
        blockId: "RUNNER",
        role: "RUNNER",
        qty: 1,
        targetPrice: targets[2] ?? targets[1] ?? targets[0],
        stopPrice,
      },
    ];
  }

  if (qty === 2) {
    return [
      {
        blockId: "P1",
        role: "TP1",
        qty: 1,
        targetPrice: targets[0],
        stopPrice,
      },
      {
        blockId: "RUNNER",
        role: "RUNNER",
        qty: 1,
        targetPrice: targets[2] ?? targets[1],
        stopPrice,
      },
    ];
  }

  return [
    {
      blockId: "P1",
      role: "TP1",
      qty: 1,
      targetPrice: targets[0],
      stopPrice,
    },
    {
      blockId: "P2",
      role: "TP2",
      qty: 1,
      targetPrice: targets[1],
      stopPrice,
    },
    {
      blockId: "RUNNER",
      role: "RUNNER",
      qty: qty - 2,
      targetPrice: targets[2],
      stopPrice,
    },
  ];
}

async function main() {
  console.log("\nEngine 8 Manual ES Paper Trade");
  console.log("PAPER ONLY — no Schwab, no broker, no live order.\n");

  const direction = normalizeDirection(await ask("Direction LONG/SHORT: "));
  const entryPrice = toNumber(await ask("Entry price: "));
  const stopPrice = toNumber(await ask("Stop price: "));
  const tp1 = toNumber(await ask("TP1: "));
  const tp2 = toNumber(await ask("TP2: "));
  const runner = toNumber(await ask("Runner target: "));
  const contracts = toNumber(await ask("Contracts: "));

  if (!direction) throw new Error("Invalid direction. Use LONG or SHORT.");
  if (!entryPrice || entryPrice <= 0) throw new Error("Invalid entry price.");
  if (!stopPrice || stopPrice <= 0) throw new Error("Invalid stop price.");
  if (!tp1 || !tp2 || !runner) throw new Error("Invalid targets.");
  if (!contracts || contracts <= 0) throw new Error("Invalid contracts.");

  const targets = [tp1, tp2, runner];
  const blocks = buildBlocks({
    contracts,
    stopPrice,
    targets,
  });

  const payload = {
    idempotencyKey: `MANUAL|ES|${STRATEGY_ID}|${direction}|${entryPrice}|${Date.now()}`,
    symbol: "ES",
    strategyId: STRATEGY_ID,
    intent: "ENTRY",
    direction,
    assetType: "FUTURES",
    contracts,
    paper: true,
    dryRun: true,
    testOnly: true,
    accountMode: "PAPER",
    paperOnly: true,

    entry: { price: entryPrice },
    stop: { price: stopPrice },
    targets,
    blocks,

    engine6: { permission: "ALLOW" },

    noRealExecution: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
  };

  console.log("\nPayload:");
  console.log(JSON.stringify(payload, null, 2));

  const confirm = String(await ask("\nSubmit ES paper trade? Y/N: "))
    .trim()
    .toUpperCase();

  if (confirm !== "Y") {
    console.log("Canceled. No paper trade submitted.");
    rl.close();
    return;
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  console.log("\nEngine 8 response:");
  console.log(JSON.stringify(json, null, 2));

  rl.close();
}

main().catch((err) => {
  console.error("\n[testEsManualTrade] failed:", err?.stack || err);
  rl.close();
  process.exit(1);
});
