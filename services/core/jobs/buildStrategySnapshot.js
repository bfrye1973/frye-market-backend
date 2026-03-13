// services/core/jobs/buildStrategySnapshot.js
// Safe snapshot builder (SPY only)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const SNAPSHOT_FILE = path.resolve(DATA_DIR, "strategy-snapshot.json");

const CORE_BASE =
  process.env.CORE_BASE ||
  "http://127.0.0.1:10000";

const symbol = "SPY";

function nowIso() {
  return new Date().toISOString();
}

/* -----------------------------
   Safe fetch with timeout
------------------------------*/
async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const text = await res.text();

    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: "invalid_json", raw: text };
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

/* -----------------------------
   Safe POST with timeout
------------------------------*/
async function postJson(url, body, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: "invalid_json", raw: text };
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

/* -----------------------------
   Strategy list
------------------------------*/
const STRATEGIES = [
  { strategyId: "intraday_scalp@10m", tf: "10m", degree: "minute", wave: "W1" },
  { strategyId: "minor_swing@1h", tf: "1h", degree: "minor", wave: "W1" },
  { strategyId: "intermediate_long@4h", tf: "4h", degree: "intermediate", wave: "W1" },
];

/* -----------------------------
   Build snapshot
------------------------------*/
async function buildSnapshot() {

  console.log("Starting strategy snapshot build...");

  const momentum = await fetchJson(
    `${CORE_BASE}/api/v1/momentum-context?symbol=${symbol}`
  );

  console.log("Momentum fetched");

  const marketMind = {
    score10m: null,
    score1h: null,
    score4h: null,
    scoreEOD: null,
    scoreMaster: null,
  };

  const result = {
    ok: true,
    symbol,
    now: nowIso(),
    includeContext: true,
    momentum,
    marketMind,
    strategies: {},
  };

  for (const s of STRATEGIES) {

    console.log(`Processing strategy ${s.strategyId}`);

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
        intent: { action: "NEW_ENTRY" },
      }
    );

    const permissionV2 = await postJson(
      `${CORE_BASE}/api/v1/trade-permission-v2`,
      {
        symbol,
        strategyId: s.strategyId,
        market: marketMind,
        setup: {
          setupScore: Number(confluence?.scores?.total || 0),
          label: confluence?.scores?.label || "D",
          invalid: Boolean(confluence?.invalid),
        },
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
      context,
    };
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  fs.writeFileSync(
    SNAPSHOT_FILE,
    JSON.stringify(result, null, 2)
  );

  console.log("Strategy snapshot written:", SNAPSHOT_FILE);
}

/* -----------------------------
   Run builder
------------------------------*/
buildSnapshot().catch((err) => {
  console.error("Snapshot builder failed:", err);
});
