// /server.js — backend only (no stream). Safe start, clear logging, correct healthz.
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import apiRouter from "./api/routes.js";
import { ohlcRouter } from "./routes/ohlc.js";
// IMPORTANT: no stream import/mount here
// import streamRouter from "./routes/stream.js";

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000"
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOW.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Authorization, X-Requested-With, X-Idempotency-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

/* --------------- static --------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

/* --------------- routes --------------- */
app.use("/api/v1/ohlc", ohlcRouter);
app.use("/api", apiRouter);
// DO NOT mount /stream on this service
// app.use("/stream", streamRouter);

/* ------------- GitHub proxies (JSON for tiles) ------------- */
const GH_RAW_BASE = "https://raw.githubusercontent.com/bfrye1973/frye-market-backend";
async function proxyRaw(res, url){
  try{
    const r = await fetch(url, { cache: "no-store" });
    if(!r.ok) return res.status(r.status).json({ ok:false, error:`Upstream ${r.status}`});
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Content-Type","application/json; charset=utf-8");
    const text = await r.text();
    return res.send(text);
  }catch(e){
    return res.status(502).json({ ok:false, error:"Bad Gateway" });
  }
}
app.get("/live/intraday", (_req,res)=> proxyRaw(res, `${GH_RAW_BASE}/data-live-10min/data/outlook_intraday.json`) );
app.get("/live/hourly",   (_req,res)=> proxyRaw(res, `${GH_RAW_BASE}/data-live-hourly/data/outlook_hourly.json`) );
app.get("/live/eod",      (_req,res)=> proxyRaw(res, `${GH_RAW_BASE}/data-live-eod/data/outlook.json`) );

/* ---------------- health ---------------- */
app.get("/healthz", (_req,res)=> res.json({ ok:true, service:"backend", ts:new Date().toISOString() }) );

/* -------------- 404 / error -------------- */
app.use((req,res)=> res.status(404).json({ ok:false, error:"Not Found" }));
app.use((err,req,res,_next)=>{
  console.error("Unhandled error:", err?.stack || err);
  res.status(500).json({ ok:false, error:"Internal Server Error" });
});

/* ---------------- start ---------------- */
const PORT = Number(process.env.PORT) || 10000;
const HOST = "0.0.0.0";
process.on("unhandledRejection", e => console.error("unhandledRejection:", e?.stack || e));
process.on("uncaughtException", e => { console.error("uncaughtException:", e?.stack || e); process.exit(1); });

app.listen(PORT, HOST, () => {
  console.log(`[OK] backend listening on :${PORT}`);
  console.log("- /api/v1/ohlc");
  console.log("- /live/intraday | /live/hourly | /live/eod");
  console.log("- /healthz");
});
