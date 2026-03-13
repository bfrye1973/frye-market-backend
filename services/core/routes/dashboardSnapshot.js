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
   Route
------------------------------*/
router.get("/dashboard-snapshot", async (req, res) => {
  try {
    const snapshot = readSnapshot();

    if (!snapshot || snapshot.ok === false) {
      return res.status(503).json(snapshot);
    }

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
