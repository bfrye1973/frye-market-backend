// algos/index-sectors/10m/formulas.js
// 10m Sector Engine — reads /live/intraday and applies config rules

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { evaluateTilt, evaluateOutlook, evaluateGrade } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runSectorModel() {
  // 1) Load config
  const configPath = path.join(__dirname, "config.json");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // 2) Fetch live intraday feed (dashboard /live/intraday schema)
  const feedUrl = cfg.bindings.feed + `?t=${Date.now()}`;
  const res = await fetch(feedUrl, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) {
    throw new Error(`live feed status ${res.status}`);
  }
  const live = await res.json();

  const cards = Array.isArray(live.sectorCards) ? live.sectorCards : [];
  const fields = cfg.bindings.fields;
  const ORDER = cfg.order;

  // 3) Build normalized sectorCards output
  const out = [];

  for (const sec of ORDER) {
    const card = cards.find((c) => c.sector === sec) || {};

    const breadth = Number(card[fields.breadth] || 0);
    const momentum = Number(card[fields.momentum] || 0);
    const nh = Number(card[fields.nh] || 0);
    const nl = Number(card[fields.nl] || 0);
    const up = Number(card[fields.up] || 0);
    const down = Number(card[fields.down] || 0);

    const tilt = evaluateTilt(cfg.rules.tiltExpr, breadth, momentum);
    const outlook = evaluateOutlook(cfg.rules.outlook, breadth, momentum);
    const grade = evaluateGrade(cfg.rules.gradeThresholds, tilt);

    out.push({
      sector: sec,
      breadth_pct: breadth,
      momentum_pct: momentum,
      nh,
      nl,
      up,
      down,
      tilt,
      outlook,
      grade,
    });
  }

  return {
    version: cfg.version,
    updated_at: live.updated_at,
    updated_at_utc: live.updated_at_utc,
    sectorCards: out,
  };
}
