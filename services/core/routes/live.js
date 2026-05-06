// services/core/routes/live.js
// ---------------------------------------------------------------------------
// LIVE JSON proxies + computed pills endpoint
//
// Routes:
//   /live/intraday          -> data-live-10min/data/outlook_intraday.json
//   /live/hourly            -> data-live-hourly/data/outlook_hourly.json
//   /live/30m               -> data-live-30m/data/outlook_30m.json
//   /live/4h                -> data-live-4h/data/outlook_4h.json
//   /live/eod               -> data-live-eod/data/outlook.json
//   /live/intraday-deltas   -> data-live-10min-sandbox/data/outlook_intraday.json (LEAN)
//   /live/pills             -> { stamp5, stamp10, sectors:{ <11>:{ d5m, d10m } } }
//
// Stabilizer update:
//   - For main Market Meter routes, keep last valid GitHub JSON in memory.
//   - If GitHub is late/bad/missing, return the last-good JSON.
//   - No 1-hour stale warning yet.
//   - No trading logic changes.
// ---------------------------------------------------------------------------

import express from "express";

const liveRouter = express.Router();

/* =============================== Config ================================== */

const GH_OWNER = process.env.LIVE_GH_OWNER || "bfrye1973";
const GH_REPO = process.env.LIVE_GH_REPO || "frye-market-backend";

const INTRA_BRANCH = process.env.LIVE_INTRADAY_BRANCH || "data-live-10min";
const HOURLY_BRANCH = process.env.LIVE_HOURLY_BRANCH || "data-live-hourly";
const M30_BRANCH = process.env.LIVE_30M_BRANCH || "data-live-30m";
const H4_BRANCH = process.env.LIVE_4H_BRANCH || "data-live-4h";
const EOD_BRANCH = process.env.LIVE_EOD_BRANCH || "data-live-eod";
const SANDBOX_BRANCH =
  process.env.LIVE_SANDBOX_BRANCH || "data-live-10min-sandbox";

const INTRA_PATH =
  process.env.LIVE_INTRADAY_PATH || "data/outlook_intraday.json";
const HOURLY_PATH =
  process.env.LIVE_HOURLY_PATH || "data/outlook_hourly.json";
const M30_PATH = process.env.LIVE_30M_PATH || "data/outlook_30m.json";
const H4_PATH = process.env.LIVE_4H_PATH || "data/outlook_4h.json";
const EOD_PATH = process.env.LIVE_EOD_PATH || "data/outlook.json";
const SANDBOX_PATH =
  process.env.LIVE_SANDBOX_PATH || "data/outlook_intraday.json";

/* =============================== Helpers ================================= */

const norm = (s = "") => String(s || "").trim().toLowerCase();

const ALIASES = {
  healthcare: "health care",
  "health-care": "health care",
  "health care": "health care",
  "info tech": "information technology",
  technology: "information technology",
  tech: "information technology",
  communications: "communication services",
  "comm services": "communication services",
  telecom: "communication services",
  staples: "consumer staples",
  discretionary: "consumer discretionary",
  finance: "financials",
  industry: "industrials",
  reit: "real estate",
  reits: "real estate",
};

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

const cacheBust = () => `t=${Date.now()}`;

