// server.js — single-file Express backend (CommonJS)
// Node 18+ recommended (global fetch available).
//
// Env vars:
//   PORT
//   CORS_ORIGIN                  e.g. "https://frye-dashboard.onrender.com,http://localhost:5173"
//   POLYGON_API_KEY              (optional; if missing, quotes/ohlc serve stub data)
//   MARKET_MONITOR_CSV_URL       (optional; Google Sheet "Publish to web" CSV)
//   SCHWAB_APP_KEY               (required for OAuth)
//   SCHWAB_APP_SECRET            (recommended; some tenants require Basic auth)
//   SCHWAB_REDIRECT_URI          e.g. "https://frye-dashboard-api.onrender.com/api/auth/schwab/callback"

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

// ---------- CORS ----------
const DEFAULT_ORIGINS = "https://frye-dashboard.onrender.com";
const ALLOW_LIST = String(process.env.CORS_ORIGIN || DEFAULT_ORIGINS)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---------- App ----------
const app = express();
app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("combined"));
app.use(
  cors({
    origin(origin, cb) {
      // allow server-to-server (no Origin) and explicit origins
      if (!origin || ALLOW_LIST.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
    credentials: false,
  })
);
app.options("*", cors());

// =========================
// Health
// =========================
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "backend", time: new Date().toISOString() });
});
app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "backend", alias: "/api/health", time: new Date().toISOString() });
});
app.get("/api/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "backend", alias: "/api/healthz", time: new Date().toISOString() });
});

// =========================
// Ping / Echo
// =========================
app.get("/api/ping", (_req, res) => res.json({ ok: true, message: "pong", ts: Date.now(), path: "/api/ping" }));
app.get("/api/v1/ping", (_req, res) => res.json({ ok: true, message: "pong", ts: Date.now(), path: "/api/v1/ping" }));
app.post("/api/v1/echo", (req, res) => res.json({ ok: true, received: req.body ?? null, ts: Date.now() }));

