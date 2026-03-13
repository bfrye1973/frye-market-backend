// services/core/jobs/buildStrategySnapshot.js
// Stable snapshot builder (SPY only)

import fs from "fs";
import { fileURLToPath } from "url";

/* -----------------------------
   Absolute snapshot path
------------------------------*/

// IMPORTANT: force the correct Render path
const DATA_DIR = "/opt/render/project/src/services/core/data";
const SNAPSHOT_FILE = `${DATA_DIR}/strategy-snapshot.json`;

const CORE_BASE = process.env.CORE_BASE || "http://127.0.0.1:10000";
const symbol = "SPY";

function nowIso() {
  return new Date().toISOString();
}

/* -----------------------------
   Safe HTTP GET
------------------------------*/
async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
    return { ok: false, error: err?.message || "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

/* -----------------------------
   Safe HTTP POST
------------------------------*/
async function postJson(url, body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
    return { ok: false, error: err?.message || "post_failed" };
  } finally {
    clearTimeout(timer);
  }
}

/* -----------------------------
   Strategy definitions
------------------------------*/
const STRATEGIES = [
  { strategyId: "intraday_scalp@10m", tf: "10m", degree: "minute", wave: "W1" },
  { strategyId: "minor_swing@1h", tf: "1h", degree: "minor", wave: "W1" },
  { strategyId: "intermediate_long@4h", tf: "4h", degree: "intermediate", wave: "W1" },
];

/* -----------------------------
   Process a single strategy
------------------------------*/
async function processStrategy(s, momentum, marketMind) {

  console.log(`→ Processing ${s.strategyId}`);

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

  return {
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

  /* Run strategies in parallel */
  const strategyResults = await Promise.all(
    STRATEGIES.map((s) => processStrategy(s, momentum, marketMind))
  );

  strategyResults.forEach((s) => {
    result.strategies[s.strategyId] = s;
  });

  /* Ensure data folder exists */
  fs.mkdirSync(DATA_DIR, { recursive: true });

  /* Write snapshot */
  fs.writeFileSync(
    SNAPSHOT_FILE,
    JSON.stringify(result, null, 2)
  );

  console.log("Strategy snapshot written:", SNAPSHOT_FILE);
}

/* -----------------------------
   Run builder
------------------------------*/
buildSnapshot()
  .then(() => {
    console.log("Snapshot build completed successfully");
  })
  .catch((err) => {
    console.error("Snapshot builder failed:", err);
  });
