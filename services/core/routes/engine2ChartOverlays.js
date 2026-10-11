// Read-only Engine 2B v1 route. Published ES snapshot is parsed only when its file identity changes.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildEngine2ChartOverlayV1, validateEngine2ChartOverlayV1 } from "../logic/engine2/buildEngine2ChartOverlayV1.js";

const router = Router();
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/strategy-snapshot-es.json");
let publishedCache = null;

function readPublishedOverlay() {
  const stat = fs.statSync(file);
  const version = [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(":");
  if (publishedCache?.version === version) return { ...publishedCache, cacheHit: true };

  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  if (snapshot?.symbol && String(snapshot.symbol).toUpperCase() !== "ES") {
    const error = new Error("SNAPSHOT_SYMBOL_MISMATCH");
    error.code = "SNAPSHOT_SYMBOL_MISMATCH";
    throw error;
  }
  const payload = buildEngine2ChartOverlayV1(snapshot, "ES");
  const validation = validateEngine2ChartOverlayV1(payload);
  if (!validation.ok) {
    const error = new Error("OVERLAY_CONTRACT_INVALID");
    error.code = "OVERLAY_CONTRACT_INVALID";
    error.reasonCodes = validation.errors;
    throw error;
  }
  const body = JSON.stringify(payload);
  const etag = '"' + createHash("sha256").update(body).digest("hex") + '"';
  const next = { version, body, etag };
  publishedCache = next;
  return { ...next, cacheHit: false };
}

router.get("/engine2/chart-overlays/v1", (req, res) => {
  const symbol = String(req.query.symbol || "ES").trim().toUpperCase();
  if (symbol !== "ES") return res.status(400).json({ ok: false, error: "UNSUPPORTED_SYMBOL", symbol });
  try {
    if (!fs.existsSync(file)) return res.status(503).json({ ok: false, error: "SNAPSHOT_UNAVAILABLE" });
    const published = readPublishedOverlay();
    res.setHeader("ETag", published.etag);
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.setHeader("X-Engine2B-Cache", published.cacheHit ? "HIT" : "MISS");
    if (req.headers["if-none-match"] === published.etag) return res.status(304).end();
    return res.type("json").send(published.body);
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error.code || "CHART_OVERLAY_SOURCE_ERROR",
      reasonCodes: error.reasonCodes || [],
      message: String(error?.message || error),
    });
  }
});
export default router;
