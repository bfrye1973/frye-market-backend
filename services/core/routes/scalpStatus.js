// services/core/routes/scalpStatus.js
// Backend-1 proxy → Backend-2 streamer scalp status
// GET /api/v1/scalp-status
//
// Purpose:
// - Frontend should NOT call backend-2 directly
// - Avoid CORS headaches
// - Keep UI on one base URL
//
// Returns the JSON from backend-2 /stream/scalp-status with minimal wrapping.

import express from "express";

export const scalpStatusRouter = express.Router();

const BACKEND2_BASE =
  process.env.BACKEND2_BASE ||
  process.env.STREAM_BASE ||
  "https://frye-market-backend-2.onrender.com";

function normalizeBase(x) {
  const raw = String(x || "").trim();
  if (!raw) return "https://frye-market-backend-2.onrender.com";
  return raw.replace(/\/+$/, "");
}

function withTimeout(ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(t) };
}

scalpStatusRouter.get("/scalp-status", async (_req, res) => {
  const base = normalizeBase(BACKEND2_BASE);
  const url = `${base}/stream/scalp-status`;

  const { controller, clear } = withTimeout(8000);

  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", "Cache-Control": "no-store" },
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await r.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!r.ok) {
      return res.status(502).json({
        ok: false,
        error: "upstream_error",
        upstream: "backend-2",
        status: r.status,
        detail:
          (json && (json.error || json.detail)) ||
          text.slice(0, 200) ||
          `GET ${url} -> ${r.status}`,
      });
    }

    // Return upstream payload as-is (single source-of-truth)
    res.setHeader("Cache-Control", "no-store");
    return res.json(json ?? { ok: false, error: "empty_upstream_payload" });
  } catch (e) {
    const isAbort = String(e?.name || "").toLowerCase().includes("abort");
    return res.status(502).json({
      ok: false,
      error: isAbort ? "upstream_timeout" : "upstream_fetch_failed",
      upstream: "backend-2",
      detail: String(e?.message || e),
    });
  } finally {
    clear();
  }
});
