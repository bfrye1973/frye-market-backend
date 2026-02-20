// services/core/routes/dashboardSnapshot.js
// ONE poll endpoint for Strategy Row
// - Pulls Engine 5 confluence (E1–E4 combined)
// - Pulls Engine 1 context (WHERE) for optional zoneContext
// - Calls Engine 6 v1 permission via POST with correct payload
// - ✅ Adds Engine 2 "Wave Phase" + FibScore block per Strategy card
//
// ✅ NEW (DISPLAY ONLY):
// - Adds "NEAR_ALLOWED_ZONE" status when price is within 1.50 pts of an allowed zone
// - Does NOT change Engine 6 permission rules
// - Allowed zones for this display: NEGOTIATED + INSTITUTIONAL only (Option 1 locked)

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

  const total =
    Number(confluenceJson?.scores?.total) ||
    Number(confluenceJson?.total) ||
    0;

  const label = confluenceJson?.scores?.label || confluenceJson?.label || null;
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
   ✅ NEW: Near allowed-zone arming (DISPLAY ONLY)
------------------------- */

const NEAR_ALLOWED_ZONE_WINDOW_PTS = 1.5;

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function distToZone(price, z) {
  const p = toNum(price);
  const lo = toNum(z?.lo);
  const hi = toNum(z?.hi);
  if (p == null || lo == null || hi == null) return null;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);

  if (p >= a && p <= b) return 0;
  return p < a ? (a - p) : (p - b);
}

function nearestAllowedZone({ price, negotiated = [], institutional = [] }) {
  let best = null;

  const scan = (arr, zoneType) => {
    const list = Array.isArray(arr) ? arr : [];
    for (const z of list) {
      const d = distToZone(price, z);
      if (d == null) continue;
      if (!best || d < best.distancePts) {
        best = {
          zoneType,
          id: z?.id ?? null,
          lo: z?.lo ?? null,
          hi: z?.hi ?? null,
          mid: z?.mid ?? null,
          strength: z?.strength ?? null,
          distancePts: d,
        };
      }
    }
  };

  scan(negotiated, "NEGOTIATED");
  scan(institutional, "INSTITUTIONAL");

  return best;
}

