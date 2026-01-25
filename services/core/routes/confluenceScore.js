// src/services/core/routes/confluenceScore.js
import express from "express";
import { computeConfluenceScore } from "../logic/confluenceScorer.js";

export const confluenceScoreRouter = express.Router();

function baseUrlFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

async function jget(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`GET ${url} -> ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json();
}

// ✅ CORS helper for this route (belt + suspenders)
// This guarantees GET responses always include ACAO, fixing "OPTIONS 204 ok, GET blocked" cases.
function applyCorsForDashboard(req, res) {
  const origin = req.headers.origin;
  const allow = new Set([
    "https://frye-dashboard.onrender.com",
    "http://localhost:3000",
  ]);

  // Always set a deterministic origin header
  const allowOrigin = origin && allow.has(origin)
    ? origin
    : "https://frye-dashboard.onrender.com";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-Idempotency-Key"
  );
}

// ✅ (Optional) Explicit OPTIONS handler for this route
// Not strictly required if global middleware handles OPTIONS, but harmless and removes ambiguity.
confluenceScoreRouter.options("/confluence-score", (req, res) => {
  applyCorsForDashboard(req, res);
  return res.sendStatus(204);
});

confluenceScoreRouter.get("/confluence-score", async (req, res) => {
  // ✅ Ensure CORS headers are present on the ACTUAL GET response
  applyCorsForDashboard(req, res);

  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h");
    const degree = String(req.query.degree || "minor");
    const wave = String(req.query.wave || "W1");

    const base = baseUrlFromReq(req);

    // ----------------------------
    // Engine 1 context FIRST (authoritative for price + active zones)
    // ----------------------------
    const ctxUrl =
      `${base}/api/v1/engine5-context` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}`;

    const engine1Context = await jget(ctxUrl);

    // Authoritative price comes from Engine 1 context now
    const price = engine1Context?.meta?.current_price ?? null;

    // ----------------------------
    // Engine 2 fib (signals only; do NOT use as price source anymore)
    // ----------------------------
    const fibUrl =
      `${base}/api/v1/fib-levels` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      `&degree=${encodeURIComponent(degree)}` +
      `&wave=${encodeURIComponent(wave)}`;

    const fib = await jget(fibUrl);

    // ----------------------------
    // Determine active zone from Engine 1 explicit fields (NO guessing)
    // Priority: active.negotiated -> active.shelf -> active.institutional
    // ----------------------------
    const activeNegotiated = engine1Context?.active?.negotiated ?? null;
    const activeShelf = engine1Context?.active?.shelf ?? null;
    const activeInstitutional = engine1Context?.active?.institutional ?? null;

    const activeZone = activeNegotiated || activeShelf || activeInstitutional || null;

    const zoneId = activeZone?.id ?? null;
    const zoneLo = activeZone?.lo ?? null;
    const zoneHi = activeZone?.hi ?? null;

    // ----------------------------
    // Engine 3 (reaction) — pass zoneId if present
    // ----------------------------
    const e3Url =
      `${base}/api/v1/reaction-score` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      (zoneId ? `&zoneId=${encodeURIComponent(zoneId)}` : "");

    const reaction = await jget(e3Url);

    // ----------------------------
    // Engine 4 (volume) — INTERNAL localhost only
    // Runs against the ACTIVE zone range
    // ----------------------------
    let volume = null;

    if (zoneLo != null && zoneHi != null) {
      const e4Url =
        `http://localhost:10000/api/v1/volume-behavior` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&tf=${encodeURIComponent(tf)}` +
        `&zoneLo=${encodeURIComponent(zoneLo)}` +
        `&zoneHi=${encodeURIComponent(zoneHi)}`;

      volume = await jget(e4Url);
    } else {
      volume = {
        ok: true,
        volumeScore: 0,
        volumeConfirmed: false,
        reasonCodes: ["NOT_IN_ZONE"],
        flags: {},
        diagnostics: { note: "NO_ACTIVE_ZONE" },
      };
    }

    // ----------------------------
    // Engine 5 compute
    // ----------------------------
    const out = computeConfluenceScore({
      symbol,
      tf,
      degree,
      wave,
      price,
      engine1Context,
      fib,
      reaction,
      volume,
    });

    res.json(out);
  } catch (err) {
    // ✅ include CORS on error responses too (already applied above)
    res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
});
