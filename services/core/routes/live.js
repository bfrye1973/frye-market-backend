// services/core/routes/live.js
// LIVE JSON proxies + computed pills endpoint
//  /live/intraday         -> data-live-10min/data/outlook_intraday.json
//  /live/hourly           -> data-live-hourly/data/outlook_hourly.json
//  /live/eod              -> data-live-eod/data/outlook.json
//  /live/intraday-deltas  -> data-live-10min-sandbox/data/outlook_intraday.json (LEAN)
//  /live/pills            -> { stamp5, stamp10, sectors:{ <11>: d5m, d10m } }
//  /live/sectorcards-10m  -> TEMP BYPASS: proxies local /api/sectorcards-10m (no recursion)

import express from "express";
import fetch from "node-fetch";

const liveRouter = express.Router();

/* =============================== Config =============================== */
const GH_OWNER = process.env.LIVE_GH_OWNER || "bfrye1973";
const GH_REPO  = process.env.LIVE_GH_REPO  || "frye-market-backend";

const INTRA_BRANCH   = process.env.LIVE_INTRADAY_BRANCH || "data-live-10min";
const HOURLY_BRANCH  = process.env.LIVE_HOURLY_BRANCH   || "data-live-hourly";
const EOD_BRANCH     = process.env.LIVE_EOD_BRANCH      || "data-live-eod";
const SANDBOX_BRANCH = process.env.LIVE_SANDBOX_BRANCH  || "data-live-10min-sandbox";

const INTRA_PATH   = process.env.LIVE_INTRADAY_PATH || "data/outlook_intraday.json";
const HOURLY_PATH  = process.env.LIVE_HOURLY_PATH   || "data/outlook_hourly.json";
const EOD_PATH     = process.env.LIVE_EOD_PATH      || "data/outlook.json";
const SANDBOX_PATH = process.env.LIVE_SANDBOX_PATH  || "data/outlook_intraday.json";

