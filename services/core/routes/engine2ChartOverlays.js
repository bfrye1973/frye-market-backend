// Read-only Engine 2B v1 route. Uses the existing published ES strategy snapshot.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildEngine2ChartOverlayV1 } from "../logic/engine2/buildEngine2ChartOverlayV1.js";
const router = Router();
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/strategy-snapshot-es.json");
router.get("/engine2/chart-overlays/v1", (req, res) => {
  const symbol = String(req.query.symbol || "ES").trim().toUpperCase();
  if (symbol !== "ES") return res.status(400).json({ ok: false, error: "UNSUPPORTED_SYMBOL", symbol });
  try {
    if (!fs.existsSync(file)) return res.status(503).json({ ok: false, error: "SNAPSHOT_UNAVAILABLE" });
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
    if (snapshot?.symbol && String(snapshot.symbol).toUpperCase() !== "ES")
      return res.status(503).json({ ok: false, error: "SNAPSHOT_SYMBOL_MISMATCH" });
    const payload = buildEngine2ChartOverlayV1(snapshot, symbol);
    const body = JSON.stringify(payload);
    const etag = '"' + createHash("sha256").update(body).digest("hex") + '"';
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    return res.type("json").send(body);
  } catch (error) {
    return res.status(503).json({ ok: false, error: "CHART_OVERLAY_SOURCE_ERROR", message: String(error?.message || error) });
  }
});
export default router;
