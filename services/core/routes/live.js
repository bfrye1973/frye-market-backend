// services/core/routes/live.js
// ------------------------------------------------------------
// Proxies LIVE JSON snapshots from GitHub (data-live-* branches)
// /live/intraday  -> outlook_intraday.json
// /live/hourly    -> outlook_hourly.json
// /live/eod       -> outlook.json
// ------------------------------------------------------------

import express from "express";

const liveRouter = express.Router();

// --- Defaults (override with ENV if needed) ---
const GH_OWNER = process.env.LIVE_GH_OWNER || "bfrye1973";
const GH_REPO  = process.env.LIVE_GH_REPO  || "frye-market-backend";

const INTRA_BRANCH = process.env.LIVE_INTRADAY_BRANCH || "data-live-10min";
const HOURLY_BRANCH= process.env.LIVE_HOURLY_BRANCH   || "data-live-hourly";
const EOD_BRANCH   = process.env.LIVE_EOD_BRANCH      || "data-live-eod";

const INTRA_PATH = process.env.LIVE_INTRADAY_PATH || "data/outlook_intraday.json";
const HOURLY_PATH= process.env.LIVE_HOURLY_PATH   || "data/outlook_hourly.json";
const EOD_PATH   = process.env.LIVE_EOD_PATH      || "data/outlook.json";

// --- Helper: build GitHub raw URL ---
function buildRawUrl(owner, repo, branch, path) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

// --- Helper: fetch and proxy GitHub JSON ---
async function proxyRawJson(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      console.error(`[live.js] Upstream ${r.status}: ${url}`);
      return res
        .status(r.status)
        .json({ ok: false, error: `Upstream ${r.status}`, url });
    }

    const text = await r.text();
    res.setHeader("Cache-Control", "no-store");
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

// --- Routes ---
liveRouter.get("/intraday", async (_req, res) => {
  const url = buildRawUrl(GH_OWNER, GH_REPO, INTRA_BRANCH, INTRA_PATH);
  console.log("[live] intraday →", url);
  return proxyRawJson(res, url);
});

liveRouter.get("/hourly", async (_req, res) => {
  const url = buildRawUrl(GH_OWNER, GH_REPO, HOURLY_BRANCH, HOURLY_PATH);
  console.log("[live] hourly →", url);
  return proxyRawJson(res, url);
});

liveRouter.get("/eod", async (_req, res) => {
  const url = buildRawUrl(GH_OWNER, GH_REPO, EOD_BRANCH, EOD_PATH);
  console.log("[live] eod →", url);
  return proxyRawJson(res, url);
});

// --- Export ---
export default liveRouter;
