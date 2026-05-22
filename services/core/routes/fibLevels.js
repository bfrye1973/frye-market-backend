// services/core/routes/fibLevels.js
// GET /api/v1/fib-levels?symbol=SPY&tf=1h&degree=minor&wave=W1|W4
// Reads data/fib-levels.json first.
// For ES, falls back to strategy-snapshot-es.json Engine 22 waveFibState.

import fs from "fs";
import path from "path";
import { Router } from "express";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.resolve(__dirname, "../data/fib-levels.json");
const ES_SNAPSHOT_FILE = path.resolve(__dirname, "../data/strategy-snapshot-es.json");
const SPY_SNAPSHOT_FILE = path.resolve(__dirname, "../data/strategy-snapshot.json");

export const fibLevelsRouter = Router();

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function buildSnapshotFallback({ symbol, tf, degree, wave }) {
  const snapshotFile = symbol === "ES" ? ES_SNAPSHOT_FILE : SPY_SNAPSHOT_FILE;
  const snapshot = readJsonSafe(snapshotFile);
  if (!snapshot) return null;

  const strategy = snapshot?.strategies?.["intraday_scalp@10m"] || null;
  const waveState = strategy?.engine22WaveStrategy?.waveFibState || null;
  const degreeBlock = waveState?.degrees?.[degree] || null;
  const engine2Degree = snapshot?.engine2State?.[degree] || null;

  if (!degreeBlock && !engine2Degree) return null;

  const fibProjection = degreeBlock?.fibProjection || null;
  const projectionAnchors = fibProjection?.anchors || {};
  const levels = fibProjection?.levels || null;

  const waveMarks =
    engine2Degree?.waveMarks ||
    degreeBlock?.waveMarks ||
    null;

  const w1 = toNum(waveMarks?.W1?.p);
  const w2 = toNum(waveMarks?.W2?.p);
  const w3 = toNum(waveMarks?.W3?.p);
  const w4 = toNum(waveMarks?.W4?.p);

  const anchorW3 = toNum(projectionAnchors?.w3) ?? w3;
  const anchorW4 = toNum(projectionAnchors?.w4) ?? w4;

  const meta = {
    schema: "fib-levels@3",
    source: "ENGINE22_WAVE_FIB_STATE_FALLBACK",
    symbol,
    tf,
    degree,
    requestedWave: wave,
    generated_at_utc: new Date().toISOString(),
  };

  if (wave === "W4") {
    if (anchorW3 === null || anchorW4 === null || !levels) return null;

    return {
      ok: true,
      symbol,
      tf,
      degree,
      wave: "W5",
      anchorWave: "W4",
      source: "W4_TO_W5_ACTIVE_EXECUTION",
      meta,
      anchors: {
        low: anchorW4,
        high: anchorW3,
        w3: anchorW3,
        w4: anchorW4,
        waveMarks,
      },
      fibProjection,
      levels,
      fib: {
        e100: levels.e100 ?? null,
        e1168: levels.e1168 ?? null,
        e1272: levels.e1272 ?? null,
        e1618: levels.e1618 ?? null,
        e200: levels.e200 ?? null,
        e2618: levels.e2618 ?? null,
      },
      targetZone: {
        level: 1.618,
        price: levels.e1618 ?? null,
      },
    };
  }

  if (wave === "W1") {
    const low = w2 ?? w1 ?? null;
    const high = w3 ?? w1 ?? null;

    return {
      ok: true,
      symbol,
      tf,
      degree,
      wave: "W1",
      source: "ENGINE22_WAVE_MARKS_FALLBACK",
      meta,
      anchors: {
        low,
        high,
        waveMarks,
      },
      fib: null,
    };
  }

  return null;
}

fibLevelsRouter.get("/fib-levels", (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h").toLowerCase();
    const degree = req.query.degree ? String(req.query.degree).toLowerCase() : null;
    const wave = req.query.wave ? String(req.query.wave).toUpperCase() : "W1";

    const raw = readJsonSafe(DATA_FILE);
    const items = Array.isArray(raw?.items) ? raw.items : [];

    const match = (it) => {
      const ms = String(it?.meta?.symbol || it?.symbol || "").toUpperCase();
      const mt = String(it?.meta?.tf || it?.tf || "").toLowerCase();
      const md = String(it?.meta?.degree || it?.degree || "").toLowerCase();
      const mw = String(it?.meta?.wave || it?.wave || "W1").toUpperCase();

      if (ms !== symbol) return false;
      if (mt !== tf) return false;
      if (mw !== wave) return false;
      if (degree && md !== degree) return false;

      return true;
    };

    const chosen = items.find(match) || null;

    if (chosen) {
      return res.json(chosen);
    }

    const fallback = degree
      ? buildSnapshotFallback({ symbol, tf, degree, wave })
      : null;

    if (fallback) {
      return res.json(fallback);
    }

    return res.json({
      ok: false,
      reason: "NO_ANCHORS",
      message: "No fib output found for requested symbol/tf/degree/wave. Check anchors + rerun job.",
      meta: {
        schema: "fib-levels@3",
        symbol,
        tf,
        degree,
        wave,
        generated_at_utc: new Date().toISOString(),
      },
    });
  } catch (err) {
    return res.json({
      ok: false,
      reason: "ROUTE_ERROR",
      message: String(err?.message || err),
      meta: {
        schema: "fib-levels@3",
        generated_at_utc: new Date().toISOString(),
      },
    });
  }
});
