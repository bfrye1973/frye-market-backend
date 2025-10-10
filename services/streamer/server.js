// services/streamer/server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import streamRouter from "./routes/stream.js";
import paperRouter  from "./routes/paper.js";   // ← NEW

const app = express();

/* ------------------------------ CORS ------------------------------ */
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000",
]);
app.use((req,res,next)=>{
  const origin = req.headers.origin;
  if (origin && ALLOW.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary","Origin");
  // include POST for paper routes
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method==="OPTIONS") return res.sendStatus(204);
  next();
});

/* ------------------------------ static ---------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.use(express.static(path.join(__dirname,"public")));

/* ------------------------------ routes ---------------------------- */
app.use("/stream", streamRouter);
app.use("/paper",  paperRouter);    // ← mount paper module

/* ------------------------------ health ---------------------------- */
app.get("/healthz", (_req,res)=> res.json({ ok:true, service:"streamer", ts:new Date().toISOString() }) );

/* ------------------------------ 404 -------------------------------- */
app.use((req,res)=> res.status(404).json({ ok:false, error:"Not Found" }));

/* ------------------------------ start ------------------------------ */
const PORT = Number(process.env.PORT) || 10000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`[OK] streamer listening on :${PORT}`);
  console.log("- /stream/agg");
  console.log("- /paper/execute | /paper/status | /paper/positions | /paper/orders | /paper/mark");
  console.log("- /healthz");
});
