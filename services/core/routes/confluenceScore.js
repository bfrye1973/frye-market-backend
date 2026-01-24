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

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

confluenceScoreRouter.get("/confluence-score", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h");
    const degree = String(req.query.degree || "minor");
    const wave = String(req.query.wave || "W1");

    const base = baseUrlFromReq(req);

    // ----------------------------
    // Engine 2 first (price source)
    // ----------------------------
    const fibUrl =
      `${base}/api/v1/fib-levels` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      `&degree=${encodeURIComponent(degree)}` +
      `&wave=${encodeURIComponent(wave)}`;

    const fib = await jget(fibUrl);

    // IMPORTANT: price MUST be set for zone selection
    const price = fib?.diagnostics?.price ?? null;

    // --------------------------------------------
    // Engine 1 context (MUST pass tf — FIX #1)
    // --------------------------------------------
    const e1Url =
      `${base}/api/v1/engine5-context` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}`;

    const engine1Context = await jget(e1Url);

    const institutionals = engine1Context?.render?.institutional || [];
    const shelves = engine1Context?.render?.shelves || [];

    // Pick the active zone ONLY if price is inside it (NO guessing)
    const inInst = institutionals.find(
      (z) => price != null && num(z.lo) != null && num(z.hi) != null && price >= num(z.lo) && price <= num(z.hi)
    );
    const inShelf = shelves.find(
      (z) => price != null && num(z.lo) != null && num(z.hi) != null && price >= num(z.lo) && price <= num(z.hi)
    );

    const zoneUsed = inShelf || inInst || null;
    const zoneLo = zoneUsed ? num(zoneUsed.lo) : null;
    const zoneHi = zoneUsed ? num(zoneUsed.hi) : null;
    const zoneId = zoneUsed?.id ?? null;

    // --------------------------------------------
    // Engine 3 (reaction) — pass zoneId if we have it (FIX #3)
    // --------------------------------------------
    const e3Url =
      `${base}/api/v1/reaction-score` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      (zoneId ? `&zoneId=${encodeURIComponent(zoneId)}` : "");

    const reaction = await jget(e3Url);

    // --------------------------------------------
    // Engine 4 (volume) — must call INTERNAL localhost (FIX #2)
    // --------------------------------------------
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
      };
    }

    // ----------------------------
    // Compute Engine 5 output
    // ----------------------------
    const out = computeConfluenceScore({
      symbol,
      tf,
      degree,
      wave,
      price,
      engine1Context,
      fibW1: fib,
      reaction,
      volume,
    });

    res.json(out);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
});
