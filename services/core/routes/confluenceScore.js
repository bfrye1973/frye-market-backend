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

/**
 * ✅ Deterministic CORS for this route
 *
 * Fix goal:
 * - Ensure GET (success AND error) includes ACAO
 * - Avoid browsers reporting backend 500 as "CORS blocked"
 *
 * Strategy:
 * - Echo request Origin when present
 * - If no Origin (curl/direct), default to the dashboard origin (NOT wildcard)
 */
function applyCors(req, res) {
  const origin = req.headers.origin;

  // Prefer echoing browser origin. If missing, default to dashboard origin.
  const allowOrigin = origin || "https://frye-dashboard.onrender.com";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-Idempotency-Key"
  );

  // IMPORTANT:
  // Do NOT set Allow-Credentials unless the frontend uses credentials: "include".
  // res.setHeader("Access-Control-Allow-Credentials", "true");
}

// Explicit OPTIONS handler
confluenceScoreRouter.options("/confluence-score", (req, res) => {
  applyCors(req, res);
  return res.sendStatus(204);
});

confluenceScoreRouter.get("/confluence-score", async (req, res) => {
  applyCors(req, res);

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

    // Authoritative price comes from Engine 1 context
    const price = engine1Context?.meta?.current_price ?? null;

    // ----------------------------
    // Engine 2 fib (signals only; NOT price source)
    // ----------------------------
    const fibUrl =
      `${base}/api/v1/fib-levels` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      `&degree=${encodeURIComponent(degree)}` +
      `&wave=${encodeURIComponent(wave)}`;

    const fib = await jget(fibUrl);

    // ----------------------------
    // Active zone (NO guessing)
    // Priority: negotiated -> shelf -> institutional
    // ----------------------------
    const activeNegotiated = engine1Context?.active?.negotiated ?? null;
    const activeShelf = engine1Context?.active?.shelf ?? null;
    const activeInstitutional = engine1Context?.active?.institutional ?? null;

    const activeZone =
      activeNegotiated || activeShelf || activeInstitutional || null;

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
    // Engine 4 (volume) — DO NOT hard-fail on Render
    //
    // On Render, http://localhost:10000 will NOT resolve unless Engine 4
    // is running in the same container. So:
    // 1) Prefer ENGINE4_BASE_URL if provided
    // 2) Otherwise fallback to localhost (local dev)
    // 3) If it fails, DEGRADE gracefully (do not throw)
    // ----------------------------
    let volume = null;

    if (zoneLo != null && zoneHi != null) {
      const e4Base =
        process.env.ENGINE4_BASE_URL?.trim() || "http://localhost:10000";

      const e4Url =
        `${e4Base}/api/v1/volume-behavior` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&tf=${encodeURIComponent(tf)}` +
        `&zoneLo=${encodeURIComponent(zoneLo)}` +
        `&zoneHi=${encodeURIComponent(zoneHi)}`;

      try {
        volume = await jget(e4Url);
      } catch (e) {
        // ✅ degrade instead of killing confluence-score
        volume = {
          ok: true,
          volumeScore: 0,
          volumeConfirmed: false,
          reasonCodes: ["ENGINE4_UNAVAILABLE"],
          flags: {},
          diagnostics: {
            note: "Engine 4 unreachable — degraded volume scoring",
            engine4Base: e4Base,
            error: String(e?.message || e),
          },
        };
      }
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

    return res.json(out);
  } catch (err) {
    applyCors(req, res);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
});