function applyNearAllowedZoneDisplay({ confluence, ctx }) {
  if (!confluence || typeof confluence !== "object") return confluence;

  const price = toNum(confluence?.price) ?? toNum(ctx?.meta?.current_price) ?? toNum(ctx?.meta?.currentPrice);

  // If no price, can't compute "near"
  if (price == null) return confluence;

  const loc = confluence.location || {};
  const state = String(loc.state || "");

  // Only apply when NOT in zone already
  if (state !== "NOT_IN_ZONE") return confluence;

  const negotiated = ctx?.render?.negotiated || [];
  const institutional = ctx?.render?.institutional || [];

  const nearest = nearestAllowedZone({ price, negotiated, institutional });

  if (!nearest || !Number.isFinite(nearest.distancePts)) return confluence;

  // We only care about "near" when outside (distance > 0)
  const near =
    nearest.distancePts > 0 &&
    nearest.distancePts <= NEAR_ALLOWED_ZONE_WINDOW_PTS;

  if (!near) {
    // still attach nearest (helpful display/debug) but do NOT change state
    return {
      ...confluence,
      location: {
        ...loc,
        nearAllowedZone: false,
        nearestAllowed: {
          zoneType: nearest.zoneType,
          zoneId: nearest.id,
          lo: nearest.lo,
          hi: nearest.hi,
          distancePts: Number(nearest.distancePts.toFixed(2)),
        },
      },
    };
  }

  // Upgrade display state (still does NOT change Engine 6)
  return {
    ...confluence,
    location: {
      ...loc,
      state: "NEAR_ALLOWED_ZONE",
      zoneType: nearest.zoneType,
      zoneId: nearest.id,
      nearAllowedZone: true,
      nearestAllowed: {
        zoneType: nearest.zoneType,
        zoneId: nearest.id,
        lo: nearest.lo,
        hi: nearest.hi,
        distancePts: Number(nearest.distancePts.toFixed(2)),
      },
    },
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
  const u = new URL(`${CORE_BASE}/api/v1/ohlc`);
  u.searchParams.set("symbol", symbol);

  // KEEP EXISTING (do not change): your ohlc route may accept timeframe internally
  u.searchParams.set("timeframe", tf);
  u.searchParams.set("limit", "1");

  const r = await fetchJson(u.toString(), { timeoutMs: 15000 });
  const j = r?.json;

  const bar =
    (Array.isArray(j) ? j[0] :
    (Array.isArray(j?.bars) ? j.bars[0] :
    (Array.isArray(j?.data) ? j.data[0] : null)));

  const t = Number(bar?.time ?? bar?.t ?? bar?.tSec);
  return Number.isFinite(t) ? t : null;
}

function calcFibScore(payloadW1, payloadW4) {
  const p = (payloadW1 && payloadW1.ok) ? payloadW1 : ((payloadW4 && payloadW4.ok) ? payloadW4 : null);
  if (!p) return { fibScore: 0, invalidated: false, anchorTag: null };

  const invalidated = !!p?.signals?.invalidated;
  const anchorTag = p?.signals?.tag ?? null;

  if (invalidated) return { fibScore: 0, invalidated: true, anchorTag };

  let score = 0;
  if (p?.signals?.inRetraceZone) score += 10;
  if (p?.signals?.near50) score += 10;

  return { fibScore: score, invalidated: false, anchorTag };
}

/**
 * ✅ CRITICAL FIX:
 * Reject placeholder marks like {p:0, tSec:null}
 * because Number(null) === 0 which was incorrectly treated as a real time.
 */
function isRealMark(m) {
  if (!m || typeof m !== "object") return false;

  const p = Number(m.p);
  const tSec = m.tSec;

  // SPY marks can’t be price 0; treat <=0 as placeholder
  if (!Number.isFinite(p) || p <= 0) return false;

  // tSec must be a real epoch seconds number (not null)
  if (typeof tSec !== "number" || !Number.isFinite(tSec) || tSec <= 0) return false;

  return true;
}

function computeWavePhaseFromMarks(waveMarks, lastBarTimeSec) {
  const order = ["W1", "W2", "W3", "W4", "W5"];
  const marksPresent = [];

  for (const k of order) {
    if (isRealMark(waveMarks?.[k])) marksPresent.push(k);
  }

  if (!marksPresent.length || typeof lastBarTimeSec !== "number" || !Number.isFinite(lastBarTimeSec)) {
    return { phase: "UNKNOWN", lastMark: null, nextMark: null, marksPresent };
  }

  let lastKey = null;
  for (const k of order) {
    const m = waveMarks?.[k];
    if (!isRealMark(m)) continue;
    if (m.tSec <= lastBarTimeSec) lastKey = k;
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
    lastMark: { key: lastKey, ...waveMarks[lastKey] },
    nextMark: nextKey ? { key: nextKey, ...waveMarks[nextKey] } : null,
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

  const includeContext =
    String(req.query.includeContext || "") === "1" ||
    String(req.query.includeContext || "").toLowerCase() === "true";

  const intentAction = (req.query.intent || "NEW_ENTRY").toString();

  const base = getBaseUrl(req);
  const now = new Date().toISOString();

  // LOCKED strategy mappings (existing)
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

  // ✅ ALWAYS fetch Engine 1 context per TF (used for NEAR_ALLOWED_ZONE display).
  // If includeContext=false, we use it internally but do not return it to client.
  const ctxAllResp = await Promise.all(
    strategies.map((s) =>
      fetchJson(`${base}/api/v1/engine5-context?symbol=${symbol}&tf=${s.tf}`)
    )
  );

  // Step 3: call Engine 6 v1 via POST for each strategy (correct payload)
  const permissionUrl = `${base}/api/v1/trade-permission`;

  const permissionBodies = strategies.map((s, i) => {
    const con = confluenceResp[i]?.json;
    const engine5 = normalizeEngine5ForEngine6(con);

    // Keep existing includeContext behavior for payload (only attach zoneContext when requested)
    const zoneContext = includeContext ? buildZoneContext(ctxAllResp[i]?.json) : null;

    return {
      symbol,
      tf: s.tf,
      engine5,
      marketMeter: null,
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

  // Step 4: attach Engine 2 per strategy (LOCKED mapping)
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
    const ctx = ctxAllResp[i];

    // ✅ DISPLAY ONLY: apply NEAR_ALLOWED_ZONE based on ctx.render (negotiated + institutional)
    const rawConfluence = con.json || { ok: false, status: con.status, error: con.text };
    const patchedConfluence =
      (ctx?.ok !== false && ctx?.json)
        ? applyNearAllowedZoneDisplay({ confluence: rawConfluence, ctx: ctx.json })
        : rawConfluence;

    out.strategies[s.strategyId] = {
      strategyId: s.strategyId,
      tf: s.tf,
      degree: s.degree,
      wave: s.wave,

      confluence: patchedConfluence,
      permission: perm.json || { ok: false, status: perm.status, error: perm.text },

      // ✅ NEW: Engine 2 summary block for Strategy cards
      engine2: engine2ByStrategy[s.strategyId] || undefined,

      // Preserve existing includeContext output behavior
      context: includeContext
        ? ctx?.json || { ok: false, status: ctx?.status || 0, error: ctx?.text || "no_context" }
        : undefined,
    };
  });

  res.json(out);
});

export default router;
