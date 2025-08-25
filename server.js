// server.js — Ferrari Cluster Live Feed (HTTP + WS, Sheets + OHLC)
// Node 18+, npm i express cors morgan ws

/* ========================= Imports & Setup ========================= */
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const http = require("http");
const { WebSocketServer } = require("ws");
const https = require("https");

/* ========================= Config ========================= */
const PORT = process.env.PORT || 8080;
const ALLOW = String(process.env.CORS_ORIGIN || "https://frye-dashboard.onrender.com")
  .split(",").map(s => s.trim()).filter(Boolean);

const REQUIRE_TOKEN = String(process.env.REQUIRE_TOKEN || "0") === "1";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

// Sheet CSVs
const MOMENTUM_SHEET_CSV_URL = process.env.MOMENTUM_SHEET_CSV_URL || ""; // → /gauges/speed (0..220)
const BREADTH_SHEET_CSV_URL  = process.env.BREADTH_SHEET_CSV_URL  || ""; // → /gauges/fuel  (0..100)
const HEALTH_SHEET_CSV_URL   = process.env.HEALTH_SHEET_CSV_URL   || ""; // → /gauges/water (0..100)
const OHLC_CSV_URL           = process.env.OHLC_CSV_URL           || ""; // optional → /gauges/rpm (0..9000)

/* ========================= App ========================= */
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan("tiny"));
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOW.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked"));
  },
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
  res.json({ ok: true, service: "tos-backend", time: new Date().toISOString() })
);

/* ========================= State ========================= */
const state = {
  rpm: 5200, // 0..9000 (optional OHLC squeeze)
  speed: 0,  // 0..220  (Momentum sheet)
  water: 0,  // 0..100  (Market Health sheet)
  oil: 55,   // 0..100  (placeholder / future)
  fuel: 0,   // 0..100  (Breadth sheet)
  lights: {
    breakout:false, buy:false, sell:false, emaCross:false, stop:false, trail:false,
    pad1:false, pad2:false, pad3:false, pad4:false
  },
};

/* ========================= Helpers ========================= */
function clamp(n, lo, hi, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, x));
}

function fetchText(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    https.get(url, (res) => {
      let data = "";
      res.on("data", (d) => data += d);
      res.on("end", () => resolve(data));
    }).on("error", () => resolve(null));
  });
}

// Small CSV parser that returns { headers:[], rows:[{col:value,...}], rawLines:[] }
function parseCSV(text) {
  if (!text) return { headers: [], rows: [], rawLines: [] };
  const lines = text.replace(/\r/g, "").trim().split("\n");
  if (lines.length === 0) return { headers: [], rows: [], rawLines: [] };
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = [];
    let cur = "", inQ = false;
    const s = lines[i];
    for (let j=0; j<s.length; j++) {
      const ch = s[j];
      if (ch === '"') {
        if (inQ && s[j+1] === '"') { cur += '"'; j++; }
        else { inQ = !inQ; }
      } else if (ch === ',' && !inQ) {
        cols.push(cur); cur = "";
      } else { cur += ch; }
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? "").trim(); });
    rows.push(obj);
  }
  return { headers, rows, rawLines: lines };
}

