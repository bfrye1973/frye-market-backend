// services/core/jobs/autoExecuteCanonicalPaperTrade.js
//
// Engine 28A automatic PAPER entry bridge.
//
// Purpose:
// - read the frozen canonical ES Strategy 1 snapshot
// - do nothing unless Engine 8 already says READY_TO_CREATE_PAPER_ORDER
// - invoke ONLY the existing admin-protected canonical PAPER route
// - preserve Engine 8 duplicate/idempotency protection
// - never call Schwab or enable live execution
//
// This job does not decide direction, permission, geometry, sizing, or management.
// Those decisions must already be complete in the frozen snapshot.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");

const SNAPSHOT_FILE = path.resolve(
  CORE_DIR,
  "data",
  "strategy-snapshot-es.json"
);

const STRATEGY_ID = "intraday_scalp@10m";
const READY_STATUS = "READY_TO_CREATE_PAPER_ORDER";

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function printAndExit(payload, code = 0) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

function reject(reason, detail = null) {
  printAndExit(
    {
      ok: false,
      status: "AUTO_PAPER_EXECUTION_BRIDGE_ERROR",
      reason,
      detail,
      evaluatedAt: nowIso(),
    },
    1
  );
}

function skip(reason, engine8PaperOrder = null) {
  printAndExit({
    ok: true,
    skipped: true,
    status: "AUTO_PAPER_EXECUTION_SKIPPED",
    reason,
    engine8: engine8PaperOrder
      ? {
          status: engine8PaperOrder.status ?? null,
          executable: engine8PaperOrder.executable === true,
          direction: engine8PaperOrder.direction ?? null,
          candidateId: engine8PaperOrder.candidateId ?? null,
          planId: engine8PaperOrder.planId ?? null,
        }
      : null,
    evaluatedAt: nowIso(),
  });
}

if (
  process.env.ENGINE8_AUTO_PAPER_EXECUTION_ENABLED !== "1"
) {
  skip("ENGINE8_AUTO_PAPER_EXECUTION_DISABLED");
}

if (!fs.existsSync(SNAPSHOT_FILE)) {
  reject("ES_STRATEGY_SNAPSHOT_NOT_FOUND", SNAPSHOT_FILE);
}

let snapshot;

try {
  snapshot = JSON.parse(
    fs.readFileSync(SNAPSHOT_FILE, "utf8")
  );
} catch (error) {
  reject(
    "ES_STRATEGY_SNAPSHOT_UNREADABLE",
    String(error?.message || error)
  );
}

const engine8PaperOrder =
  snapshot?.strategies?.[STRATEGY_ID]
    ?.engine8PaperOrder || null;

if (!engine8PaperOrder) {
  reject("ENGINE8_CANONICAL_ADAPTER_NOT_FOUND");
}

// Validate the execution environment on every enabled cycle,
// even when no trade is currently ready. This prevents a valid
// future GO from discovering a missing safety/admin setting too late.
if (process.env.ENGINE8_PAPER_ONLY !== "1") {
  reject("ENGINE8_PAPER_ONLY_NOT_SET");
}

if (
  process.env.ENGINE8_CANONICAL_EXECUTOR_ENABLED !== "1"
) {
  reject("ENGINE8_CANONICAL_EXECUTOR_ENABLED_NOT_SET");
}

if (process.env.ENGINE8_KILL_SWITCH === "1") {
  reject("ENGINE8_KILL_SWITCH_ACTIVE");
}

if (
  process.env.ENGINE8_LIVE_TRADING_ENABLED === "1" ||
  process.env.ENGINE8_ALLOW_LIVE_FUTURES === "1"
) {
  reject("LIVE_EXECUTION_FLAGS_PRESENT");
}

if (
  process.env.REPLAY_MODE === "1" ||
  process.env.ENGINE12_REPLAY_MODE === "1"
) {
  reject("REPLAY_EXECUTION_FORBIDDEN");
}

const adminSecret = String(
  process.env.ENGINE8_ADMIN_SECRET || ""
).trim();

if (!adminSecret) {
  reject("ENGINE8_ADMIN_SECRET_NOT_CONFIGURED");
}

if (
  upper(engine8PaperOrder.status) !== READY_STATUS ||
  engine8PaperOrder.executable !== true
) {
  skip(
    "ENGINE8_ADAPTER_NOT_READY_ENVIRONMENT_ARMED",
    engine8PaperOrder
  );
}

const port = Number(process.env.PORT) || 10000;
const baseUrl = String(
  process.env.CORE_BASE_URL ||
    process.env.CORE_BASE ||
    `http://127.0.0.1:${port}`
).replace(/\/+$/, "");

const url =
  `${baseUrl}/api/trading/paper/execute-canonical`;

const controller = new AbortController();
const timeout = setTimeout(
  () => controller.abort(),
  15000
);

let response;
let payload = null;
let raw = "";

try {
  response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-engine8-admin-secret": adminSecret,
    },
    body: "{}",
    signal: controller.signal,
  });

  raw = await response.text();

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
} catch (error) {
  clearTimeout(timeout);

  reject(
    "CANONICAL_PAPER_EXECUTION_REQUEST_FAILED",
    String(error?.message || error)
  );
} finally {
  clearTimeout(timeout);
}

if (!response?.ok || payload?.ok !== true) {
  reject(
    "CANONICAL_PAPER_EXECUTION_REJECTED",
    {
      httpStatus: response?.status ?? null,
      payload,
      raw: payload ? null : raw.slice(0, 2000),
    }
  );
}

printAndExit({
  ok: true,
  skipped: false,
  status: "AUTO_PAPER_EXECUTION_COMPLETED",
  execution: {
    status: payload?.status ?? null,
    direction: payload?.direction ?? null,
    candidateId: payload?.candidateId ?? null,
    planId: payload?.planId ?? null,
    orderId: payload?.orderId ?? null,
    executionId: payload?.executionId ?? null,
    tradeId: payload?.tradeId ?? null,
    orderCreated: payload?.orderCreated === true,
    fillCreated: payload?.fillCreated === true,
    journalCompleted: payload?.journalCompleted === true,
    journalPending: payload?.journalPending === true,
  },
  safety: {
    paperOnly: true,
    liveExecutionAllowed: false,
    noSchwabCall: true,
  },
  evaluatedAt: nowIso(),
});
