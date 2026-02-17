// services/core/jobs/writeReplaySnapshot.js
//
// Replay cadence snapshot writer (HHMM.json)
// - Runs inside backend-1 (called from /api/v1/run-all-engines Step 3)
// - Writes to persistent disk under /var/data/replay (via REPLAY_DATA_DIR)
// - Snapshot top-level keys: ok, tsUtc, symbol, market, structure, fib, decision, meta
// - Adds Engine 6 output into: decision.permission ✅
//
// LOCKED RULES:
// - Never crash replay if any sub-endpoint fails.
// - If Engine 6 fails → decision.permission = null (do not crash).
// - Time partition is Arizona (America/Phoenix).

import path from "path";
import { writeReplaySnapshot } from "../logic/replay/writeSnapshot.js";

// -------------------------
// Time helpers (America/Phoenix)
// -------------------------
function azNowParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );

  const dateYmd = `${parts.year}-${parts.month}-${parts.day}`;
  const timeHHMM = `${parts.hour}${parts.minute}`;
  const timeHHMMSS = `${parts.hour}${parts.minute}${parts.second}`;
  return { dateYmd, timeHHMM, timeHHMMSS };
}

// -------------------------
// Replay data directory resolver
// -------------------------
function resolveReplayDataDir() {
  // In prod: REPLAY_DATA_DIR=/var/data  (locked)
  // Canonical replay root: /var/data/replay
  const base = process.env.REPLAY_DATA_DIR || "/var/data";
  const normalized = base.endsWith("/replay") ? base : path.join(base, "replay");
  return normalized;
}

// -------------------------
// HTTP helpers (Node 18+ has global fetch)
// -------------------------
async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || `HTTP ${res.status}`;
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  return json;
}

async function safeFetchSection(label, url) {
  try {
    const data = await fetchJson(url);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function normalizePermission(raw) {
  // Accept the most common shapes without breaking.
  // We want: { state, sizeMultiplier, reasonCodes }
  if (!raw || raw.ok === false) return null;

  const state =
    raw.state ||
    raw.permission ||
    raw.status ||
    raw.mode ||
    raw.gate ||
    null;

  const sizeMultiplier =
    typeof raw.sizeMultiplier === "number"
      ? raw.sizeMultiplier
      : typeof raw.multiplier === "number"
      ? raw.multiplier
      : null;

  const reasonCodes =
    Array.isArray(raw.reasonCodes)
      ? raw.reasonCodes
      : Array.isArray(raw.reasons)
      ? raw.reasons
      : [];

  if (!state) return null;

  // If sizeMultiplier missing, infer conservative defaults
  const inferred =
    sizeMultiplier !== null
      ? sizeMultiplier
      : state === "ALLOW"
      ? 1.0
      : state === "REDUCE"
      ? 0.5
      : state === "STAND_DOWN"
      ? 0.0
      : null;

  return { state, sizeMultiplier: inferred, reasonCodes };
}

// -------------------------
// Endpoint base (self)
// -------------------------
function selfBaseUrl() {
  // When running inside Render web service, PORT is set.
  // We call localhost to avoid external network / DNS.
  const port = process.env.PORT || "10000";
  return `http://127.0.0.1:${port}`;
}

// -------------------------
// Main job
// -------------------------
export async function main() {
  const { dateYmd, timeHHMM } = azNowParts(new Date());
  const dataDir = resolveReplayDataDir();
  const base = selfBaseUrl();

  // LOCKED symbol v1
  const symbol = "SPY";

  // These are the endpoints your snapshots already reflect.
  // If any one fails, we still write snapshot with ok:false for that section.
  const marketUrl = `${base}/api/v1/market-meter?mode=intraday`;
  const smzUrl = `${base}/api/v1/smz-hierarchy?symbol=${encodeURIComponent(symbol)}&tf=10m`;

  // Fib endpoint naming varies; your snapshot shows fib-levels@3 in fib object
  // Try the canonical: /api/v1/fib-levels
  const fibUrl = `${base}/api/v1/fib-levels?symbol=${encodeURIComponent(symbol)}&tf=1h&degree=minor`;

  // Decision / confluence endpoint: your repo lists routes/confluenceScore.js
  // Common path: /api/v1/confluence-score
  const decisionUrl = `${base}/api/v1/confluence-score?symbol=${encodeURIComponent(symbol)}&tf=10m&strategyId=intraday_scalp@10m&mode=scalp`;

  // Engine 6 permission endpoint: routes/tradePermission.js
  const permUrl = `${base}/api/v1/trade-permission?symbol=${encodeURIComponent(symbol)}&strategyId=intraday_scalp@10m&mode=scalp`;

  const [marketRes, smzRes, fibRes, decisionRes, permRes] = await Promise.all([
    safeFetchSection("market", marketUrl),
    safeFetchSection("structure.smzHierarchy", smzUrl),
    safeFetchSection("fib", fibUrl),
    safeFetchSection("decision", decisionUrl),
    safeFetchSection("decision.permission", permUrl),
  ]);

  // Build snapshot with locked top-level keys
  const snapshot = {
    ok: true,
    tsUtc: new Date().toISOString(),
    symbol,

    market: marketRes.ok
      ? marketRes.data
      : { ok: false, error: marketRes.error },

    structure: {
      smzHierarchy: smzRes.ok
        ? smzRes.data
        : { ok: false, error: smzRes.error },
    },

    fib: fibRes.ok
      ? fibRes.data
      : { ok: false, error: fibRes.error },

    decision: decisionRes.ok
      ? decisionRes.data
      : { ok: false, error: decisionRes.error },

    meta: {
      schema: "replay-snapshot@v1",
      dateYmd,
      timeHHMM,
      dataDir,
    },
  };

  // Attach Engine 6 into decision.permission (LOCKED)
  // If decision is not ok, still attach permission for debugging (if present)
  const perm = permRes.ok ? normalizePermission(permRes.data) : null;

  if (!snapshot.decision || typeof snapshot.decision !== "object") {
    snapshot.decision = { ok: false, error: "decision_missing" };
  }

  // Only set decision.permission if decision is an object (safe)
  snapshot.decision.permission = perm;

  // If any major section failed, snapshot.ok=false (but we still write it)
  const majorOk =
    marketRes.ok && smzRes.ok && fibRes.ok && decisionRes.ok;
  snapshot.ok = Boolean(majorOk);

  const result = writeReplaySnapshot({
    dataDir,
    dateYmd,
    timeHHMM,
    snapshot,
  });

  // Print minimal output (used by /api/v1/run-all-engines logs)
  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: result?.file,
        dateYmd,
        timeHHMM,
        snapshotOk: snapshot.ok,
        permission: perm,
      },
      null,
      0
    )
  );
}

// Allow: node jobs/writeReplaySnapshot.js
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("writeReplaySnapshot FAILED:", err?.message || err);
    process.exit(1);
  });
}