/* =============================== Helpers =============================== */
function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function rawUrl(owner, repo, branch, p) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p}`;
}

function rawUrlBusted(p) {
  const bust = Date.now();
  return `${p}${p.includes("?") ? "&" : "?"}t=${bust}`;
}

async function proxyRawJSON(res, url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "frye-live-proxy/1.0" },
  });
  const txt = await r.text();

  setNoStore(res);
  res.status(r.status);

  // Pass through raw JSON (or error payload)
  res.type("application/json").send(txt);
}

/* =============================== Live proxies =============================== */
liveRouter.get("/intraday", async (_req, res) => {
  try {
    const url = rawUrlBusted(rawUrl(GH_OWNER, GH_REPO, INTRA_BRANCH, INTRA_PATH));
    return await proxyRawJSON(res, url);
  } catch (err) {
    console.error("[live] /intraday error:", err);
    setNoStore(res);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
});

liveRouter.get("/hourly", async (_req, res) => {
  try {
    const url = rawUrlBusted(rawUrl(GH_OWNER, GH_REPO, HOURLY_BRANCH, HOURLY_PATH));
    return await proxyRawJSON(res, url);
  } catch (err) {
    console.error("[live] /hourly error:", err);
    setNoStore(res);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
});

liveRouter.get("/eod", async (_req, res) => {
  try {
    const url = rawUrlBusted(rawUrl(GH_OWNER, GH_REPO, EOD_BRANCH, EOD_PATH));
    return await proxyRawJSON(res, url);
  } catch (err) {
    console.error("[live] /eod error:", err);
    setNoStore(res);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
});

// Optional: intraday deltas from sandbox branch (if used by UI)
liveRouter.get("/intraday-deltas", async (_req, res) => {
  try {
    const url = rawUrlBusted(rawUrl(GH_OWNER, GH_REPO, SANDBOX_BRANCH, SANDBOX_PATH));
    return await proxyRawJSON(res, url);
  } catch (err) {
    console.error("[live] /intraday-deltas error:", err);
    setNoStore(res);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
});

/* =============================== Pills merger =============================== */
// Minimal pills merger: pulls 10m canonical + sandbox 5m (if present) and merges into one payload.
// Keeps behavior simple and defensive.
const ORDER = [
  "information technology",
  "materials",
  "health care",
  "communication services",
  "real estate",
  "energy",
  "consumer staples",
  "consumer discretionary",
  "financials",
  "utilities",
  "industrials",
];

const ALIASES = {
  healthcare: "health care",
  "health-care": "health care",
  tech: "information technology",
  "info tech": "information technology",
  communications: "communication services",
  telecom: "communication services",
  staples: "consumer staples",
  discretionary: "consumer discretionary",
  finance: "financials",
  reit: "real estate",
  reits: "real estate",
};

const norm = (s = "") => String(s).trim().toLowerCase();
function canonName(k) {
  const n = norm(k);
  return ALIASES[n] || n;
}

let pillsCache = { at: 0, json: null };
let lastCanon = { ts: null, map: null };

liveRouter.get("/pills", async (_req, res) => {
  try {
    const now = Date.now();
    // Cache for a few seconds to reduce load; still "fresh enough" for UI.
    if (pillsCache.json && now - pillsCache.at < 3000) {
      setNoStore(res);
      return res.status(200).send(JSON.stringify(pillsCache.json));
    }

    // Pull 10m canonical (intraday)
    const url10 = rawUrlBusted(rawUrl(GH_OWNER, GH_REPO, INTRA_BRANCH, INTRA_PATH));
    const r10 = await fetch(url10, { headers: { "User-Agent": "frye-live-pills/1.0" } });
    const j10raw = await r10.json().catch(() => ({}));

    // Pull sandbox (5m deltas payload lives here in your setup)
    const url5 = rawUrlBusted(rawUrl(GH_OWNER, GH_REPO, SANDBOX_BRANCH, SANDBOX_PATH));
    const r5 = await fetch(url5, { headers: { "User-Agent": "frye-live-pills/1.0" } });
    const j5raw = await r5.json().catch(() => ({}));

    const ts10 =
      j10raw?.meta?.last_full_run_utc ||
      j10raw?.updated_at_utc ||
      j10raw?.updated_at ||
      null;

    // Extract 10m sector tilt map defensively
    // Prefer j10raw.sectors[*].sector + .tilt or .netTilt if present
    let map10 = {};
    const s10 = Array.isArray(j10raw?.sectors) ? j10raw.sectors : (Array.isArray(j10raw?.sectorCards) ? j10raw.sectorCards : []);
    if (Array.isArray(s10) && s10.length) {
      for (const c of s10) {
        const k = canonName(c?.sector ?? c?.name ?? "");
        const v = Number(c?.tilt ?? c?.netTilt ?? c?.d10m ?? 0);
        if (k) map10[k] = Number.isFinite(v) ? v : 0;
      }
    } else if (j10raw?.metrics?.sectorDirection10m) {
      // some payloads store sectorDirection10m object
      const o = j10raw.metrics.sectorDirection10m;
      for (const [k, v] of Object.entries(o || {})) map10[canonName(k)] = Number(v) || 0;
    }

    // If canonical 10m is unchanged, keep last known map10 to avoid jitter
    if (ts10 && ts10 !== lastCanon.ts) {
      lastCanon = { ts: ts10, map: map10 };
    } else if (lastCanon.map) {
      map10 = lastCanon.map;
    }

    // 5m sandbox (use netTilt if present)
    const sectors5 = j5raw?.deltas?.sectors || j5raw?.outlook?.sectors || {};
    const ts5 = j5raw?.deltasUpdatedAt || j5raw?.sectorsUpdatedAt || j5raw?.updated_at || null;

    const keysUnion = Array.from(
      new Set(
        ORDER
          .concat(Object.keys(map10 || {}))
          .concat(Object.keys(sectors5 || {}).map((k) => canonName(k)))
      )
    );

    const sectors = {};
    for (const kRaw of keysUnion) {
      const k = canonName(kRaw);

      // map sandbox key back through aliases
      const d5src = Object.entries(sectors5 || {}).find(([name]) => canonName(name) === k);
      const tilt5 = d5src ? d5src[1]?.netTilt : null;

      sectors[k] = {
        d5m: typeof tilt5 === "number" && Number.isFinite(tilt5) ? +tilt5.toFixed(2) : null,
        d10m: typeof map10[k] === "number" && Number.isFinite(map10[k]) ? map10[k] : 0,
      };
    }

    const out = { stamp5: ts5, stamp10: ts10, sectors };
    pillsCache.json = out;
    pillsCache.at = now;

    setNoStore(res);
    return res.status(200).send(JSON.stringify(out));
  } catch (err) {
    console.error("[live] /pills error:", err);
    setNoStore(res);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
});

/* =============================== TEMP BYPASS =============================== */
// TEMP: Serve the working 10m sectorcards directly through /live without touching /live/intraday.
// This avoids recursion because runSectorModel internally fetches /live/intraday.
liveRouter.get("/sectorcards-10m", async (_req, res) => {
  try {
    const port = Number(process.env.PORT) || 8080;
    const url = `http://127.0.0.1:${port}/api/sectorcards-10m`;

    const r = await fetch(url, { headers: { "User-Agent": "live/sectorcards-10m" } });
    const txt = await r.text();

    setNoStore(res);
    return res.status(r.status).type("application/json").send(txt);
  } catch (err) {
    console.error("[live] /sectorcards-10m error:", err);
    setNoStore(res);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
});

export default liveRouter;
