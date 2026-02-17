// services/core/jobs/writeReplaySnapshot.js
//
// Replay cadence snapshot writer (HHMM.json)
// - Builds snapshot by calling local backend-1 endpoints (market, smz, fib, decision)
// - Adds Engine 6 permission into: decision.permission ✅
// - Computes Engine 6 permission LOCALLY (no /trade-permission HTTP) ✅
// - Writes snapshot + diff events via writeReplaySnapshot()
// LOCKED: Never crash. If anything fails, write snapshot with ok:false.

import path from "path";
import { writeReplaySnapshot } from "../logic/replay/writeSnapshot.js";
import { computeTradePermission as computeEngine6 } from "../logic/engine6TradePermission.js";

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

  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const dateYmd = `${parts.year}-${parts.month}-${parts.day}`;
  const timeHHMM = `${parts.hour}${parts.minute}`;
  return { dateYmd, timeHHMM };
}

// -------------------------
// Replay data directory resolver
// -------------------------
function resolveReplayDataDir() {
  const base = process.env.REPLAY_DATA_DIR || "/var/data";
  return base.endsWith("/replay") ? base : path.join(base, "replay");
}

// -------------------------
// HTTP helpers (Node has global fetch)
// -------------------------
async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || `HTTP ${res.status}`;
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  return json;
}

async function safeFetch(label, url) {
  try {
    const data = await fetchJson(url);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `${label}: ${String(e?.message || e)}` };
  }
}

function selfBaseUrl() {
  const port = process.env.PORT || "10000";
  return `http://127.0.0.1:${port}`;
}

// -------------------------
// Build Engine 6 input from decision snapshot (LOCKED mapping)
// -------------------------
function buildEngine6InputFromDecision({ symbol, tf, decision }) {
  // Engine 6 requires engine5.total + engine5.invalid (LOCKED from teammate)
  const total = decision?.scores?.total;
  const invalid = Boolean(decision?.invalid);

  const engine5 = {
    total: typeof total === "number" ? total : 0,
    invalid,
    reasonCodes: Array.isArray(decision?.reasonCodes) ? decision.reasonCodes : [],
  };

  // Zone context (optional but practically required)
  // We derive withinZone from decision.location.state when available.
  const locState = decision?.location?.state || null;
  const withinZone = locState === "PRICE_IN_GOLDEN_RULE" || locState === "PRICE_IN_ZONE" || false;

  const zoneContext = {
    withinZone,
    zoneType: decision?.location?.zoneType || decision?.flags?.zoneType || "UNKNOWN",
    flags: {
      degraded: false,
      liquidityFail: Boolean(decision?.flags?.liquidityTrap),
      reactionFailed: false,
    },
  };

  const intent = { action: "NEW_ENTRY" };

  return {
    symbol,
    tf,
    asOf: new Date().toISOString(),
    engine5,
    marketMeter: null, // v1 defaults are OK
    zoneContext,
    intent,
  };
}

function normalizePermissionResult(result) {
  // computeEngine6 returns { permission, sizeMultiplier, reasonCodes, debug, ... }
  if (!result) return null;
  return {
    state: result.permission || "STAND_DOWN",
    sizeMultiplier: typeof result.sizeMultiplier === "number" ? result.sizeMultiplier : 0,
    reasonCodes: Array.isArray(result.reasonCodes) ? result.reasonCodes : [],
    debug: result.debug || undefined, // keep for troubleshooting (optional)
  };
}

// -------------------------
// Main job
// -------------------------
export async function main() {
  const { dateYmd, timeHHMM } = azNowParts(new Date());
  const dataDir = resolveReplayDataDir();
  const base = selfBaseUrl();
  const symbol = "SPY";

  // Endpoints you already use in snapshots
  const marketUrl = `${base}/api/v1/market-meter?mode=intraday`;
  const smzUrl = `${base}/api/v1/smz-hierarchy?symbol=${encodeURIComponent(symbol)}&tf=10m`;
  const fibUrl = `${base}/api/v1/fib-levels?symbol=${encodeURIComponent(symbol)}&tf=1h&degree=minor`;
  const decisionUrl = `${base}/api/v1/confluence-score?symbol=${encodeURIComponent(symbol)}&tf=10m&strategyId=intraday_scalp@10m&mode=scalp`;

  const [marketRes, smzRes, fibRes, decisionRes] = await Promise.all([
    safeFetch("market", marketUrl),
    safeFetch("structure.smzHierarchy", smzUrl),
    safeFetch("fib", fibUrl),
    safeFetch("decision", decisionUrl),
  ]);

  const snapshot = {
    ok: true,
    tsUtc: new Date().toISOString(),
    symbol,

    market: marketRes.ok ? marketRes.data : { ok: false, error: marketRes.error },

    structure: {
      smzHierarchy: smzRes.ok ? smzRes.data : { ok: false, error: smzRes.error },
    },

    fib: fibRes.ok ? fibRes.data : { ok: false, error: fibRes.error },

    decision: decisionRes.ok ? decisionRes.data : { ok: false, error: decisionRes.error },

    meta: {
      schema: "replay-snapshot@v1",
      dateYmd,
      timeHHMM,
      dataDir,
    },
  };

  // Compute Engine 6 locally only if decision.ok true
  try {
    if (snapshot.decision && snapshot.decision.ok) {
      const e6Input = buildEngine6InputFromDecision({
        symbol,
        tf: "10m",
        decision: snapshot.decision,
      });

      const e6Result = computeEngine6(e6Input);
      snapshot.decision.permission = normalizePermissionResult(e6Result);
    } else {
      snapshot.decision.permission = null;
    }
  } catch (e) {
    // Never crash replay
    snapshot.decision.permission = {
      state: "STAND_DOWN",
      sizeMultiplier: 0,
      reasonCodes: ["ENGINE6_COMPUTE_ERROR"],
      debug: { error: String(e?.message || e) },
    };
  }

  // Snapshot overall ok only if core sections ok (but still write regardless)
  snapshot.ok = Boolean(marketRes.ok && smzRes.ok && fibRes.ok && decisionRes.ok);

  const result = writeReplaySnapshot({
    dataDir,
    dateYmd,
    timeHHMM,
    snapshot,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: result?.file,
        dateYmd,
        timeHHMM,
        snapshotOk: snapshot.ok,
        permission: snapshot?.decision?.permission || null,
      },
      null,
      0
    )
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("writeReplaySnapshot FAILED:", err?.message || err);
    process.exit(1);
  });
}
