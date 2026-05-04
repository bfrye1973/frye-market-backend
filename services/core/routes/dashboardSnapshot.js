// services/core/routes/dashboardSnapshot.js
// Lightweight dashboard snapshot route
// Reads prebuilt snapshot file instead of recomputing engines

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOT_FILE = path.resolve(
  __dirname,
  "../data/strategy-snapshot.json"
);

const NEWS_RISK_FILE = path.resolve(
  __dirname,
  "../data/news-risk.json"
);

/* -----------------------------
   Read snapshot safely
------------------------------*/
function readSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) {
      return {
        ok: false,
        error: "SNAPSHOT_NOT_READY",
      };
    }

    const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");

    try {
      return JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error: "SNAPSHOT_INVALID_JSON",
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: "SNAPSHOT_READ_FAILED",
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
    const snapshot = readSnapshot();

    if (!snapshot || snapshot.ok === false) {
      return res.status(503).json(snapshot);
    }

    // Engine 24 news-risk display data.
    // Display-only for now. Does not alter Engine 22 or trade decisions.
    snapshot.newsRisk = readNewsRiskSnapshot();

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
