// src/services/core/routes/confluenceScore.js
import express from "express";
import { computeConfluenceScore } from "../logic/confluenceScorer.js";

export const confluenceScoreRouter = express.Router();

/* ---------------------------- helpers ---------------------------- */

function baseUrlFromReq(req) {
  const xf = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(xf) ? xf[0] : xf) || req.protocol || "https";
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

function applyCors(req, res) {
  const origin = req.headers.origin;
  const isAllowed =
    origin === "https://frye-dashboard.onrender.com" ||
    origin === "http://localhost:3000";

  const allowOrigin = isAllowed ? origin : "https://frye-dashboard.onrender.com";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-Idempotency-Key"
  );
}

confluenceScoreRouter.options("/confluence-score", (req, res) => {
  applyCors(req, res);
  return res.sendStatus(204);
});

/* ---------------------------- Route ---------------------------- */

confluenceScoreRouter.get("/confluence-score", async (req, res) => {
  applyCors(req, res);

  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h");
    const degree = String(req.query.degree || "minor");
    const wave = String(req.query.wave || "W1");

    const base = baseUrlFromReq(req);

    /* ---------------- Engine 1 ---------------- */

    const engine1Context = await jget(
      `${base}/api/v1/engine5-context?symbol=${symbol}&tf=${tf}`
    );

    const price = Number(engine1Context?.meta?.current_price ?? NaN);

    /* ---------------- Engine 2 ---------------- */

    const fib = await jget(
      `${base}/api/v1/fib-levels?symbol=${symbol}&tf=${tf}&degree=${degree}&wave=${wave}`
    );

    /* ---------------- Engine 3 ---------------- */

    const reaction = await jget(
      `${base}/api/v1/reaction-score?symbol=${symbol}&tf=${tf}&strategyId=intraday_scalp@10m`
    );

    /* ---------------- Engine 4 ---------------- */

    let volume = {
      volumeScore: 0,
      volumeConfirmed: false,
      flags: {},
    };

    try {
      const vol = await jget(
        `${base}/api/v1/volume-behavior?symbol=${symbol}&tf=${tf}&mode=scalp`
      );
      volume = {
        volumeScore: vol?.volumeScore ?? 0,
        volumeConfirmed: vol?.volumeConfirmed ?? false,
        flags: vol?.flags ?? {},
      };
    } catch {}

    /* ---------------- Engine 5 ---------------- */

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

    /* ---------------- KEEP STRATEGY ALIVE ---------------- */

    if (out?.invalid && out?.reasonCodes?.includes("NO_ZONE_NO_TRADE")) {
      out.invalid = false;
      out.tradeReady = false;
      out.reasonCodes = ["NOT_IN_ZONE_WAITING_FOR_SETUP"];
    }

    /* ---------------- SAFE CONTEXT ATTACH ---------------- */

    out.context = {
      activeZone: out.context?.activeZone ?? null,

      fib: {
        meta: fib?.meta ?? null,
        anchors: fib?.anchors?.waveMarks ?? null,
        signals: fib?.signals ?? null,
      },

      reaction: {
        stage: reaction?.stage ?? "IDLE",
        armed: reaction?.armed ?? false,
        reactionScore: reaction?.reactionScore ?? 0,
      },

      volume: {
        volumeScore: volume?.volumeScore ?? 0,
        volumeConfirmed: volume?.volumeConfirmed ?? false,
        flags: volume?.flags ?? {},
      },
    };

    return res.json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
});
