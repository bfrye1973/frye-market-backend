// server.js — Ferrari Cluster Live Feed (Sheets by Metric + WS, with redirect follow + debug)
// Node 18+, npm i express cors morgan ws

/* ========================= Imports & Setup ========================= */
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const http = require("http");
const { WebSocketServer } = require("ws");
const https = require("https");
const { URL } = require("url");

/* ========================= Config ========================= */
const PORT = process.env.PORT || 8080;
const ALLOW = String(process.env.CORS_ORIGIN || "https://frye-dashboard.onrender.com")
  .split(",").map(s => s.trim()).filter(Boolean);

const REQUIRE_TOKEN = String(process.env.REQUIRE_TOKEN || "0") === "1";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

// You can point all three to the same published Exports CSV link
const MOMENTUM_SHEET_CSV_URL = process.env.MOMENTUM_SHEET_CSV_URL || ""; // Metric=SPEED (0..220)
const BREADTH_SHEET_CSV_URL  = process.env.BREADTH_SHEET_CSV_URL  || ""; // Metric=FUEL  (0..100)
const HEALTH_SHEET_CSV_URL   = process.env.HEALTH_SHEET_CSV_URL   || ""; // Metric=HEALTH(0..100)
const OHLC_CSV_URL           = process.env.OHLC_CSV_URL           || ""; // optional → /gauges/rpm (0..9000)

/* ========================= App ========================= */
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan("tiny"));
app.use(cors({
  origin(origin, cb) { if (!origin || ALLOW.includes(origin)) return cb(null, true); return cb(new Error("CORS blocked")); },
  credentials: false,
}));
app.options("*", cors());

function authMiddleware(req, res, next) {
  if (!REQUIRE_TOKEN) return next();
  const hdr = req.headers["authorization"] || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (token && token === AUTH_TOKEN) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "tos-backend",
    time: new Date().toISOString(),
    sheets: {
      momentum: !!MOMENTUM_SHEET_CSV_URL,
      breadth:  !!BREADTH_SHEET_CSV_URL,
      health:   !!HEALTH_SHEET_CSV_URL,
      ohlc:     !!OHLC_CSV_URL
    }
  })
);

/* ========================= State ========================= */
const state = {
  rpm: 5200, // 0..9000
  speed: 0,  // 0..220
  water: 0,  // 0..100
  oil: 55,   // placeholder (future)
  fuel: 0,   // 0..100
  lights: { breakout:false, buy:false, sell:false, emaCross:false, stop:false, trail:false, pad1:false, pad2:false, pad3:false, pad4:false },
};

/* ========================= Helpers ========================= */
function clamp(n, lo, hi, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, x));
}

// Follow redirects (301/302/303/307/308) up to 5 hops
function fetchTextFollow(urlStr, hops = 0) {
  return new Promise((resolve) => {
    if (!urlStr) return resolve(null);
    const u = new URL(urlStr);

    const opts = {
      method: "GET",
      headers: {
        "User-Agent": "Ferrari-Dashboard/1.0 (+node)",
        "Accept": "text/csv, text/plain, */*"
      }
    };

    const handler = (res) => {
      const code = res.statusCode || 0;
      const loc = res.headers.location;
      if ([301,302,303,307,308].includes(code) && loc && hops < 5) {
        const next = new URL(loc, u).toString();
        res.resume(); // drain
        return resolve(fetchTextFollow(next, hops + 1));
      }
      let data = "";
      res.on("data", (d) => data += d.toString("utf8"));
      res.on("end", () => resolve(data));
    };

    const req = (u.protocol === "http:" ? http : https).request(u, opts, handler);
    req.on("error", () => resolve(null));
    req.end();
  });
}

// CSV parser
function parseCSV(text) {
  if (!text) return { headers: [], rows: [] };
  const lines = text.replace(/\r/g, "").trim().split("\n");
  if (!lines.length) return { headers: [], rows: [] };
  // Strip potential BOM
  if (lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].slice(1);
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const s = lines[i]; if (!s) continue;
    const cols = [];
    let cur = "", inQ = false;
    for (let j=0;j<s.length;j++){
      const ch = s[j];
      if (ch === '"'){ if (inQ && s[j+1] === '"'){ cur+='"'; j++; } else { inQ=!inQ; } }
      else if (ch === ',' && !inQ){ cols.push(cur); cur=""; }
      else { cur += ch; }
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, k) => obj[h] = (cols[k] ?? "").trim());
    rows.push(obj);
  }
  return { headers, rows, raw: text.slice(0, 300) };
}

