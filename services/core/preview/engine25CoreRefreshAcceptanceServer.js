// Isolated Engine 25 runtime acceptance server. Never mounted by production.
// Runs the existing Core refresh via HTTP against this same serving process.
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import engine25RefreshRouter from "../routes/engine25Refresh.js";
import engine25FullDashboardRouter from "../routes/engine25FullDashboard.js";

if (process.env.ENGINE25_ISOLATED_ACCEPTANCE !== "1") {
  throw new Error("ISOLATED_ACCEPTANCE_FLAG_REQUIRED");
}
if (!process.env.ENGINE_CRON_TOKEN) {
  throw new Error("ENGINE_CRON_TOKEN_REQUIRED");
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const compositeFile = path.join(dataDir, "engine25-composite-overlay-6mo.json");
const app = express();
app.disable("x-powered-by");
app.use("/api/v1", engine25RefreshRouter);
app.use("/api/v1", engine25FullDashboardRouter);
let acceptance = { state: "PENDING", generatedAtUtc: new Date().toISOString() };
function snapshot() {
  if (!fs.existsSync(compositeFile)) return null;
  const b = fs.readFileSync(compositeFile);
  const j = JSON.parse(b.toString("utf8"));
  const last = j?.rows?.at(-1) || null;
  return {
    bytes: b.length,
    sha256: crypto.createHash("sha256").update(b).digest("hex"),
    modifiedAt: fs.statSync(compositeFile).mtime.toISOString(),
    date: last?.date ?? null,
    score: last?.engine25CompositeScore ?? null,
    rows: j?.rows?.length ?? 0
  };
}
app.get("/acceptance", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(acceptance);
});
app.get("/health", (_req, res) => res.json({ok: true, engine: "engine25-isolated-acceptance"}));
const port = Number(process.env.PORT || 10000);
const server = app.listen(port, "0.0.0.0", () => {
  console.log("[engine25-acceptance] preview listening on", port);
  void runAcceptance();
});
async function runAcceptance() {
  try {
    const base = "http://127.0.0.1:" + port;
    const before = snapshot();
    const req = await fetch(base + "/api/v1/engine25/refresh?mode=core", {
      method: "POST",
      headers: { "X-ENGINE-CRON-TOKEN": process.env.ENGINE_CRON_TOKEN },
      signal: AbortSignal.timeout(240000),
    });
    const job = await req.json();
    const after = snapshot();
    const response = await fetch(base + "/api/v1/engine25/full-dashboard", {
      headers: {"Cache-Control": "no-cache"},
      signal: AbortSignal.timeout(15000),
    });
    const served = await response.json();
    const matches = response.ok && served?.ok === true &&
      Number(served?.headline?.score) === Number(after?.score) &&
      served?.headline?.date === after?.date &&
      Number(served?.overlay?.rows?.at(-1)?.engine25CompositeScore) === Number(after?.score);
    const verified = Boolean(req.ok && job.ok && job.productionOutputVerified &&
      job.compositeAfter?.sha256 === after?.sha256 && after?.modifiedAt !== before?.modifiedAt &&
      matches);
    acceptance = {
      state: verified ? "PASS" : "FAIL",
      at: new Date().toISOString(),
      previewOnly: true,
      refreshHttp: req.status,
      refreshOk: job.ok ?? false,
      error: job.error || null,
      jobSteps: job.steps || [],
      productionOutputVerified: job.productionOutputVerified ?? false,
      before,
      generated: job.compositeAfter || null,
      after,
      dashboardHttp: response.status,
      served: {
        score: served?.headline?.score ?? null,
        date: served?.headline?.date ?? null,
        overlayScore: served?.overlay?.rows?.at(-1)?.engine25CompositeScore ?? null,
        overlayDate: served?.overlay?.rows?.at(-1)?.date ?? null,
        dateAlignment: served?.headline?.dateAlignment ?? null,
      },
      samePreviewInstanceMatches: matches,
    };
    console.log("[engine25-acceptance] RESULT", JSON.stringify(acceptance));
  } catch (err) {
    acceptance = {state:"ERROR", at:new Date().toISOString(), error:String(err)};
    console.error("[engine25-acceptance] ERROR", String(err));
  }
}
