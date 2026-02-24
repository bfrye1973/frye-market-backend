// services/core/jobs/writeReplaySnapshot.js
//
// Replay cadence snapshot writer (HHMM.json)
// - Builds snapshot by calling local backend-1 endpoints (market, smz, fib, decision)
// - Adds Engine 6 permission into: decision.permission ✅
// - Computes Engine 6 permission LOCALLY (no /trade-permission HTTP) ✅
// - Uses buffered withinZone logic (bufferPts = 0.25) ✅
// - Computes Engine 15 readiness (E3 + E4 glue) and stores into snapshot.engine15 ✅
//
// LOCKED: Never crash. If anything fails, write snapshot with ok:false.
//
// IMPORTANT (Replay determinism):
// - Replay is deterministic ONLY for what is stored in the snapshot file.
// - Therefore Engine 15 must be computed NOW (at snapshot-write time), not during replay playback.

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
  const BUFFER_PTS = 0.25; // ✅ your choice

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

  // Primary: engine1.active.*
  const negotiated = active.negotiated || null;
  const institutional =
    active.institutional ||
    // Fallback: sometimes institutional is the "institutionalContainer" style
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
    marketMeter: null, // v1 defaults are OK
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
// Strategies we store in snapshot (v1)
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

  // Core snapshot sources (already in your v1 design)
  const marketUrl = `${base}/api/v1/market-meter?mode=intraday`;
  const smzUrl = `${base}/api/v1/smz-hierarchy?symbol=${encodeURIComponent(symbol)}&tf=10m`;
  const fibUrl = `${base}/api/v1/fib-levels?symbol=${encodeURIComponent(symbol)}&tf=1h&degree=minor`;

  // Decisions for all strategies (additive; keeps old snapshot.decision behavior)
  const decisionFetches = STRATEGIES.map(({ strategyId, tf }) => {
    const mode = mapStrategyToMode(strategyId);
    const url =
      `${base}/api/v1/confluence-score?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      `&strategyId=${encodeURIComponent(strategyId)}` +
      `&mode=${encodeURIComponent(mode)}`;
    return safeFetch(`decision:${strategyId}`, url);
  });

  const [marketRes, smzRes, fibRes, ...decisionResults] = await Promise.all([
    safeFetch("market", marketUrl),
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

  // Keep legacy snapshot.decision pointing to scalp (so existing UI doesn’t break)
  const scalpDecision = decisionByStrategy["intraday_scalp@10m"] || { ok: false, error: "missing scalp decision" };

  const snapshot = {
    ok: true,
    tsUtc: new Date().toISOString(),
    symbol,

    market: marketRes.ok ? marketRes.data : { ok: false, error: marketRes.error },

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
        const e6Input = buildEngine6InputFromDecision({
          symbol,
          tf,
          decision: d,
        });
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
    // Never crash: default permission
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

      // Price: decision.price is best. Fallback to market raw (best-effort).
      const price =
        (typeof d?.price === "number" ? d.price : null) ??
        (typeof snapshot?.market?.raw?.intraday?.lastPrice === "number" ? snapshot.market.raw.intraday.lastPrice : null) ??
        (typeof snapshot?.market?.raw?.price === "number" ? snapshot.market.raw.price : null) ??
        null;

      // Zone: pick from decision context (deterministic)
      const zone = d && d.ok ? pickZoneFromDecision(d) : null;

      // If no zone, still produce a readiness object (WAIT) without crashing
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

      // Engine 3 (Reaction) — requires lo/hi OR zoneId
      const e3Url =
        `${base}/api/v1/reaction-score?symbol=${encodeURIComponent(symbol)}` +
        `&tf=${encodeURIComponent(tf)}` +
        `&mode=${encodeURIComponent(mode)}` +
        `&lo=${encodeURIComponent(zone.lo)}` +
        `&hi=${encodeURIComponent(zone.hi)}` +
        `&strategyId=${encodeURIComponent(strategyId)}`;

      // Engine 4 (Volume) — requires zoneLo/zoneHi
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
  // Snapshot ok should reflect the core sources only (not Engine 15 additive)
  // -------------------------
  const allDecisionsOk = STRATEGIES.every(({ strategyId }) => snapshot.decisions?.[strategyId]?.ok);
  snapshot.ok = Boolean(marketRes.ok && smzRes.ok && fibRes.ok && allDecisionsOk);

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
        // Keep old log fields:
        permission: snapshot?.decision?.permission || null,
        // New:
        engine15Ok: Boolean(snapshot?.engine15?.ok),
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
