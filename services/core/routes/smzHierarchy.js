import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { reduceSmzAndShelves } from "../logic/smzHierarchyReducer.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEVELS_PATH = path.resolve(__dirname, "../data/smz-levels.json");
const SHELVES_PATH = path.resolve(__dirname, "../data/smz-shelves.json");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

router.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const levelsJson = readJson(LEVELS_PATH) || { levels: [] };
  const shelvesJson = readJson(SHELVES_PATH) || { levels: [] };

  const inst = Array.isArray(levelsJson.levels) ? levelsJson.levels : [];
  const sh = Array.isArray(shelvesJson.levels) ? shelvesJson.levels : [];

  // currentPrice: use midpoint of last known institutional zone if present,
  // otherwise try last shelf midpoint (safe fallback)
  const currentPrice =
    Number(levelsJson?.meta?.current_price_anchor) ||
    Number(shelvesJson?.meta?.current_price_anchor) ||
    null;

  const reduced = reduceSmzAndShelves({
    institutionalLevels: inst,
    shelfLevels: sh,
    currentPrice,
    maxInstitutionalOut: 3,
    tolerancePts: 0.75,
  });

  res.json(reduced);
});

export default router;
