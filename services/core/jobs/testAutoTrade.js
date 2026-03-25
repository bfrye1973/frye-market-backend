import fs from "fs";

const SNAPSHOT_PATH = "/opt/render/project/src/services/core/data/strategy-snapshot.json";

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

  if (!["LONG", "SHORT"].includes(signal.direction)) {
    console.log("❌ No direction");
    return;
  }

  console.log("🔥 SIGNAL DETECTED:", signal);

  const payload = {
    symbol: "SPY",
    strategyId: "intraday_scalp@10m",
    side: signal.direction === "LONG" ? "BUY" : "SELL",
    qty: 1, // keep simple for now
    idempotencyKey: `AUTO-${Date.now()}`
  };

  const res = await fetch("http://127.0.0.1:10000/api/trading/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  console.log("📦 EXEC RESULT:", data);
}

run().catch(console.error);
