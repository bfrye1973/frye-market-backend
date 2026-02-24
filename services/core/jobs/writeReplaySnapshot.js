// services/core/jobs/writeReplaySnapshot.js
//
// Replay cadence snapshot writer (HHMM.json)
//
// What it does:
// - Builds a replay snapshot by calling local backend-1 endpoints (SMZ, Fib, Decisions)
// - Computes Engine 6 permission LOCALLY (no /trade-permission HTTP) ✅
// - Computes Engine 15 readiness (calls E3 + E4 using deterministic zone bounds) ✅
// - Writes snapshot even if some parts fail (LOCKED: never crash)
//
// IMPORTANT FIX (your current issue):
// - Your container has NO /api/v1/market-meter or /api/v1/live endpoints (all 404).
// - So market fetch will always fail.
// - We will NOT let missing market endpoint make snapshotOk=false.
// - We will still include a safe market object with lastPrice derived from decision.price
//   so replay UI doesn’t crash.
//
// LOCKED: Never crash. If anything fails, write snapshot with ok:false (per section),
// but still write the file.

import path from "path";
import { writeReplaySnapshot } from "../logic/replay/writeSnapshot.js";
import { computeTradePermission as computeEngine6 } from "../logic/engine6TradePermission.js";
import { computeReadiness, pickZoneFromDecision, mapStrategyToMode } from "../logic/engine15Readiness.js";

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
// - Only trade in NEGOTIATED or INSTITUTIONAL zones
// - Allow "barely outside" with bufferPts = 0.25
// -------------------------
function buildEngine6InputFromDecision({ symbol, tf, decision }) {
  const BUFFER_PTS = 0.25; // ✅ locked choice

  const total = decision?.scores?.total;
  const invalid = Boolean(decision?.invalid);

  const engine5 = {
    total: typeof total === "number" ? total : 0,
    invalid,
    reasonCodes: Array.isArray(decision?.reasonCodes) ? decision.reasonCodes : [],
  };

  const price = typeof decision?.price === "number" ? decision.price : null;

  const ctx = decision?.context || {};
  const e1 = ctx.engine1 || {};
  const active = e1.active || {};

  const negotiated = active.negotiated || null;
  const institutional =
    active.institutional ||
    ctx.institutionalContainer ||
    null;

  function inRange(p, lo, hi, buf) {
    if (typeof p !== "number") return false;
    if (typeof lo !== "number" || typeof hi !== "number") return false;
    const low = Math.min(lo, hi) - buf;
    const high = Math.max(lo, hi) + buf;
    return p >= low && p <= high;
  }

  const inNegotiated = negotiated
    ? inRange(price, negotiated.lo, negotiated.hi, BUFFER_PTS)
    : false;

  const inInstitutional = institutional
    ? inRange(price, institutional.lo, institutional.hi, BUFFER_PTS)
    : false;

  const withinZone = Boolean(inNegotiated || inInstitutional);

  const zoneType = inNegotiated
    ? "NEGOTIATED"
    : inInstitutional
    ? "INSTITUTIONAL"
    : "NONE";

  const zoneContext = {
    withinZone,
    zoneType,
    bufferPts: BUFFER_PTS,
    source: institutional ? "engine1.active.institutional" : "none",
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
    marketMeter: null, // v1
    zoneContext,
    intent,
  };
}

function normalizePermissionResult(result) {
  if (!result) return null;
  return {
    state: result.permission || "STAND_DOWN",
    sizeMultiplier: typeof result.sizeMultiplier === "number" ? result.sizeMultiplier : 0,
    reasonCodes: Array.isArray(result.reasonCodes) ? result.reasonCodes : [],
    debug: result.debug || undefined,
  };
}

// -------------------------
// Strategies to store in snapshot (v1)
// -------------------------
const STRATEGIES = [
  { strategyId: "intraday_scalp@10m", tf: "10m" },
  { strategyId: "minor_swing@1h", tf: "1h" },
  { strategyId: "intermediate_long@4h", tf: "4h" },
];