// Utility: read first numeric from either a named column or second column
function firstNumberFromCSV(csvText, opts = {}) {
  const { field } = opts || {};
  const parsed = parseCSV(csvText);
  if (parsed.rows.length === 0) return null;
  const row = parsed.rows[0];
  if (field && row.hasOwnProperty(field)) {
    const n = Number(String(row[field]).replace(/[^0-9.\-]+/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  // fallback: second column of first row
  const headers = parsed.headers;
  if (headers.length >= 2) {
    const h = headers[1];
    const n = Number(String(row[h]).replace(/[^0-9.\-]+/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/* ========================= Sheets → Gauges ========================= */
// Poll sheets every 2s and update speed/fuel/water.
async function updateFromSheets() {
  try {
    // Momentum → Speed (0..220)
    if (MOMENTUM_SHEET_CSV_URL) {
      const t = await fetchText(MOMENTUM_SHEET_CSV_URL);
      const n = firstNumberFromCSV(t); // set MOMENTUM_FIELD env later if needed
      if (n != null) state.speed = clamp(n, 0, 220, state.speed);
    }

    // Breadth → Fuel (0..100)
    if (BREADTH_SHEET_CSV_URL) {
      const t = await fetchText(BREADTH_SHEET_CSV_URL);
      const n = firstNumberFromCSV(t);
      if (n != null) state.fuel = clamp(n, 0, 100, state.fuel);
    }

    // Market Health → Water (0..100)
    if (HEALTH_SHEET_CSV_URL) {
      const t = await fetchText(HEALTH_SHEET_CSV_URL);
      const n = firstNumberFromCSV(t);
      if (n != null) state.water = clamp(n, 0, 100, state.water);
    }
  } catch (e) {
    console.error("updateFromSheets error:", e?.message || e);
  }
}
setInterval(updateFromSheets, 2000);

/* ========================= Optional OHLC → RPM =========================
   If OHLC_CSV_URL exists, we compute a "squeeze" → map to 0..9000.
   Very lightweight BB/KC approximation:
   - Period N=20
   - BB width  = 2 * 2σ (std dev)
   - KC width  = 2 * EMA(ATR, 20) * k  (k ~ 1.5)
   - Pressure  = max(0, KC - BB) / (KC + 1e-6)
   - RPM       = round( pressure * 9000 )
*/
function ema(prev, value, alpha) { return prev == null ? value : prev + alpha * (value - prev); }
function rollingStd(values, period) {
  const n = values.length;
  if (n < period) return null;
  const slice = values.slice(n - period);
  const avg = slice.reduce((a,b)=>a+b,0) / period;
  const v = slice.reduce((a,b)=>a+(b-avg)*(b-avg),0) / period;
  return Math.sqrt(v);
}
function computeATR(ohlc, i, period) {
  // TR = max(H-L, |H-Cprev|, |L-Cprev|)
  let atr = null, alpha = 2 / (period + 1);
  for (let k = 0; k <= i; k++) {
    const cPrev = k > 0 ? ohlc[k-1].c : ohlc[k].c;
    const tr = Math.max(
      ohlc[k].h - ohlc[k].l,
      Math.abs(ohlc[k].h - cPrev),
      Math.abs(ohlc[k].l - cPrev)
    );
    atr = ema(atr, tr, alpha);
  }
  return atr;
}
function parseOHLC(csvText) {
  const { headers, rows } = parseCSV(csvText);
  // Attempt to autodetect columns: time, open, high, low, close
  const map = { t:null, o:null, h:null, l:null, c:null };
  const pick = (name) => headers.find(h => h.toLowerCase().includes(name));
  map.t = pick("time") || pick("date") || headers[0];
  map.o = pick("open") || "open";
  map.h = pick("high") || "high";
  map.l = pick("low")  || "low";
  map.c = pick("close")|| "close";
  const out = [];
  rows.forEach(r => {
    const o = Number(r[map.o]); const h = Number(r[map.h]);
    const l = Number(r[map.l]); const c = Number(r[map.c]);
    if ([o,h,l,c].every(Number.isFinite)) out.push({ o,h,l,c });
  });
  return out;
}
async function updateRPMFromOHLC() {
  if (!OHLC_CSV_URL) return; // not configured yet
  try {
    const text = await fetchText(OHLC_CSV_URL);
    if (!text) return;
    const ohlc = parseOHLC(text);
    const N = 20, kKC = 1.5;
    const closes = ohlc.map(x => x.c);
    if (closes.length < N + 1) return;

    const std = rollingStd(closes, N);
    if (std == null) return;

    // BB width ~ 4σ
    const bbWidth = 4 * std;

    // KC width ~ 2 * EMA(ATR, N) * kKC
    const atrN = computeATR(ohlc, ohlc.length - 1, N);
    const kcWidth = 2 * atrN * kKC;

    const pressure = Math.max(0, kcWidth - bbWidth) / (kcWidth + 1e-9); // 0..1
    const rpm = Math.round(clamp(pressure, 0, 1) * 9000);
    state.rpm = clamp(rpm, 0, 9000, state.rpm);
  } catch (e) {
    // Keep last RPM if fetch/parse fails
  }
}
setInterval(updateRPMFromOHLC, 600);

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
  res.json({
    rpm:state.rpm, speed:state.speed, water:state.water, oil:state.oil, fuel:state.fuel, ts:Date.now()
  });
});

app.get("/signals", authMiddleware, (_req, res) => res.json({ ...state.lights, ts: Date.now() }));

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