// Get numeric Value by Metric name from Exports CSV
function getMetricValue(csvText, metricName, fieldName = "Value") {
  const { headers, rows } = parseCSV(csvText || "");
  if (!headers.length || !rows.length) return null;
  const metricKey = headers.find(h => h.toLowerCase() === "metric");
  const valueKey  = headers.find(h => h.toLowerCase() === fieldName.toLowerCase()) || fieldName;
  if (!metricKey || !valueKey) return null;
  const row = rows.find(r => String(r[metricKey]).toUpperCase() === String(metricName).toUpperCase());
  if (!row) return null;
  const n = Number(String(row[valueKey]).replace(/[^0-9.\-]+/g, ""));
  return Number.isFinite(n) ? n : null;
}

/* ========================= Sheets → Gauges ========================= */
async function updateFromSheets() {
  try {
    // fetch each unique URL once
    const urls = [MOMENTUM_SHEET_CSV_URL, BREADTH_SHEET_CSV_URL, HEALTH_SHEET_CSV_URL].filter(Boolean);
    const uniq = [...new Set(urls)];
    const cache = {};
    await Promise.all(uniq.map(async (u) => { cache[u] = await fetchTextFollow(u); }));

    // SPEED (SPEED row)
    if (MOMENTUM_SHEET_CSV_URL) {
      const t = cache[MOMENTUM_SHEET_CSV_URL];
      const n = getMetricValue(t, "SPEED");
      if (n != null) state.speed = clamp(n, 0, 220, state.speed);
    }
    // FUEL (FUEL row)
    if (BREADTH_SHEET_CSV_URL) {
      const t = cache[BREADTH_SHEET_CSV_URL];
      const n = getMetricValue(t, "FUEL");
      if (n != null) state.fuel = clamp(n, 0, 100, state.fuel);
    }
    // HEALTH → water (HEALTH row)
    if (HEALTH_SHEET_CSV_URL) {
      const t = cache[HEALTH_SHEET_CSV_URL];
      const n = getMetricValue(t, "HEALTH");
      if (n != null) state.water = clamp(n, 0, 100, state.water);
    }
  } catch (e) {
    console.error("updateFromSheets error:", e?.message || e);
  }
}
setInterval(updateFromSheets, 2000);

/* ========================= Optional OHLC → RPM ========================= */
function ema(prev, value, alpha) { return prev == null ? value : prev + alpha * (value - prev); }
function rollingStd(values, period) {
  const n = values.length; if (n < period) return null;
  const slice = values.slice(n - period);
  const avg = slice.reduce((a,b)=>a+b,0) / period;
  const v = slice.reduce((a,b)=>a+(b-avg)*(b-avg),0) / period;
  return Math.sqrt(v);
}
function computeATR(ohlc, period) {
  let atr = null, alpha = 2 / (period + 1);
  for (let k = 0; k < ohlc.length; k++) {
    const cPrev = k > 0 ? ohlc[k-1].c : ohlc[k].c;
    const tr = Math.max(ohlc[k].h - ohlc[k].l, Math.abs(ohlc[k].h - cPrev), Math.abs(ohlc[k].l - cPrev));
    atr = ema(atr, tr, alpha);
  }
  return atr;
}
function parseOHLC(csvText) {
  const { headers, rows } = parseCSV(csvText || "");
  if (!rows.length) return [];
  const pick = (name) => headers.find(h => h.toLowerCase().includes(name));
  const map = { o: pick("open") || "open", h: pick("high") || "high", l: pick("low") || "low", c: pick("close") || "close" };
  const out = [];
  for (const r of rows) {
    const o = Number(r[map.o]); const h = Number(r[map.h]); const l = Number(r[map.l]); const c = Number(r[map.c]);
    if ([o,h,l,c].every(Number.isFinite)) out.push({ o,h,l,c });
  }
  return out;
}
async function updateRPMFromOHLC() {
  if (!OHLC_CSV_URL) return;
  try {
    const text = await fetchTextFollow(OHLC_CSV_URL);
    const ohlc = parseOHLC(text);
    const N = 20, kKC = 1.5;
    const closes = ohlc.map(x => x.c);
    if (closes.length < N + 1) return;
    const std = rollingStd(closes, N); if (std == null) return;
    const bbWidth = 4 * std;
    const atrN = computeATR(ohlc, N);
    const kcWidth = 2 * atrN * kKC;
    const pressure = Math.max(0, kcWidth - bbWidth) / (kcWidth + 1e-9);
    state.rpm = Math.round(clamp(pressure, 0, 1) * 9000);
  } catch {}
}
setInterval(updateRPMFromOHLC, 800);

