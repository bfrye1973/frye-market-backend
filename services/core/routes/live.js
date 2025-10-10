// services/core/routes/live.js
// ------------------------------------------------------------
// Proxies LIVE JSON snapshots from GitHub (data-live-* branches)
// /live/intraday        -> outlook_intraday.json
// /live/hourly          -> outlook_hourly.json
// /live/eod             -> outlook.json
// /live/intraday-deltas -> sandbox 5m deltas (data-live-10min-sandbox)
// ------------------------------------------------------------

import express from "express";
const liveRouter = express.Router();

/* -------------------------- Defaults -------------------------- */
const GH_OWNER = process.env.LIVE_GH_OWNER || "bfrye1973";
const GH_REPO  = process.env.LIVE_GH_REPO  || "frye-market-backend";

const INTRA_BRANCH   = process.env.LIVE_INTRADAY_BRANCH   || "data-live-10min";
const HOURLY_BRANCH  = process.env.LIVE_HOURLY_BRANCH     || "data-live-hourly";
const EOD_BRANCH     = process.env.LIVE_EOD_BRANCH        || "data-live-eod";
const SANDBOX_BRANCH = process.env.LIVE_SANDBOX_BRANCH    || "data-live-10min-sandbox";

const INTRA_PATH   = process.env.LIVE_INTRADAY_PATH   || "data/outlook_intraday.json";
const HOURLY_PATH  = process.env.LIVE_HOURLY_PATH     || "data/outlook_hourly.json";
const EOD_PATH     = process.env.LIVE_EOD_PATH        || "data/outlook.json";
const SANDBOX_PATH = process.env.LIVE_SANDBOX_PATH    || "data/outlook_intraday.json";

/* -------------------------- Helpers -------------------------- */
function buildRawUrl(owner, repo, branch, path) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}?t=${Date.now()}`;
}

async function proxyRawJson(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();

    res.status(r.status);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    return res.send(text);
  } catch (err) {
    console.error(`[live.js] Proxy error: ${err.message}`);
    return res.status(502).json({
      ok: false,
      error: "Bad Gateway",
      detail: String(err?.message || err),
      url,
    });
  }
}

/* -------------------------- Routes -------------------------- */

// 10-minute canonical
liveRouter.get("/intraday", async (_req, res) => {
  const url = buildRawUrl(GH_OWNER, GH_REPO, INTRA_BRANCH, INTRA_PATH);
  console.log("[live] intraday →", url);
  return proxyRawJson(res, url);
});

// 1-hour
liveRouter.get("/hourly", async (_req, res) => {
  const url = buildRawUrl(GH_OWNER, GH_REPO, HOURLY_BRANCH, HOURLY_PATH);
  console.log("[live] hourly →", url);
  return proxyRawJson(res, url);
});

// End-of-day
liveRouter.get("/eod", async (_req, res) => {
  const url = buildRawUrl(GH_OWNER, GH_REPO, EOD_BRANCH, EOD_PATH);
  console.log("[live] eod →", url);
  return proxyRawJson(res, url);
});

// NEW: 5-minute sandbox deltas
liveRouter.get("/intraday-deltas", async (_req, res) => {
  const url = buildRawUrl(GH_OWNER, GH_REPO, SANDBOX_BRANCH, SANDBOX_PATH);
  console.log("[live] intraday-deltas →", url);
  return proxyRawJson(res, url);
});

/* -------------------------- Export -------------------------- */
export default liveRouter;
