import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
export default router;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SECTORS_DIR = path.join(__dirname, "..", "..", "..", "data", "sectors");

const FMP_KEY = process.env.FMP_API_KEY || "";
const FMP_BASE = "https://financialmodelingprep.com/stable";
const LARGE_MIN = 10_000_000_000;
const MID_MIN = 2_000_000_000;
const CACHE_MS = 12 * 60 * 60 * 1000;

let cache = null;

function readUniverse() {
  const symbols = new Set();
  if (!fs.existsSync(SECTORS_DIR)) return [];
  for (const name of fs.readdirSync(SECTORS_DIR)) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    const text = fs.readFileSync(path.join(SECTORS_DIR, name), "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) continue;
    const header = lines[0].split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
    let idx = header.findIndex((x) => x.toLowerCase() === "symbol");
    if (idx < 0) idx = 0;
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const sym = String(cols[idx] || "").trim().replace(/^"|"$/g, "").toUpperCase();
      if (sym) symbols.add(sym);
    }
  }
  return [...symbols].sort();
}

async function fetchBatchCaps(symbols) {
  const caps = {};
  const errors = [];
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    const url = new URL(`${FMP_BASE}/market-capitalization-batch`);
    url.searchParams.set("symbols", chunk.join(","));
    url.searchParams.set("apikey", FMP_KEY);

    try {
      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      if (!res.ok || !Array.isArray(json)) {
        errors.push(`batch ${i / 100}: HTTP ${res.status} ${text.slice(0,120)}`);
        continue;
      }
      for (const row of json) {
        const sym = String(row?.symbol || "").toUpperCase();
        const cap = Number(row?.marketCap);
        if (sym && Number.isFinite(cap) && cap > 0) caps[sym] = cap;
      }
    } catch (err) {
      errors.push(`batch ${i / 100}: ${err?.message || String(err)}`);
    }
  }
  return { caps, errors };
}

function bucketFor(cap) {
  if (!Number.isFinite(cap) || cap <= 0) return "unknown";
  if (cap >= LARGE_MIN) return "large";
  if (cap >= MID_MIN) return "mid";
  return "small";
}

async function build() {
  const symbols = readUniverse();
  if (!FMP_KEY) {
    return {
      ok: false,
      error: "FMP_API_KEY_MISSING_ON_BACKEND",
      symbols: symbols.length,
    };
  }

  const { caps, errors } = await fetchBatchCaps(symbols);
  const buckets = {};
  const counts = { large: 0, mid: 0, small: 0, unknown: 0 };

  for (const sym of symbols) {
    const bucket = bucketFor(caps[sym]);
    buckets[sym] = bucket;
    counts[bucket] += 1;
  }

  return {
    ok: true,
    engine: "engine25.capUniverse.v1",
    generatedAtUtc: new Date().toISOString(),
    thresholds: {
      largeMin: LARGE_MIN,
      midMin: MID_MIN,
      smallMaxExclusive: MID_MIN,
    },
    totalSymbols: symbols.length,
    classifiedSymbols: symbols.length - counts.unknown,
    coveragePct: symbols.length
      ? Number((((symbols.length - counts.unknown) / symbols.length) * 100).toFixed(2))
      : 0,
    counts,
    buckets,
    errors: errors.slice(0, 10),
  };
}

router.get("/engine25/cap-universe", async (_req, res) => {
  try {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_MS) {
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ...cache.value, cache: "HIT" });
    }

    const value = await build();
    if (value.ok) cache = { at: now, value };

    res.setHeader("Cache-Control", "no-store");
    return res.status(value.ok ? 200 : 503).json({ ...value, cache: "MISS" });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "ENGINE25_CAP_UNIVERSE_FAILED",
      detail: err?.message || String(err),
    });
  }
});