/* ========================= HTTP Endpoints ========================= */
function gaugeHandler(key, max){
  return [authMiddleware, (_req, res)=>{
    let value = state[key]; if(!Number.isFinite(value)) value = 0;
    value = clamp(value, 0, max, 0);
    res.json({ value, ts: Date.now() });
  }];
}
app.get("/gauges/rpm",   ...gaugeHandler("rpm",   9000));
app.get("/gauges/speed", ...gaugeHandler("speed",  220));
app.get("/gauges/water", ...gaugeHandler("water",  100));
app.get("/gauges/oil",   ...gaugeHandler("oil",    100));
app.get("/gauges/fuel",  ...gaugeHandler("fuel",   100));

app.get("/gauges", authMiddleware, (_req, res) => {
  res.json({ rpm:state.rpm, speed:state.speed, water:state.water, oil:state.oil, fuel:state.fuel, ts:Date.now() });
});

app.get("/signals", authMiddleware, (_req, res) => res.json({ ...state.lights, ts: Date.now() }));

// === Debug endpoint to see what CSV returns and what we parsed ===
app.get("/debug/exports", async (_req, res) => {
  const url = MOMENTUM_SHEET_CSV_URL || BREADTH_SHEET_CSV_URL || HEALTH_SHEET_CSV_URL || "";
  const text = await fetchTextFollow(url);
  const parsed = parseCSV(text || "");
  res.json({
    ok: !!text,
    urlUsed: url,
    preview: (text || "").slice(0, 300),
    headers: parsed.headers,
    firstRows: parsed.rows.slice(0, 5),
    metrics: {
      SPEED:  getMetricValue(text, "SPEED"),
      FUEL:   getMetricValue(text, "FUEL"),
      HEALTH: getMetricValue(text, "HEALTH")
    },
    state: { speed: state.speed, fuel: state.fuel, water: state.water }
  });
});

app.use((req,res)=>res.status(404).json({ ok:false, error:"Not Found", path:req.path }));

/* ========================= WebSocket ========================= */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function wsAuthOk(req){
  if(!REQUIRE_TOKEN) return true;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const qToken = url.searchParams.get("token");
  const hdr = req.headers["sec-websocket-protocol"] || "";
  const token = qToken || hdr;
  return token && token === AUTH_TOKEN;
}
function wsGaugeFeed(ws, key, max, ms){
  const send = ()=>{ let v = state[key]; if(!Number.isFinite(v)) v=0; v=clamp(v,0,max,0);
    try { ws.readyState===1 && ws.send(JSON.stringify({ value:v, ts: Date.now() })); } catch {}
  };
  const timer = setInterval(send, ms); send(); ws.on("close",()=>clearInterval(timer));
}
function wsSignals(ws, ms){
  const send = ()=>{ try { ws.readyState===1 && ws.send(JSON.stringify({ ...state.lights, ts: Date.now() })); } catch {} };
  const timer=setInterval(send, ms); send(); ws.on("close",()=>clearInterval(timer));
}
server.on("upgrade", (req, socket, head)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  if(!wsAuthOk(req)){ socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws)=>{
    switch(url.pathname){
      case "/gauges/rpm":   wsGaugeFeed(ws,"rpm",   9000, 400); break;
      case "/gauges/speed": wsGaugeFeed(ws,"speed",  220, 600); break;
      case "/gauges/water": wsGaugeFeed(ws,"water",  100,1200); break;
      case "/gauges/oil":   wsGaugeFeed(ws,"oil",    100,1200); break;
      case "/gauges/fuel":  wsGaugeFeed(ws,"fuel",   100,1200); break;
      case "/signals":      wsSignals(ws,1500); break;
      default: ws.close(1008,"Unknown path");
    }
  });
});

/* ========================= Start ========================= */
server.listen(PORT, () => {
  console.log(`TOS backend listening on :${PORT}`);
  console.log(`CORS allow: ${ALLOW.join(", ") || "(none)"}`);
  console.log(`Auth required: ${REQUIRE_TOKEN ? "YES" : "NO"}`);
  console.log(`Sheets: momentum=${!!MOMENTUM_SHEET_CSV_URL}, breadth=${!!BREADTH_SHEET_CSV_URL}, health=${!!HEALTH_SHEET_CSV_URL}, ohlc=${!!OHLC_CSV_URL}`);
});
const express = require("express");
const fs = require("fs");
const app = express();

app.get("/api/dashboard", (req, res) => {
  const data = fs.readFileSync("./data/outlook.json");
  res.json(JSON.parse(data));
});

// existing code …

