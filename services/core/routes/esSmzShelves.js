// services/core/routes/esSmzShelves.js
// Engine 1B — ES Futures Imbalance Shelves Route
//
// Reads:
// services/core/data/es-smz-shelves.json
//
// Endpoint should be mounted as:
// /api/v1/es-smz-shelves

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const shelvesPath = path.resolve(__dirname, "../data/es-smz-shelves.json");

router.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "ES").toUpperCase();

    if (symbol !== "ES") {
      return res.status(400).json({
        ok: false,
        error: "This route is ES-only. Use symbol=ES.",
        symbol,
      });
    }

    if (!fs.existsSync(shelvesPath)) {
      return res.json({
        ok: true,
        symbol: "ES",
        current_price: null,
        levels: [],
        levels_debug: [],
        note: "No ES SMZ shelves generated yet",
      });
    }

    const raw = fs.readFileSync(shelvesPath, "utf8");
    const json = JSON.parse(raw);

    res.json({
      ok: true,
      ...json,
      symbol: json.symbol || "ES",
    });
  } catch (err) {
    console.error("[/api/v1/es-smz-shelves] error:", err);

    res.status(500).json({
      ok: false,
      symbol: "ES",
      error: "Failed to load ES SMZ shelves",
    });
  }
});

export default router;
