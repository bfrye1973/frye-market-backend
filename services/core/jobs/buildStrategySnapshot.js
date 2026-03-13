// services/core/jobs/buildStrategySnapshot.js
// Phase-1 snapshot builder (SPY only)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const SNAPSHOT_FILE = path.resolve(DATA_DIR, "strategy-snapshot.json");

const CORE_BASE =
  process.env.CORE_BASE ||
  "https://frye-market-backend-1.onrender.com";
const symbol = "SPY";

async function fetchJson(url) {
  try {
    const r = await fetch(url);
    const j = await r.json();
    return j;
  } catch {
    return { ok: false };
  }
}

async function postJson(url, body) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const j = await r.json();
    return j;
  } catch {
    return { ok: false };
  }
}

async function buildSnapshot() {

  const now = new Date().toISOString();

  const momentum = await fetchJson(
    `${CORE_BASE}/api/v1/momentum-context?symbol=${symbol}`
  );

  const strategies = [
    { strategyId: "intraday_scalp@10m", tf: "10m", degree: "minute", wave: "W1" },
    { strategyId: "minor_swing@1h", tf: "1h", degree: "minor", wave: "W1" },
    { strategyId: "intermediate_long@4h", tf: "4h", degree: "intermediate", wave: "W1" }
  ];

  const result = {
    ok: true,
    symbol,
    now,
    includeContext: true,
    momentum,
    marketMind: {
      score10m: null,
      score1h: null,
      score4h: null,
      scoreEOD: null,
      scoreMaster: null
    },
    strategies: {}
  };

  for (const s of strategies) {

    const confluence = await fetchJson(
      `${CORE_BASE}/api/v1/confluence-score?symbol=${symbol}&tf=${s.tf}&degree=${s.degree}&wave=${s.wave}`
    );

    const context = await fetchJson(
      `${CORE_BASE}/api/v1/engine5-context?symbol=${symbol}&tf=${s.tf}`
    );

    const permission = await postJson(
      `${CORE_BASE}/api/v1/trade-permission`,
      {
        symbol,
        tf: s.tf,
        engine5: confluence,
        intent: { action: "NEW_ENTRY" }
      }
    );

    const permissionV2 = await postJson(
      `${CORE_BASE}/api/v1/trade-permission-v2`,
      {
        symbol,
        strategyId: s.strategyId,
        market: result.marketMind,
        setup: {
          setupScore: Number(confluence?.scores?.total || 0),
          label: confluence?.scores?.label || "D",
          invalid: Boolean(confluence?.invalid)
        }
      }
    );

    result.strategies[s.strategyId] = {
      strategyId: s.strategyId,
      tf: s.tf,
      degree: s.degree,
      wave: s.wave,
      confluence,
      permission,
      engine6v2: permissionV2,
      engine2: null,
      momentum,
      context
    };
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  fs.writeFileSync(
    SNAPSHOT_FILE,
    JSON.stringify(result, null, 2)
  );

  console.log("Strategy snapshot written:", SNAPSHOT_FILE);
}

buildSnapshot();
