// api/routes/sectorcards-10m.js
// 10m Sector Adapter using algos/index-sectors/10m/formulas.js

import express from "express";
import { runSectorModel } from "../../algos/index-sectors/10m/formulas.js";

const router = express.Router();

function toNumber(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function toInt(x) {
  const v = Number(x);
  return Number.isFinite(v) ? Math.trunc(v) : 0;
}

router.get("/", async (req, res) => {
  try {
    // 1) Run the sector model (this fetches /live/intraday internally)
    const result = await runSectorModel();

    const version = result?.version || "r10m-unknown";
    const raw = result?.sectorCards || result?.sectors || [];
    const sectorCards = Array.isArray(raw) ? raw : [];

    // 2) Basic validation and normalization
    const errors = [];
    if (sectorCards.length !== 11) {
      errors.push(`expected 11 sectors, got ${sectorCards.length}`);
    }

    for (const c of sectorCards) {
      const name = c.sector || "unknown";

      // normalize numeric fields
      c.breadth_pct = toNumber(c.breadth_pct);
      c.momentum_pct = toNumber(c.momentum_pct);
      c.tilt = toNumber(c.tilt);

      c.nh = toInt(c.nh);
      c.nl = toInt(c.nl);
      c.up = toInt(c.up);
      c.down = toInt(c.down);

      if (!Number.isFinite(c.breadth_pct))
        errors.push(`non-numeric breadth_pct for ${name}`);
      if (!Number.isFinite(c.momentum_pct))
        errors.push(`non-numeric momentum_pct for ${name}`);
      if (!Number.isFinite(c.tilt))
        errors.push(`non-numeric tilt for ${name}`);

      if (!Number.isFinite(c.nh)) errors.push(`non-numeric nh for ${name}`);
      if (!Number.isFinite(c.nl)) errors.push(`non-numeric nl for ${name}`);
      if (!Number.isFinite(c.up)) errors.push(`non-numeric up for ${name}`);
      if (!Number.isFinite(c.down)) errors.push(`non-numeric down for ${name}`);

      if (!c.outlook) errors.push(`missing outlook for ${name}`);
      if (!c.grade) errors.push(`missing grade for ${name}`);
    }

    res.setHeader("Cache-Control", "no-store");

    if (errors.length > 0) {
      console.warn("[sectorcards-10m] validation failed:", errors.join("; "));
      return res.status(200).json({
        ok: false,
        fallback: true,
        error: `validation failed: ${errors.join("; ")}`,
      });
    }

    // 3) Success log
    if (sectorCards[0]) {
      console.log(
        `[sectorcards-10m] v=${version} len=${sectorCards.length} ` +
          `first=${sectorCards[0].sector} tilt=${sectorCards[0].tilt} ` +
          `outlook=${sectorCards[0].outlook}`
      );
    }

    // 4) Success response
    return res.json({
      ok: true,
      version,
      sectorCards,
    });
  } catch (err) {
    console.error("[sectorcards-10m] error:", err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: false,
      fallback: true,
      error: err?.message || "sectorcards-10m error",
    });
  }
});

export default router;
