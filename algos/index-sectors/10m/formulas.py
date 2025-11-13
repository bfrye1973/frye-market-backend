// formulas.js — This is the isolated 10m Sector Engine

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { evaluateTilt, evaluateOutlook, evaluateGrade } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runSectorModel() {
  const configPath = path.join(__dirname, "config.json");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));

  const feedUrl = cfg.bindings.feed + `?t=${Date.now()}`;
  const res = await fetch(feedUrl, { headers: { "Cache-Control": "no-cache" } });
  const live = await res.json();

  const cards = live.sectorCards || [];
  const fields = cfg.bindings.fields;
  const ORDER = cfg.order;

  // Build normalized output
  const out = [];

  for (const sec of ORDER) {
    const card = cards.find(c => c.sector === sec) || {};

    const breadth  = Number(card[fields.breadth]  || 0);
    const momentum = Number(card[fields.momentum] || 0);
    const nh       = Number(card[fields.nh]       || 0);
    const nl       = Number(card[fields.nl]       || 0);
    const up       = Number(card[fields.up]       || 0);
    const down     = Number(card[fields.down]     || 0);

    const tilt     = evaluateTilt(cfg.rules.tiltExpr, breadth, momentum);
    const outlook  = evaluateOutlook(cfg.rules.outlook, breadth, momentum);
    const grade    = evaluateGrade(cfg.rules.gradeThresholds, tilt);

    out.push({
      sector: sec,
      breadth_pct: breadth,
      momentum_pct: momentum,
      nh, nl, up, down,
      tilt,
      outlook,
      grade
    });
  }

  return {
    version: cfg.version,
    updated_at: live.updated_at,
    updated_at_utc: live.updated_at_utc,
    sectors: out
  };
}
