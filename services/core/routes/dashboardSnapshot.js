// services/core/routes/dashboardSnapshot.js
// Engine 5 teammate — Dashboard Snapshot (ONE poll for Strategy Row)
// Returns: confluence (E1–E4 via Engine 5) + permission (Engine 6) for 3 locked strategies
// Optional: include Engine 1 context per TF for debug

import express from "express";

const router = express.Router();

// ---- helpers ----
function getBaseUrl(req) {
  const proto =
    (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim() ||
    req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`;
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
    } catch {
      // keep json null
    }
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

router.get("/dashboard-snapshot", async (req, res) => {
  const symbol = (req.query.symbol || "SPY").toString().toUpperCase();

  // Optional flags
  const includeContext =
    (req.query.includeContext || "").toString() === "1" ||
    (req.query.includeContext || "").toString().toLowerCase() === "true";

  // Locked strategy mappings
  const strategies = [
    {
      strategyId: "intraday_scalp@10m",
      tf: "10m",
      degree: "minute",
      wave: "W1",
    },
    {
      strategyId: "minor_swing@1h",
      tf: "1h",
      degree: "minor",
      wave: "W1",
    },
    {
      strategyId: "intermediate_long@4h",
      tf: "4h",
      degree: "intermediate",
      wave: "W1",
    },
  ];

  const base = getBaseUrl(req);
  const now = new Date().toISOString();

  // Build URLs
  const ctxUrls = strategies.map(
    (s) => `${base}/api/v1/engine5-context?symbol=${symbol}&tf=${s.tf}`
  );

  const confluenceUrls = strategies.map(
    (s) =>
      `${base}/api/v1/confluence-score?symbol=${symbol}&tf=${s.tf}&degree=${s.degree}&wave=${s.wave}`
  );

  // Engine 6 route assumption:
  // GET /api/v1/trade-permission?symbol=SPY&strategyId=minor_swing@1h
  // If your actual Engine 6 route differs, change ONLY this URL builder.
  const permissionUrls = strategies.map(
    (s) =>
      `${base}/api/v1/trade-permission?symbol=${symbol}&strategyId=${encodeURIComponent(
        s.strategyId
      )}`
  );

  // Fetch in parallel
  const [ctxResp, confluenceResp, permissionResp] = await Promise.all([
    includeContext ? Promise.all(ctxUrls.map((u) => fetchJson(u))) : Promise.resolve([]),
    Promise.all(confluenceUrls.map((u) => fetchJson(u))),
    Promise.all(permissionUrls.map((u) => fetchJson(u))),
  ]);

  // Shape response
  const out = {
    ok: true,
    symbol,
    now,
    strategies: {},
    // lightweight debug summary (helps you see if one TF is stale)
    debug: {
      base,
      includeContext,
    },
  };

  strategies.forEach((s, i) => {
    const con = confluenceResp[i];
    const perm = permissionResp[i];

    out.strategies[s.strategyId] = {
      strategyId: s.strategyId,
      tf: s.tf,
      degree: s.degree,
      wave: s.wave,

      confluence: con.json || { ok: false, status: con.status, error: con.text },
      permission: perm.json || { ok: false, status: perm.status, error: perm.text },

      // Only included if includeContext=1
      context: includeContext
        ? ctxResp[i]?.json || { ok: false, status: ctxResp[i]?.status || 0, error: ctxResp[i]?.text || "no_context" }
        : undefined,
    };
  });

  res.json(out);
});

export default router;
