// services/core/routes/smzShelves.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// Fix __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the generated shelves JSON file
const shelvesPath = path.resolve(__dirname, "../data/smz-shelves.json");

router.get("/", async (req, res) => {
  try {
    if (!fs.existsSync(shelvesPath)) {
      return res.json({
        ok: true,
        shelves: [],
        note: "No SMZ shelves generated yet",
      });
    }

    const raw = fs.readFileSync(shelvesPath, "utf8");
    const json = JSON.parse(raw);

    res.json({ ok: true, ...json });
  } catch (err) {
    console.error("[/api/v1/smz-shelves] error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to load SMZ shelves",
    });
  }
});

export default router;