// -------------------------
// Main job
// -------------------------
export async function main() {
  const { dateYmd, timeHHMM } = azNowParts(new Date());
  const dataDir = resolveReplayDataDir();
  const base = selfBaseUrl();
  const symbol = "SPY";

  // NOTE: Market endpoints are 404 in this container.
  // We will NOT call a market URL anymore. We will synthesize a safe market object
  // from decision price so the UI has a lastPrice to render.
  //
  // If you later add a real market endpoint, we can re-enable fetch safely.

  // Core snapshot sources
  const smzUrl = `${base}/api/v1/smz-hierarchy?symbol=${encodeURIComponent(symbol)}&tf=10m`;
  const fibUrl = `${base}/api/v1/fib-levels?symbol=${encodeURIComponent(symbol)}&tf=1h&degree=minor`;

  // Decisions for all strategies
  const decisionFetches = STRATEGIES.map(({ strategyId, tf }) => {
    const mode = mapStrategyToMode(strategyId);
    const url =
      `${base}/api/v1/confluence-score?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      `&strategyId=${encodeURIComponent(strategyId)}` +
      `&mode=${encodeURIComponent(mode)}`;
    return safeFetch(`decision:${strategyId}`, url);
  });

  const [smzRes, fibRes, ...decisionResults] = await Promise.all([
    safeFetch("structure.smzHierarchy", smzUrl),
    safeFetch("fib", fibUrl),
    ...decisionFetches,
  ]);

  // Build decisions map
  const decisionByStrategy = {};
  for (let i = 0; i < STRATEGIES.length; i++) {
    const s = STRATEGIES[i];
    const res = decisionResults[i];
    decisionByStrategy[s.strategyId] = res.ok ? res.data : { ok: false, error: res.error };
  }

  // Legacy scalp decision pointer
  const scalpDecision = decisionByStrategy["intraday_scalp@10m"] || { ok: false, error: "missing scalp decision" };

  // Synthesize market data (safe) from decision price
  const inferredPrice =
    typeof scalpDecision?.price === "number"
      ? scalpDecision.price
      : null;

  const marketSynthetic = {
    ok: false,
    error: "MARKET_ENDPOINT_NOT_FOUND_IN_CONTAINER",
    raw: {
      intraday: {
        lastPrice: inferredPrice,
      },
      price: inferredPrice,
    },
    inferredFrom: "decision.price",
  };

  const snapshot = {
    ok: true,
    tsUtc: new Date().toISOString(),
    symbol,

    // market is present so UI won’t crash, but marked ok:false
    market: marketSynthetic,

    structure: {
      smzHierarchy: smzRes.ok ? smzRes.data : { ok: false, error: smzRes.error },
    },

    fib: fibRes.ok ? fibRes.data : { ok: false, error: fibRes.error },

    // Legacy + new
    decision: scalpDecision,
    decisions: decisionByStrategy,

    meta: {
      schema: "replay-snapshot@v1",
      dateYmd,
      timeHHMM,
      dataDir,
    },
  };

  // -------------------------
  // Compute Engine 6 locally per strategy (LOCKED: never crash)
  // Writes into: snapshot.decisions[strategyId].permission
  // Keeps legacy: snapshot.decision.permission in sync with scalp
  // -------------------------
  try {
    for (const { strategyId, tf } of STRATEGIES) {
      const d = snapshot.decisions?.[strategyId];
      if (d && d.ok) {
        const e6Input = buildEngine6InputFromDecision({ symbol, tf, decision: d });
        const e6Result = computeEngine6(e6Input);
        d.permission = normalizePermissionResult(e6Result);
      } else if (d) {
        d.permission = null;
      }
    }

    if (snapshot.decision && snapshot.decision.ok) {
      snapshot.decision.permission =
        snapshot.decisions?.["intraday_scalp@10m"]?.permission ?? snapshot.decision.permission ?? null;
    } else if (snapshot.decision) {
      snapshot.decision.permission = null;
    }
  } catch (e) {
    for (const { strategyId } of STRATEGIES) {
      const d = snapshot.decisions?.[strategyId];
      if (d && d.ok && !d.permission) {
        d.permission = {
          state: "STAND_DOWN",
          sizeMultiplier: 0,
          reasonCodes: ["ENGINE6_COMPUTE_ERROR"],
          debug: { error: String(e?.message || e) },
        };
      }
    }

    if (snapshot.decision && snapshot.decision.ok && !snapshot.decision.permission) {
      snapshot.decision.permission = {
        state: "STAND_DOWN",
        sizeMultiplier: 0,
        reasonCodes: ["ENGINE6_COMPUTE_ERROR"],
        debug: { error: String(e?.message || e) },
      };
    }
  }

  // -------------------------
  // Compute Engine 15 readiness per strategy (Replay deterministic)
  // - Calls E3 (/reaction-score) using lo/hi (required today)
  // - Calls E4 (/volume-behavior) using zoneLo/zoneHi (required)
  // - Uses Engine 6 permission already attached into decision.permission
  //
  // LOCKED: Never crash. If anything fails, store ok:false.
  // -------------------------
  try {
    const engine15ByStrategy = {};

    for (const { strategyId, tf } of STRATEGIES) {
      const d = snapshot.decisions?.[strategyId];
      const mode = mapStrategyToMode(strategyId);

      const price =
        (typeof d?.price === "number" ? d.price : null) ??
        inferredPrice ??
        null;

      // IMPORTANT: We pick zone deterministically from decision.context (Replay safe)
      const zone = d && d.ok ? pickZoneFromDecision(d) : null;

      // If no zone exists, still store readiness object (WAIT)
      if (!zone || !Number.isFinite(zone.lo) || !Number.isFinite(zone.hi)) {
        engine15ByStrategy[strategyId] = computeReadiness({
          symbol,
          tf,
          strategyId,
          price,
          zone: null,
          engine3: null,
          engine4: null,
          permission: d?.permission || null,
        });
        continue;
      }

      const e3Url =
        `${base}/api/v1/reaction-score?symbol=${encodeURIComponent(symbol)}` +
        `&tf=${encodeURIComponent(tf)}` +
        `&mode=${encodeURIComponent(mode)}` +
        `&lo=${encodeURIComponent(zone.lo)}` +
        `&hi=${encodeURIComponent(zone.hi)}` +
        `&strategyId=${encodeURIComponent(strategyId)}`;

      const e4Url =
        `${base}/api/v1/volume-behavior?symbol=${encodeURIComponent(symbol)}` +
        `&tf=${encodeURIComponent(tf)}` +
        `&mode=${encodeURIComponent(mode)}` +
        `&zoneLo=${encodeURIComponent(zone.lo)}` +
        `&zoneHi=${encodeURIComponent(zone.hi)}`;

      const [e3Res, e4Res] = await Promise.all([
        safeFetch(`engine3:${strategyId}`, e3Url),
        safeFetch(`engine4:${strategyId}`, e4Url),
      ]);

      const engine3 = e3Res.ok ? e3Res.data : { ok: false, error: e3Res.error };
      const engine4 = e4Res.ok ? e4Res.data : { ok: false, error: e4Res.error };

      engine15ByStrategy[strategyId] = computeReadiness({
        symbol,
        tf,
        strategyId,
        price,
        zone,
        engine3,
        engine4,
        permission: d?.permission || null,
      });
    }

    snapshot.engine15 = {
      ok: true,
      schema: "engine15-readiness@v1",
      generatedAtUtc: snapshot.tsUtc,
      byStrategy: engine15ByStrategy,
    };
  } catch (e) {
    snapshot.engine15 = {
      ok: false,
      schema: "engine15-readiness@v1",
      error: String(e?.message || e),
      byStrategy: {},
    };
  }

  // -------------------------
  // Overall ok (still writes even if false)
  //
  // IMPORTANT FIX:
  // - Do NOT require market.ok (it is always false because endpoint is missing)
  // - Snapshot ok should reflect core deterministic sources only:
  //   smz + fib + all decisions
  // -------------------------
  const allDecisionsOk = STRATEGIES.every(({ strategyId }) => snapshot.decisions?.[strategyId]?.ok);
  snapshot.ok = Boolean(smzRes.ok && fibRes.ok && allDecisionsOk);

  const result = writeReplaySnapshot({ dataDir, dateYmd, timeHHMM, snapshot });

  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: result?.file,
        dateYmd,
        timeHHMM,
        snapshotOk: snapshot.ok,
        permission: snapshot?.decision?.permission || null,
        engine15Ok: Boolean(snapshot?.engine15?.ok),
        marketOk: snapshot?.market?.ok === true,
        marketError: snapshot?.market?.error || null,
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