// =========================
// Quotes (Polygon or stub)
// =========================
app.get("/api/v1/quotes", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const key = process.env.POLYGON_API_KEY;

  // Stub
  if (!key) {
    const prevClose = 443.21;
    const price = 444.44;
    const change = +(price - prevClose).toFixed(2);
    const pct = +((change / prevClose) * 100).toFixed(2);
    return res.json({
      ok: true,
      symbol,
      price,
      prevClose,
      change,
      pct,
      time: new Date().toISOString(),
      source: "stub",
      note: "Set POLYGON_API_KEY to use live data",
    });
  }

  try {
    const encoded = encodeURIComponent(symbol);
    const [lastResp, prevResp] = await Promise.all([
      fetch(`https://api.polygon.io/v2/last/trade/${encoded}?apiKey=${key}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${encoded}/prev?adjusted=true&apiKey=${key}`),
    ]);
    const lastJson = await lastResp.json();
    const prevJson = await prevResp.json();
    if (!lastResp.ok) {
      return res.status(lastResp.status).json({ ok: false, error: lastJson?.error || "Polygon error", data: lastJson });
    }

    const results = lastJson?.results || {};
    const rawTs = results.t ?? Date.now();
    const tsMs = typeof rawTs === "number" && rawTs > 1e12 ? Math.round(rawTs / 1e6) : rawTs; // ns->ms if needed
    const price = results.p ?? results.price ?? null;

    const prevClose =
      Array.isArray(prevJson?.results) && prevJson.results[0] ? prevJson.results[0].c ?? null : null;

    let change = null,
      pct = null;
    if (typeof price === "number" && typeof prevClose === "number" && prevClose) {
      change = +(price - prevClose).toFixed(2);
      pct = +((change / prevClose) * 100).toFixed(2);
    }
    res.json({ ok: true, symbol, price, prevClose, change, pct, time: new Date(tsMs).toISOString(), source: "polygon" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =========================
// OHLC (Polygon or stub)
// =========================
app.get("/api/v1/ohlc", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.timeframe || "1m").toLowerCase(); // 1m,5m,15m,30m,1h,1d
    const now = new Date();
    const toISO = now.toISOString().slice(0, 10);

    const tfMap = {
      "1m": { mult: 1, span: "minute", lookbackDays: 2 },
      "5m": { mult: 5, span: "minute", lookbackDays: 7 },
      "15m": { mult: 15, span: "minute", lookbackDays: 14 },
      "30m": { mult: 30, span: "minute", lookbackDays: 30 },
      "1h": { mult: 60, span: "minute", lookbackDays: 30 },
      "1d": { mult: 1, span: "day", lookbackDays: 365 },
    };
    const cfg = tfMap[tf] || tfMap["1m"];
    const from = new Date(now.getTime() - cfg.lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const key = process.env.POLYGON_API_KEY;

    if (!key) {
      const n = 200;
      let price = 400;
      const out = [];
      for (let i = 0; i < n; i++) {
        const o = price;
        const h = o + Math.random() * 2;
        const l = o - Math.random() * 2;
        const c = l + Math.random() * (h - l);
        const v = Math.floor(1_000_000 * (0.6 + Math.random()));
        price = c;
        const t = Date.now() - (n - i) * cfg.mult * 60 * 1000; // spacing in ms
        out.push({ t, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v });
      }
      return res.json({ ok: true, symbol, timeframe: tf, source: "stub", bars: out });
    }

    const encoded = encodeURIComponent(symbol);
    const url = `https://api.polygon.io/v2/aggs/ticker/${encoded}/range/${cfg.mult}/${cfg.span}/${from}/${toISO}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: j?.error || "Polygon error", data: j });
    }
    const bars = Array.isArray(j?.results)
      ? j.results.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
      : [];
    res.json({ ok: true, symbol, timeframe: tf, source: "polygon", bars });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =========================
// Market Monitor CSV + Gauges
// =========================
const MARKET_MONITOR_CSV_URL = process.env.MARKET_MONITOR_CSV_URL || "";
const MM_GROUPS = [
  "Large Cap","Mid Cap","Small Cap",
  "Tech","Consumer","Healthcare","Financials",
  "Energy","Industrials","Materials","Defensive","Real Estate",
  "Communication Services","Utilities",
];

let _mmCache = { at: 0, rows: null };

function parseCsvSimple(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const rows = [];
  const nowYear = new Date().getFullYear();

  function num(v) { return Number(String(v).replace(/[^0-9.\-]/g, "")) || 0; }

  for (const line of lines) {
    const cols = line.split(",").map((s) => s.trim());
    const rawDate = cols[0];
    if (!rawDate || rawDate.toLowerCase().includes("date")) continue;

    let iso;
    if (rawDate.includes("/")) {
      const [m, d] = rawDate.split("/").map((v) => parseInt(v, 10));
      if (!m || !d) continue;
      iso = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      iso = `${nowYear}-${iso}`;
    } else {
      iso = rawDate.slice(0, 10);
    }

    const indices = { QQQ: num(cols[1]), SPY: num(cols[2]), MDY: num(cols[3]), IWM: num(cols[4]) };

    const groups = {};
    let base = 5;
    for (let i = 0; i < MM_GROUPS.length; i++) {
      const g = {
        "10NH": num(cols[base + 0]),
        "10NL": num(cols[base + 1]),
        "3U":   num(cols[base + 2]),
        "3D":   num(cols[base + 3]),
      };
      g.net = g["10NH"] - g["10NL"];
      groups[MM_GROUPS[i]] = g;
      base += 4;
    }
    rows.push({ date: iso, indices, groups });
  }
  return rows.filter((r) => r.date);
}

async function fetchMarketRows(limit = 30) {
  if (!MARKET_MONITOR_CSV_URL) return [];
  const now = Date.now();
  if (_mmCache.rows && now - _mmCache.at < 60_000) return _mmCache.rows.slice(-limit);

  const r = await fetch(MARKET_MONITOR_CSV_URL);
  if (!r.ok) throw new Error("CSV fetch failed");
  const csv = await r.text();
  const rows = parseCsvSimple(csv);
  _mmCache = { at: now, rows };
  return rows.slice(-limit);
}

app.get("/api/v1/market-monitor", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(365, Number(req.query.limit || 30)));
    const latest = String(req.query.latest || "false").toLowerCase() === "true";

    if (!MARKET_MONITOR_CSV_URL) {
      return res.status(200).json({ ok: true, source: "stub", rows: [] });
    }
    const rows = await fetchMarketRows(limit);
    const out = rows.slice(-limit);
    res.json({ ok: true, source: "sheet", rows: latest ? [out[out.length - 1]] : out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

const GAUGE_GROUPS_ENV = (process.env.GAUGE_GROUPS || "").split(",").map(s => s.trim()).filter(Boolean);
const GAUGE_ORDER = GAUGE_GROUPS_ENV.length ? GAUGE_GROUPS_ENV : MM_GROUPS;

app.get("/api/v1/gauges", async (req, res) => {
  try {
    const rows = await fetchMarketRows(2); // latest + previous
    if (!rows.length) return res.json({ ok: true, asOf: null, indices: {}, breadth: {} });

    const latest = rows[rows.length - 1];
    const prev   = rows.length > 1 ? rows[rows.length - 2] : null;

    const indices = latest.indices || {};

    const sum = (row, field) =>
      Object.values(row.groups || {}).reduce((a, g) => a + Number(g?.[field] || 0), 0);

    const totalNH = sum(latest, "10NH");
    const totalNL = sum(latest, "10NL");
    const totalNet = totalNH - totalNL;
    const prevTotalNet = prev ? (sum(prev, "10NH") - sum(prev, "10NL")) : null;

    const breadth = {
      total: { nh: totalNH, nl: totalNL, net: totalNet, deltaNet: prev ? (totalNet - prevTotalNet) : null },
    };

    for (const name of GAUGE_ORDER) {
      const g  = (latest.groups || {})[name] || {};
      const gp = prev ? ((prev.groups || {})[name] || {}) : null;

      const nh = Number(g["10NH"] || 0);
      const nl = Number(g["10NL"] || 0);
      const net = nh - nl;
      const prevNet = gp ? (Number(gp["10NH"] || 0) - Number(gp["10NL"] || 0)) : 0;

      breadth[name] = { nh, nl, net, deltaNet: prev ? (net - prevNet) : null };
    }

    return res.json({ ok: true, asOf: latest.date, indices, breadth });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// =========================
// Schwab OAuth (PKCE)
// =========================
const SCHWAB_AUTHORIZE = "https://api.schwabapi.com/v1/oauth/authorize";
const SCHWAB_TOKEN     = "https://api.schwabapi.com/v1/oauth/token";

let schwabTokens = null; // { access_token, refresh_token, expires_at }
const pkceMap = new Map(); // state -> { verifier, t }

function b64url(buf){ return buf.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function makePkce(){
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
function makeState(){ return b64url(crypto.randomBytes(16)); }

// Begin OAuth
app.get("/api/auth/schwab/login", (req, res) => {
  const clientId = process.env.SCHWAB_APP_KEY;
  const redirect = process.env.SCHWAB_REDIRECT_URI;
  if (!clientId || !redirect) return res.status(500).send("Missing SCHWAB_APP_KEY or SCHWAB_REDIRECT_URI");

  const { verifier, challenge } = makePkce();
  const state = makeState();
  pkceMap.set(state, { verifier, t: Date.now() });

  const url = new URL(SCHWAB_AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

// Callback -> Exchange code for tokens
app.get("/api/auth/schwab/callback", async (req, res) => {
  try {
    const code  = req.query.code;
    const state = req.query.state;
    const saved = pkceMap.get(state);
    if (!code || !saved) return res.status(400).send("Invalid/missing state or code");
    pkceMap.delete(state);

    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("code", String(code));
    form.set("redirect_uri", process.env.SCHWAB_REDIRECT_URI);
    form.set("client_id", process.env.SCHWAB_APP_KEY);
    form.set("code_verifier", saved.verifier);

    const basic = "Basic " + Buffer.from(
      (process.env.SCHWAB_APP_KEY || "") + ":" + (process.env.SCHWAB_APP_SECRET || "")
    ).toString("base64");

    const resp = await fetch(SCHWAB_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": basic
      },
      body: form
    });

    const json = await resp.json();
    if (!resp.ok) {
      console.error("Schwab token error:", json);
      return res.status(500).send("Token exchange failed — see logs.");
    }

    const now = Date.now();
    schwabTokens = {
      access_token:  json.access_token,
      refresh_token: json.refresh_token,
      expires_at:    now + (Number(json.expires_in || 0) * 1000)
    };

    res.send("Schwab connected ✅ — tokens received.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Auth callback error.");
  }
});

// Simple status
app.get("/api/auth/schwab/status", (req, res) => {
  const ok = !!(schwabTokens && schwabTokens.access_token);
  res.json({ ok, expires_at: schwabTokens?.expires_at || null });
});

// =========================
// 404 + Error handler
// =========================
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

app.use((err, _req, res, _next) => {
  const status = err?.status || 500;
  res.status(status).json({ ok: false, error: err?.message || "Server error" });
});

// =========================
// Start
// =========================
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  console.log("Allowed origins:", ALLOW_LIST.join(", ") || "(none)");
});
