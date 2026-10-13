import fs from "fs";
import readline from "readline";

const SNAPSHOT_PATH = "/opt/render/project/src/services/core/data/strategy-snapshot.json";
const EXEC_URL = "http://127.0.0.1:10000/api/trading/execute";

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

function normalizeDirection(signal) {
  return String(signal?.direction || "").toUpperCase();
}

function inferRight(direction) {
  if (direction === "LONG") return "CALL";
  if (direction === "SHORT") return "PUT";
  return null;
}

function inferAtmStrike(signal) {
  const price = Number(signal?.signalPrice);
  if (!Number.isFinite(price)) return null;
  return Math.round(price);
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

async function run() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));

  const s = snapshot?.strategies?.["intraday_scalp@10m"];
  const signal = s?.engine15Decision?.signalEvent;

  if (!signal) {
    console.log("❌ No signalEvent");
    return;
  }

  if (signal.signalType !== "EXHAUSTION") {
    console.log("❌ Not exhaustion");
    return;
  }

  const direction = normalizeDirection(signal);
  if (!["LONG", "SHORT"].includes(direction)) {
    console.log("❌ No valid direction");
    return;
  }

  const right = inferRight(direction);
  const strike = inferAtmStrike(signal);
  const expiration = todayYmd();

  if (!right || strike == null) {
    console.log("❌ Could not infer contract details");
    console.log({ right, strike, signalPrice: signal?.signalPrice });
    return;
  }

  console.log("\n🔥 SIGNAL DETECTED");
  console.log(JSON.stringify(signal, null, 2));

  console.log("\n📋 AUTO OPTION SELECTION");
  console.log(`Symbol: SPY`);
  console.log(`Strategy: intraday_scalp@10m`);
  console.log(`Direction: ${direction}`);
  console.log(`Right: ${right}`);
  console.log(`Expiration (0DTE): ${expiration}`);
  console.log(`Strike (ATM): ${strike}`);
  console.log(`Contracts: 3`);

  const premiumInput = await ask(
    "\nEnter Thinkorswim option mid price (example 1.85), or type X to cancel: "
  );

  if (!premiumInput || premiumInput.toUpperCase() === "X") {
    console.log("🛑 Trade cancelled by user");
    return;
  }

  const midPrice = Number(premiumInput);
  if (!Number.isFinite(midPrice) || midPrice <= 0) {
    console.log("❌ Invalid premium. Please enter a number like 1.85");
    return;
  }

  const confirm = await ask(
    `Confirm trade? ${right} ${strike} ${expiration} @ ${midPrice} for 3 contracts (Y/N): `
  );

  if (String(confirm || "").trim().toUpperCase() !== "Y") {
    console.log("🛑 Trade not confirmed");
    return;
  }

  const payload = {
    idempotencyKey: `AUTO|SPY|intraday_scalp@10m|${direction}|${Date.now()}`,
    symbol: "SPY",
    strategyId: "intraday_scalp@10m",
    intent: "ENTRY",
    direction,
    assetType: "OPTION",
    contracts: 3,
    paper: true,
    signalEvent: {
      signalType: signal.signalType,
      direction: signal.direction,
      signalTime: signal.signalTime,
      signalPrice: signal.signalPrice,
      signalSource: signal.signalSource,
    },
    option: {
      right,
      expiration,
      strike,
      midPrice,
    },
    engine6: {
      permission: "ALLOW",
    },
  };

  console.log("\n🧾 EXEC PAYLOAD");
  console.log(JSON.stringify(payload, null, 2));

  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  console.log("\n📦 EXEC RESULT");
  console.log(JSON.stringify(data, null, 2));
}

run().catch((err) => {
  console.error("❌ testAutoTrade failed:", err?.stack || err);
});
