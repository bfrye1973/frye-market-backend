// services/core/routes/live.js
// ---------------------------------------------------------------------------
// Proxies LIVE JSON snapshots from GitHub (data-live-* branches)
//   /live/intraday         -> data-live-10min/data/outlook_intraday.json
//   /live/hourly           -> data-live-hourly/data/outlook_hourly.json
//   /live/eod              -> data-live-eod/data/outlook.json
//   /live/intraday-deltas  -> data-live-10min-sandbox/data/outlook_intraday.json
//                              (TRIMMED to a lean payload for Row 4 Δ5m pills)
// ---------------------------------------------------------------------------

import express from "express";
const liveRouter = express.Router();

/* =============================== Config ================================== */
/** Owner/repo can be overridden without touching code */
const GH_OWNER = process.env.LIVE_GH_OWNER || "bfrye1973";
const GH_REPO  = process.env.LIVE_GH_REPO  || "frye-market-backend";

/** Branches for each feed */
const INTRA_BRANCH   = process.env.LIVE_INTRADAY_BRANCH   || "data-live-10min";
const HOURLY_BRANCH  = process.env.LIVE_HOURLY_BRANCH     || "data-live-hourly";
const EOD_BRANCH     = process.env.LIVE_EOD_BRANCH        || "data-live-eod";
const SANDBOX_BRANCH = process.env.LIVE_SANDBOX_BRANCH    || "data-live-10min-sandbox";

/** Paths within each branch */
const INTRA_PATH   = process.env.LIVE_INTRADAY_PATH   || "data/outlook_intraday.json";
const HOURLY_PATH  = process.env.LIVE_HOURLY_PATH     || "data/outlook_hourly.json";
const EOD_PATH     = process.env.LIVE_EOD_PATH        || "data/outlook.json";
const SANDBOX_PATH = process.env.LIVE_SANDBOX_PATH    || "data/outlook_intraday.json";

/* =============================== Helpers ================================= */
const cacheBust = () => `t=${Date.now()}`;
const rawUrl = (owner, repo, branch, path) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}?${cacheBust()}`;

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

/** Generic passthrough proxy (keeps full upstream JSON body) */
async function proxyRawJson(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    res.status(r.status);
    setNoStore(res);
    return res.send(text);
  } catch (err) {
    console.error("[live] proxy error:", err);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
}

/**
 * Fetches sandbox JSON and returns a LEAN response for Row 4:
 * {
 *   version: "sandbox-10m-deltas-lean",
 *   deltasUpdatedAt: "<stamp>",
 *   barTs: "<stamp>",
 *   deltas: { sectors: { <11 keys>: { netTilt: Number|null } } }
 * }
 */
async function fetchAndTrimSandbox(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    if (!r.ok) {
      res.status(r.status);
      setNoStore(res);
      return res.send(text);
    }

    const j = JSON.parse(text);

    // Prefer direct deltas.sectors; fallback to outlook.sectors and compute tilt if available
    const sectorsSrc = j?.deltas?.sectors || j?.outlook?.sectors || {};
    const out = {
      version: "sandbox-10m-deltas-lean",
      deltasUpdatedAt: j?.deltasUpdatedAt || j?.sectorsUpdatedAt || j?.updated_at || null,
      barTs: j?.barTs || j?.ts || null,
      deltas: {
        sectors: Object.fromEntries(
          Object.keys(sectorsSrc).map((k) => {
            const v = sectorsSrc[k] || {};
            // Use netTilt if present; otherwise compute from dBreadthPct/dMomentumPct when both exist
            const netTilt =
              typeof v.netTilt === "number"
                ? v.netTilt
                : (typeof v.dBreadthPct === "number" && typeof v.dMomentumPct === "number")
                ? (v.dBreadthPct + v.dMomentumPct) / 2
                : null;
            return [k, { netTilt }];
          })
        ),
      },
    };

    res.status(200);
    setNoStore(res);
    return res.send(JSON.stringify(out));
  } catch (err) {
    console.error("[live] trim sandbox error:", err);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
}

/* ================================= Routes ================================ */

/** 10-minute canonical */
liveRouter.get("/intraday", async (_req, res) => {
  const url = rawUrl(GH_OWNER, GH_REPO, INTRA_BRANCH, INTRA_PATH);
  console.log("[live] intraday →", url);
  return proxyRawJson(res, url);
});

/** 1-hour */
liveRouter.get("/hourly", async (_req, res) => {
  const url = rawUrl(GH_OWNER, GH_REPO, HOURLY_BRANCH, HOURLY_PATH);
  console.log("[live] hourly →", url);
  return proxyRawJson(res, url);
});

/** End-of-day */
liveRouter.get("/eod", async (_req, res) => {
  const url = rawUrl(GH_OWNER, GH_REPO, EOD_BRANCH, EOD_PATH);
  console.log("[live] eod →", url);
  return proxyRawJson(res, url);
});

/** NEW: 5-minute sandbox deltas (LEAN) */
liveRouter.get("/intraday-deltas", async (_req, res) => {
  const url = rawUrl(GH_OWNER, GH_REPO, SANDBOX_BRANCH, SANDBOX_PATH);
  console.log("[live] intraday-deltas (lean) →", url);
  return fetchAndTrimSandbox(res, url);
});

/* ================================= Export ================================ */
export default liveRouter;
