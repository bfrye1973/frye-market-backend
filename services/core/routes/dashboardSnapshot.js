// services/core/routes/dashboardSnapshot.js
// Lightweight dashboard snapshot route
// Reads prebuilt snapshot file instead of recomputing engines
//
// Symbol-aware:
// SPY/default -> data/strategy-snapshot.json
// ES          -> data/strategy-snapshot-es.json

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOT_FILES = {
  SPY: path.resolve(__dirname, "../data/strategy-snapshot.json"),
  ES: path.resolve(__dirname, "../data/strategy-snapshot-es.json"),
};

const NEWS_RISK_FILE = path.resolve(
  __dirname,
  "../data/news-risk.json"
);

function normalizeSymbol(v) {
  const s = String(v || "SPY").trim().toUpperCase();
  return s || "SPY";
}

function getSnapshotFile(symbol) {
  const clean = normalizeSymbol(symbol);

  if (clean === "ES") {
    return SNAPSHOT_FILES.ES;
  }

  return SNAPSHOT_FILES.SPY;
}

/* -----------------------------
   Read snapshot safely
------------------------------*/
function readSnapshot(symbol = "SPY") {
  const file = getSnapshotFile(symbol);
  const cleanSymbol = normalizeSymbol(symbol);

  try {
    if (!fs.existsSync(file)) {
      return {
        ok: false,
        error: "SNAPSHOT_NOT_READY",
        symbol: cleanSymbol,
        file: path.basename(file),
      };
    }

    const raw = fs.readFileSync(file, "utf8");

    try {
      const json = JSON.parse(raw);

      // Keep the response symbol aligned with the requested file.
      // If file already has symbol, preserve it unless missing.
      if (!json.symbol) {
        json.symbol = cleanSymbol;
      }

      return json;
    } catch {
      return {
        ok: false,
        error: "SNAPSHOT_INVALID_JSON",
        symbol: cleanSymbol,
        file: path.basename(file),
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: "SNAPSHOT_READ_FAILED",
      symbol: cleanSymbol,
      file: path.basename(file),
      message: String(err?.message || err),
    };
  }
}

/* -----------------------------
   Read Engine 24 news risk safely
------------------------------*/
function readNewsRiskSnapshot() {
  try {
    if (!fs.existsSync(NEWS_RISK_FILE)) {
      return {
        ok: false,
        active: false,
        stale: true,
        riskLevel: "UNKNOWN",
        category: "UNKNOWN",
        headline: null,
        source: null,
        publishedAt: null,
        ageMinutes: null,
        maxAgeMinutes: null,
        engineAction: null,
        reasonCodes: ["NEWS_RISK_FILE_MISSING"],
        checkedAt: null,
      };
    }

    const raw = fs.readFileSync(NEWS_RISK_FILE, "utf8");
    const json = JSON.parse(raw);

    return {
      ok: json?.ok === true,
      active: json?.active === true,
      stale: json?.stale === true,
      riskLevel: json?.riskLevel || "UNKNOWN",
      category: json?.category || "UNKNOWN",
      headline: json?.headline || null,
      source: json?.source || null,
      publishedAt: json?.publishedAt || null,
      ageMinutes: json?.ageMinutes ?? null,
      maxAgeMinutes: json?.maxAgeMinutes ?? null,
      engineAction: json?.engineAction || null,
      reasonCodes: Array.isArray(json?.reasonCodes) ? json.reasonCodes : [],
      checkedAt: json?.checkedAt || null,
    };
  } catch (err) {
    return {
      ok: false,
      active: false,
      stale: true,
      riskLevel: "UNKNOWN",
      category: "UNKNOWN",
      headline: null,
      source: null,
      publishedAt: null,
      ageMinutes: null,
      maxAgeMinutes: null,
      engineAction: null,
      reasonCodes: ["NEWS_RISK_READ_FAILED"],
      checkedAt: null,
      error: String(err?.message || err),
    };
  }
}

/* -----------------------------
   Route
------------------------------*/
router.get("/dashboard-snapshot", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || "SPY");
    const snapshot = readSnapshot(symbol);

    if (!snapshot || snapshot.ok === false) {
      return res.status(503).json(snapshot);
    }

    // Engine 24 news-risk display data.
    // Display-only for now. Does not alter Engine 22 or trade decisions.
    snapshot.newsRisk = readNewsRiskSnapshot();

    // Debug metadata for route verification.
    snapshot.snapshotSource = {
      requestedSymbol: symbol,
      file:
        symbol === "ES"
          ? "strategy-snapshot-es.json"
          : "strategy-snapshot.json",
    };

    return res.json(snapshot);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "SNAPSHOT_ROUTE_ERROR",
      message: String(err?.message || err),
    });
  }
});

export default router;
