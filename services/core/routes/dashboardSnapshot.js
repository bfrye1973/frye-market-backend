// services/core/routes/dashboardSnapshot.js
// ONE poll endpoint for Strategy Row
// - Pulls Engine 5 confluence (E1–E4 combined)
// - Pulls Engine 1 context (WHERE) for optional zoneContext
// - Calls Engine 6 v1 permission via POST with correct payload
// - ✅ Adds Engine 2 "Wave Phase" + FibScore block per Strategy card
//
// Engine 2 mapping (LOCKED for Strategy cards):
// - Scalp card  -> degree=minor,        tf=1h
// - Swing card  -> degree=intermediate, tf=1h
// - Long card   -> degree=primary,      tf=1d
// - Minute/10m  -> display-only later (NOT gating)  (not attached here)

import express from "express";

const router = express.Router();

/* -------------------------
   helpers
------------------------- */
function getBaseUrl(req) {
  const proto =
    (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim() ||
    req.protocol;
  return `${proto}://${req.get("host")}`;
}

async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function postJson(url, body, { timeoutMs = 25000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// Normalize Engine 5 output → the minimal Engine 6 v1 expects
function normalizeEngine5ForEngine6(confluenceJson) {
  if (!confluenceJson || typeof confluenceJson !== "object") {
    return { invalid: false, total: 0, reasonCodes: [] };
  }

  const invalid = Boolean(confluenceJson.invalid);
  const reasonCodes = Array.isArray(confluenceJson.reasonCodes)
    ? confluenceJson.reasonCodes
    : [];

  // Engine 5 total usually lives at scores.total; fallback to other shapes
  const total =
    Number(confluenceJson?.scores?.total) ||
    Number(confluenceJson?.total) ||
    0;

  const label =
    confluenceJson?.scores?.label ||
    confluenceJson?.label ||
    null;

  const flags = confluenceJson?.flags || null;
  const compression = confluenceJson?.compression || null;
  const bias = confluenceJson?.bias ?? null;

  return { invalid, total, reasonCodes, label, flags, compression, bias };
}

function buildZoneContext(engine1ContextJson) {
  if (!engine1ContextJson || typeof engine1ContextJson !== "object") return null;

  return {
    meta: engine1ContextJson.meta || null,
    active: engine1ContextJson.active || null,
    nearest: engine1ContextJson.nearest || null,
  };
}

/* -------------------------
   Engine 2 (Fib + Elliott) attach helpers
------------------------- */

// Prefer loopback inside backend-1/core for cron + internal calls.
const CORE_BASE = process.env.CORE_BASE || "http://127.0.0.1:10000";

// LOCKED mapping for Strategy cards (E2 display)
const ENGINE2_MAP = {
  intraday_scalp: { degree: "minor", tf: "1h" },        // Scalp card shows Minor 1h
  minor_swing:    { degree: "intermediate", tf: "1h" }, // Swing card shows Intermediate 1h
  intermediate_long: { degree: "primary", tf: "1d" },   // Long card shows Primary 1d
};

// Simple bucketing from your existing strategyIds
function bucketForStrategyId(strategyId) {
  const id = String(strategyId || "");
  if (id.startsWith("intraday_scalp")) return "intraday_scalp";
  if (id.startsWith("minor_swing")) return "minor_swing";
  if (id.startsWith("intermediate_long")) return "intermediate_long";
  return null;
}

async function fetchFibLevels({ symbol, tf, degree, wave }) {
  const u = new URL(`${CORE_BASE}/api/v1/fib-levels`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("tf", tf);
  u.searchParams.set("degree", degree);
  u.searchParams.set("wave", wave);
  const r = await fetchJson(u.toString(), { timeoutMs: 15000 });
  return r?.json || { ok: false };
}

async function fetchLastBarTimeSec({ symbol, tf }) {
  // Engine 5 confirmed this is reliable.
  const u = new URL(`${CORE_BASE}/api/v1/ohlc`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("timeframe", tf);
  u.searchParams.set("limit", "1");

  const r = await fetchJson(u.toString(), { timeoutMs: 15000 });
  const j = r?.json;

  // Support common shapes: {bars:[...]}, {data:[...]}, or direct array
  const bar =
    (Array.isArray(j) ? j[0] :
    (Array.isArray(j?.bars) ? j.bars[0] :
    (Array.isArray(j?.data) ? j.data[0] : null)));

  const t = Number(bar?.time ?? bar?.t ?? bar?.tSec);
  return Number.isFinite(t) ? t : null;
}

function calcFibScore(payloadW1, payloadW4) {
  // prefer W1 if ok, else W4
  const p = (payloadW1 && payloadW1.ok) ? payloadW1 : ((payloadW4 && payloadW4.ok) ? payloadW4 : null);
  if (!p) return { fibScore: 0, invalidated: false, anchorTag: null };

  const invalidated = !!p?.signals?.invalidated;
  const anchorTag = p?.signals?.tag ?? null;

  if (invalidated) {
    return { fibScore: 0, invalidated: true, anchorTag };
  }

  let score = 0;
  if (p?.signals?.inRetraceZone) score += 10;
  if (p?.signals?.near50) score += 10;

  return { fibScore: score, invalidated: false, anchorTag };
}

function computeWavePhaseFromMarks(waveMarks, lastBarTimeSec) {
  const order = ["W1", "W2", "W3", "W4", "W5"];
  const marksPresent = [];

  for (const k of order) {
    const m = waveMarks?.[k];
    if (m && Number.isFinite(Number(m.tSec)) && Number.isFinite(Number(m.p))) {
      marksPresent.push(k);
    }
  }

  if (!marksPresent.length || !Number.isFinite(Number(lastBarTimeSec))) {
    return { phase: "UNKNOWN", lastMark: null, nextMark: null, marksPresent };
  }

  let lastKey = null;
  for (const k of order) {
    const tSec = Number(waveMarks?.[k]?.tSec);
    if (!Number.isFinite(tSec)) continue;
    if (tSec <= lastBarTimeSec) lastKey = k;
  }

  if (!lastKey) {
    const nk = marksPresent[0] || null;
    return {
      phase: "PRE_W1",
      lastMark: null,
      nextMark: nk ? { key: nk, ...waveMarks[nk] } : null,
      marksPresent,
    };
  }

  const lastIdx = order.indexOf(lastKey);
  let nextKey = null;
  for (let i = lastIdx + 1; i < order.length; i++) {
    const k = order[i];
    if (marksPresent.includes(k)) { nextKey = k; break; }
  }

  return {
    phase: `IN_${lastKey}`,
    lastMark: waveMarks?.[lastKey] ? { key: lastKey, ...waveMarks[lastKey] } : null,
    nextMark: nextKey && waveMarks?.[nextKey] ? { key: nextKey, ...waveMarks[nextKey] } : null,
    marksPresent,
  };
}

async function buildEngine2Block({ symbol, degree, tf }) {
  const [w1, w4, lastBarTimeSec] = await Promise.all([
    fetchFibLevels({ symbol, tf, degree, wave: "W1" }).catch(() => ({ ok: false })),
    fetchFibLevels({ symbol, tf, degree, wave: "W4" }).catch(() => ({ ok: false })),
    fetchLastBarTimeSec({ symbol, tf }).catch(() => null),
  ]);

  const ok = !!(w1?.ok || w4?.ok);

  const { fibScore, invalidated, anchorTag } = calcFibScore(w1, w4);

  // wave marks usually live under W1 payload; fallback to W4
  const waveMarks =
    (w1?.ok ? w1?.anchors?.waveMarks : null) ||
    (w4?.ok ? w4?.anchors?.waveMarks : null) ||
    null;

  const { phase, lastMark, nextMark, marksPresent } = computeWavePhaseFromMarks(
    waveMarks,
    lastBarTimeSec
  );

  return {
    degree,
    tf,
    ok,
    waveRequested: (w4?.ok ? "W4" : (w1?.ok ? "W1" : null)),
    fibScore,
    invalidated,
    phase,
    lastMark,
    nextMark,
    marksPresent,
    anchorTag: anchorTag ?? null,
  };
}

/* -------------------------
   route
------------------------- */
router.get("/dashboard-snapshot", async (req, res) => {
  const symbol = (req.query.symbol || "SPY").toString().toUpperCase();

  // includeContext=1 returns Engine1 context in payload (and sends zoneContext to Engine6)
  const includeContext =
    String(req.query.includeContext || "") === "1" ||
    String(req.query.includeContext || "").toLowerCase() === "true";

  // For Engine 6 intent (optional)
  const intentAction = (req.query.intent || "NEW_ENTRY").toString();

  const base = getBaseUrl(req);
  const now = new Date().toISOString();

  // LOCKED Strategy row cards (these are Engine 5/6 frames)
  // NOTE: We do NOT change these here (to avoid breaking current behavior).
  // We only attach Engine 2 block for Elliott phase display using the LOCKED mapping above.
  const strategies = [
    { strategyId: "intraday_scalp@10m", tf: "10m", degree: "minute", wave: "W1" },
    { strategyId: "minor_swing@1h", tf: "1h", degree: "minor", wave: "W1" },
    { strategyId: "intermediate_long@4h", tf: "4h", degree: "intermediate", wave: "W1" },
  ];

  // Step 1: fetch Engine 5 confluence for each strategy
  const confluenceUrls = strategies.map(
    (s) =>
      `${base}/api/v1/confluence-score?symbol=${symbol}&tf=${s.tf}&degree=${s.degree}&wave=${s.wave}`
  );

  const confluenceResp = await Promise.all(confluenceUrls.map((u) => fetchJson(u)));

  // Step 2: optionally fetch Engine 1 context per TF (for zoneContext + debug)
  const ctxResp = includeContext
    ? await Promise.all(
        strategies.map((s) =>
          fetchJson(`${base}/api/v1/engine5-context?symbol=${symbol}&tf=${s.tf}`)
        )
      )
    : [];

  // Step 3: call Engine 6 v1 via POST for each strategy (correct payload)
  const permissionUrl = `${base}/api/v1/trade-permission`;

  const permissionBodies = strategies.map((s, i) => {
    const con = confluenceResp[i]?.json;
    const engine5 = normalizeEngine5ForEngine6(con);
    const zoneContext = includeContext ? buildZoneContext(ctxResp[i]?.json) : null;

    return {
      symbol,
      tf: s.tf,
      engine5,
      marketMeter: null, // optional, fill later when Market Meter pipeline is stable
      zoneContext,
      intent: { action: intentAction },
    };
  });

  const permissionResp = await Promise.all(
    permissionBodies.map((body) => postJson(permissionUrl, body))
  );

  // Build output
  const out = {
    ok: true,
    symbol,
    now,
    includeContext,
    strategies: {},
  };

  // Step 4: attach Engine 2 (Elliott phase + fib score) per strategy card (LOCKED mapping)
  // This is display/stability for the Strategy row: "Minor 1h — IN_W4 — FibScore 10/20 — invalidated:false"
  const engine2Promises = strategies.map(async (s) => {
    const bucket = bucketForStrategyId(s.strategyId);
    const map = bucket ? ENGINE2_MAP[bucket] : null;
    if (!map) return { strategyId: s.strategyId, engine2: null };

    try {
      const engine2 = await buildEngine2Block({
        symbol,
        degree: map.degree,
        tf: map.tf,
      });
      return { strategyId: s.strategyId, engine2 };
    } catch {
      return {
        strategyId: s.strategyId,
        engine2: {
          degree: map.degree,
          tf: map.tf,
          ok: false,
          waveRequested: null,
          fibScore: 0,
          invalidated: false,
          phase: "UNKNOWN",
          lastMark: null,
          nextMark: null,
          marksPresent: [],
          anchorTag: null,
          error: "ENGINE2_ATTACH_FAILED",
        },
      };
    }
  });

  const engine2ByStrategy = {};
  const engine2Results = await Promise.all(engine2Promises);
  engine2Results.forEach((r) => {
    engine2ByStrategy[r.strategyId] = r.engine2;
  });

  strategies.forEach((s, i) => {
    const con = confluenceResp[i];
    const perm = permissionResp[i];
    const ctx = includeContext ? ctxResp[i] : null;

    out.strategies[s.strategyId] = {
      strategyId: s.strategyId,
      tf: s.tf,
      degree: s.degree,
      wave: s.wave,

      confluence: con.json || { ok: false, status: con.status, error: con.text },
      permission: perm.json || { ok: false, status: perm.status, error: perm.text },

      // ✅ NEW: Engine 2 summary block for Strategy cards
      engine2: engine2ByStrategy[s.strategyId] || undefined,

      context: includeContext
        ? ctx?.json || { ok: false, status: ctx?.status || 0, error: ctx?.text || "no_context" }
        : undefined,
    };
  });

  res.json(out);
});

export default router;
