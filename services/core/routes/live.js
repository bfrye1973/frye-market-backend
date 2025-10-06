// services/core/routes/live.js
// Proxies LIVE JSON snapshots from GitHub (data-live-* branches)
// GET /live/intraday  -> outlook_intraday.json
// GET /live/hourly    -> outlook_hourly.json
// GET /live/eod       -> outlook.json

import express from "express";

const liveRouter = express.Router();

// Defaults (can be overridden by Render ENV if needed)
const GH_OWNER = process.env.LIVE_GH_OWNER || "bfrye1973";
const GH_REPO  = process.env.LIVE_GH_REPO  || "frye-market-backend";

const INTRA_BRANCH = process.env.LIVE_INTRADAY_BRANCH || "data-live-10min";
const HOURLY_BRANCH= process.env.LIVE_HOURLY_BRANCH   || "data-live-hourly";
const EOD_BRANCH   = process.env.LIVE_EOD_BRANCH      || "data-live-eod";

const INTRA_PATH = process.env.LIVE_INTRADAY_PATH || "data/outlook_intraday.json";
const HOURLY_PATH= process.env.LIVE_HOURLY_PATH   || "data/outlook_hourly.json";
const EOD_PATH   = process.env.LIVE_EOD_PATH      || "data/outlook.json";

function raw(owner, repo, branch, path) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

async function proxyRawJson(res, rawUrl) {
  try {
    const r = await fetch(rawUrl, { cache: "no-store" });
    if (!r.ok) {
      return res.status(r.status).json({ ok:false, error:`Upstream ${r.status}`, url: rawUrl });
    }
    const text = await r.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ ok:false, error:"Bad Gateway", detail:String(e?.message||e), url: rawUrl });
  }
}

liveRouter.get("/intraday", (_req, res) =>
  proxyRawJson(res, raw(GH_OWNER, GH_REPO, INTRA_BRANCH, INTRA_PATH))
);

liveRouter.get("/hourly", (_req, res) =>
  proxyRawJson(res, raw(GH_OWNER, GH_REPO, HOURLY_BRANCH, HOURLY_PATH))
);

liveRouter.get("/eod", (_req, res) =>
  proxyRawJson(res, raw(GH_OWNER, GH_REPO, EOD_BRANCH, EOD_PATH))
);

export default liveRoutli
