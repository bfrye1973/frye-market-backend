// src/services/core/routes/confluenceScore.js
import express from "express";
import { computeConfluenceScore } from "../logic/confluenceScorer.js";

export const confluenceScoreRouter = express.Router();

function baseUrlFromReq(req) {
  // Works on Render behind proxy if trust proxy is enabled; fallback to https.
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

async function jget(url) {
  const r = await fetch(url, { headers: { "accept": "application/json" } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`GET ${url} -> ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json();
}

confluenceScoreRouter.get("/confluence-score", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h");
    const degree = String(req.query.degree || "minor");
    const wave = String(req.query.wave || "W1");

    const base = baseUrlFromReq(req);

    // Engine 2 first (we need price even for location gate)
    const fibUrl = `${base}/api/v1/fib-levels?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&degree=${encodeURIComponent(degree)}&wave=${encodeURIComponent(wave)}`;
    const fib = await jget(fibUrl);
    const price = fib?.diagnostics?.price ?? null;

    // Engine 1 context (institutional + shelves)
    const e1Url = `${base}/api/v1/engine5-context?symbol=${encodeURIComponent(symbol)}`;
    const engine1Context = await jget(e1Url);

    // Determine which zone we’re inside so we can query Engine 4 + (optionally) Engine 3
    // We let computeConfluenceScore pick best in-zone institutional/shelf, but we need zone bounds for volume endpoint.
    // So do a quick pick here by reusing the same endpoint response shape:
    const institutionals = engine1Context?.render?.institutional || [];
    const shelves = engine1Context?.render?.shelves || [];

    const inInst = institutionals.find(z => price != null && price >= Number(z.lo) && price <= Number(z.hi));
    const inShelf = shelves.find(z => price != null && price >= Number(z.lo) && price <= Number(z.hi));

    const zoneUsed = inShelf || inInst || null;
    const zoneLo = zoneUsed ? Number(zoneUsed.lo) : null;
    const zoneHi = zoneUsed ? Number(zoneUsed.hi) : null;

    // Engine 3 (reaction) — your endpoint already enforces NOT_IN_ZONE
    const e3Url = `${base}/api/v1/reaction-score?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`;
    const reaction = await jget(e3Url);

    // Engine 4 (volume) — only meaningful if we have a zone range
    let volume = null;
    if (zoneLo != null && zoneHi != null && Number.isFinite(zoneLo) && Number.isFinite(zoneHi)) {
      const e4Url = `${base}/api/v1/volume-behavior?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&zoneLo=${encodeURIComponent(zoneLo)}&zoneHi=${encodeURIComponent(zoneHi)}`;
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
