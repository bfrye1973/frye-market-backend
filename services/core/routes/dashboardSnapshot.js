// services/core/routes/dashboardSnapshot.js
// ONE poll endpoint for Strategy Row
// - Pulls Engine 5 confluence (E1–E4 combined)
// - Pulls Engine 1 context (WHERE) for optional zoneContext
// - Calls Engine 6 v1 permission via POST with correct payload

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
    const r = await fetch(url, { signal: controller.signal });
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

  // Keep extra fields if present (Engine 6 can ignore them safely)
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

  // Keep this light but useful for Engine 6 / UI explainability
  return {
    meta: engine1ContextJson.meta || null,
    active: engine1ContextJson.active || null,
    nearest: engine1ContextJson.nearest || null,
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

  // LOCKED strategy mappings
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

      context: includeContext
        ? ctx?.json || { ok: false, status: ctx?.status || 0, error: ctx?.text || "no_context" }
        : undefined,
    };
  });

  res.json(out);
});

export default router;