const rawUrl = (owner, repo, branch, path) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}?${cacheBust()}`;

function setNoStore(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  const text = await r.text();

  return {
    ok: r.ok,
    status: r.status,
    text,
  };
}

function parseJsonSafe(text) {
  try {
    return {
      ok: true,
      json: JSON.parse(text),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      json: null,
      error: String(err?.message || err),
    };
  }
}

async function fetchJson(url) {
  const r = await fetchText(url);

  if (!r.ok) {
    throw new Error(`HTTP ${r.status} for ${url}: ${r.text?.slice(0, 120)}`);
  }

  return JSON.parse(r.text);
}

function addLiveMeta(json, meta = {}) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;

  return {
    ...json,
    liveMeta: {
      ...(json.liveMeta && typeof json.liveMeta === "object"
        ? json.liveMeta
        : {}),
      ...meta,
    },
  };
}

/* ========================== Last-good cache =============================== */

const lastGoodByKey = new Map();

function getLastGood(key) {
  return lastGoodByKey.get(key) || null;
}

function setLastGood(key, json, extra = {}) {
  const record = {
    key,
    json,
    savedAt: new Date().toISOString(),
    sourceUrl: extra.sourceUrl || null,
    routeName: extra.routeName || key,
  };

  lastGoodByKey.set(key, record);
  return record;
}

async function serveLiveJsonWithLastGood({
  key,
  routeName,
  branch,
  path,
  req,
  res,
}) {
  const url = rawUrl(GH_OWNER, GH_REPO, branch, path);

  try {
    const r = await fetchText(url);

    if (!r.ok) {
      throw new Error(`HTTP ${r.status}: ${r.text?.slice(0, 160)}`);
    }

    const parsed = parseJsonSafe(r.text);

    if (!parsed.ok || !parsed.json || typeof parsed.json !== "object") {
      throw new Error(`INVALID_JSON: ${parsed.error || "parse failed"}`);
    }

    setLastGood(key, parsed.json, {
      sourceUrl: url,
      routeName,
    });

    const out = addLiveMeta(parsed.json, {
      source: "GITHUB_RAW",
      routeName,
      usingLastGood: false,
      lastGoodAvailable: true,
      lastGoodSavedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      key,
    });

    setNoStore(res);
    return res.status(200).send(JSON.stringify(out));
  } catch (err) {
    const lastGood = getLastGood(key);

    if (lastGood?.json) {
      console.warn(
        `[live] ${routeName} GitHub fetch failed; serving last-good cache:`,
        String(err?.message || err)
      );

      const out = addLiveMeta(lastGood.json, {
        source: "LAST_GOOD_CACHE",
        routeName,
        usingLastGood: true,
        lastGoodAvailable: true,
        lastGoodSavedAt: lastGood.savedAt,
        failedAt: new Date().toISOString(),
        failureReason: String(err?.message || err),
        key,
      });

      setNoStore(res);
      return res.status(200).send(JSON.stringify(out));
    }

    console.error(`[live] ${routeName} error and no last-good cache:`, err);

    setNoStore(res);
    return res.status(502).json({
      ok: false,
      error: "Bad Gateway",
      routeName,
      usingLastGood: false,
      lastGoodAvailable: false,
      detail: String(err?.message || err),
    });
  }
}

/* Build { sectorKey -> netNH } from intraday/hourly cards */
function netNHMapFromCards(cards = []) {
  const out = {};

  for (const c of Array.isArray(cards) ? cards : []) {
    const canon = ALIASES[norm(c?.sector || "")] || c?.sector || "";
    const key = norm(canon);
    const nh = Number(c?.nh ?? NaN);
    const nl = Number(c?.nl ?? NaN);

    if (key && Number.isFinite(nh) && Number.isFinite(nl)) {
      out[key] = nh - nl;
    }
  }

  return out;
}

/* =============================== Proxies ================================= */

// 10-minute canonical
liveRouter.get("/intraday", async (req, res) => {
  return serveLiveJsonWithLastGood({
    key: "intraday",
    routeName: "intraday",
    branch: INTRA_BRANCH,
    path: INTRA_PATH,
    req,
    res,
  });
});

// 1-hour
liveRouter.get("/hourly", async (req, res) => {
  return serveLiveJsonWithLastGood({
    key: "hourly",
    routeName: "hourly",
    branch: HOURLY_BRANCH,
    path: HOURLY_PATH,
    req,
    res,
  });
});

// 30-minute bridge
liveRouter.get("/30m", async (req, res) => {
  return serveLiveJsonWithLastGood({
    key: "30m",
    routeName: "30m",
    branch: M30_BRANCH,
    path: M30_PATH,
    req,
    res,
  });
});

// 4-hour
liveRouter.get("/4h", async (req, res) => {
  return serveLiveJsonWithLastGood({
    key: "4h",
    routeName: "4h",
    branch: H4_BRANCH,
    path: H4_PATH,
    req,
    res,
  });
});

// EOD
liveRouter.get("/eod", async (req, res) => {
  return serveLiveJsonWithLastGood({
    key: "eod",
    routeName: "eod",
    branch: EOD_BRANCH,
    path: EOD_PATH,
    req,
    res,
  });
});

// 5-minute sandbox (LEAN) — trims big payloads
// NOTE: Kept separate from last-good cache for now. This endpoint is optional/debug-style.
liveRouter.get("/intraday-deltas", async (_req, res) => {
  const url = rawUrl(GH_OWNER, GH_REPO, SANDBOX_BRANCH, SANDBOX_PATH);

  try {
    const r = await fetchText(url);

    if (!r.ok) {
      res.status(r.status);
      setNoStore(res);
      return res.send(r.text);
    }

    const j = JSON.parse(r.text);
    const sectors = j?.deltas?.sectors || j?.outlook?.sectors || {};

    const lean = {
      version: "sandbox-10m-deltas-lean",
      deltasUpdatedAt:
        j?.deltasUpdatedAt || j?.sectorsUpdatedAt || j?.updated_at || null,
      barTs: j?.barTs || j?.ts || null,
      deltas: {
        sectors: Object.fromEntries(
          Object.keys(sectors).map((k) => {
            const v = sectors[k] || {};
            const netTilt =
              typeof v.netTilt === "number"
                ? v.netTilt
                : typeof v.dBreadthPct === "number" &&
                  typeof v.dMomentumPct === "number"
                ? (v.dBreadthPct + v.dMomentumPct) / 2
                : null;

            return [k, { netTilt }];
          })
        ),
      },
    };

    res.status(200);
    setNoStore(res);
    return res.send(JSON.stringify(lean));
  } catch (err) {
    console.error("[live] intraday-deltas trim error:", err);
    setNoStore(res);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
});

/* ======================= /live/pills (computed) ========================== */

/** In-memory cache so we don't hammer GitHub every hit */
const pillsCache = { at: 0, json: null };

/** Remember previous intraday snapshot to compute Δ10m */
let lastCanon = { ts: null, map: null };

liveRouter.get("/pills", async (_req, res) => {
  try {
    const now = Date.now();

    if (pillsCache.json && now - pillsCache.at < 25_000) {
      setNoStore(res);
      return res.status(200).send(JSON.stringify(pillsCache.json));
    }

    // Fetch current canonical and sandbox (lean) in parallel.
    // Keep this as-is for now; /pills is separate from strategy truth.
    const url10 = rawUrl(GH_OWNER, GH_REPO, INTRA_BRANCH, INTRA_PATH);
    const url5 = rawUrl(GH_OWNER, GH_REPO, SANDBOX_BRANCH, SANDBOX_PATH);
    const [j10raw, j5raw] = await Promise.all([fetchJson(url10), fetchJson(url5)]);

    // Canonical map + ts
    const ts10 = j10raw?.sectorsUpdatedAt || j10raw?.updated_at || null;
    const map10 = netNHMapFromCards(
      Array.isArray(j10raw?.sectorCards) ? j10raw.sectorCards : []
    );

    // Δ10m
    let d10m = {};

    if (!lastCanon.ts || !lastCanon.map) {
      d10m = Object.fromEntries(Object.keys(map10).map((k) => [k, 0]));
    } else if (ts10 && ts10 !== lastCanon.ts) {
      const keys = new Set([...Object.keys(map10), ...Object.keys(lastCanon.map)]);

      for (const k of keys) {
        const a = map10[k];
        const b = lastCanon.map[k];
        d10m[k] =
          Number.isFinite(a) && Number.isFinite(b) ? +(a - b).toFixed(2) : 0;
      }
    } else {
      d10m = pillsCache.json?.sectors
        ? Object.fromEntries(
            Object.entries(pillsCache.json.sectors).map(([k, v]) => [
              k,
              v.d10m ?? 0,
            ])
          )
        : Object.fromEntries(Object.keys(map10).map((k) => [k, 0]));
    }

    // Update last canonical snapshot
    if (ts10 && ts10 !== lastCanon.ts) {
      lastCanon = { ts: ts10, map: map10 };
    }

    // Δ5m from sandbox (use netTilt if present)
    const sectors5 = j5raw?.deltas?.sectors || j5raw?.outlook?.sectors || {};
    const ts5 =
      j5raw?.deltasUpdatedAt || j5raw?.sectorsUpdatedAt || j5raw?.updated_at || null;

    // Assemble sectors union in canonical order
    const keysUnion = Array.from(
      new Set(
        ORDER.concat(Object.keys(map10 || {})).concat(
          Object.keys(sectors5 || {}).map((k) => norm(ALIASES[norm(k)] || k))
        )
      )
    );

    const sectors = {};

    for (const kRaw of keysUnion) {
      const k = norm(kRaw);

      // map sandbox key back through aliases if needed
      const d5src = Object.entries(sectors5).find(
        ([name]) => norm(ALIASES[norm(name)] || name) === k
      );

      const tilt = d5src ? d5src[1]?.netTilt : null;

      sectors[k] = {
        d5m:
          typeof tilt === "number" && Number.isFinite(tilt)
            ? +(+tilt).toFixed(2)
            : null,
        d10m:
          typeof d10m[k] === "number" && Number.isFinite(d10m[k]) ? d10m[k] : 0,
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

/* ================================= Export ================================ */

export default liveRouter;
