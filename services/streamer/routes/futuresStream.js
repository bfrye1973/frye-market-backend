// services/streamer/routes/futuresStream.js
// Backend-2 — Futures stream/resolver routes
//
// Phase 2:
// - Resolve user-facing ES -> active Polygon futures contract like ESM6
// - Stream live ES futures trades from Polygon futures websocket
// - Build 1m / higher timeframe candles from trades
// - Keep frontend bar contract same as stock stream
// - Do NOT touch stock /stream/agg

import express from "express";
import WebSocket from "ws";
import { DateTime } from "luxon";

const router = express.Router();
export default router;

const POLYGON_REST_BASE =
  process.env.POLYGON_REST_BASE ||
  process.env.POLYGON_BASE_URL ||
  "https://api.polygon.io";

const POLY_FUTURES_WS_URL =
  process.env.POLY_FUTURES_WS_URL ||
  process.env.POLYGON_FUTURES_WS_URL ||
  "wss://socket.polygon.io/futures";

const FUTURES_SNAPSHOT_PATH = "/futures/v1/snapshot";
const NY_ZONE = "America/New_York";

const RESOLVE_CACHE_MS = Number(
  process.env.FUTURES_RESOLVE_CACHE_MS || 2 * 60 * 1000
);

const resolveCache = new Map();

/* -------------------------------------------------
   Env / helpers
-------------------------------------------------- */

function resolvePolygonKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}

function cleanProductCode(v) {
  const s = String(v || "ES").trim().toUpperCase();
  return s || "ES";
}

function nowIso() {
  return new Date().toISOString();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toUnixSec(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Polygon can send:
  // seconds:      1778531640
  // milliseconds: 1778531640000
  // microseconds: 1778531640000000
  // nanoseconds:  1778531640000000000
  if (n > 1e17) return Math.floor(n / 1e9); // nanoseconds
  if (n > 1e14) return Math.floor(n / 1e6); // microseconds
  if (n > 1e12) return Math.floor(n / 1000); // milliseconds

  return Math.floor(n); // seconds
}

function parseDateMs(v) {
  if (!v) return null;

  if (typeof v === "number") {
    if (v > 1e12) return v;
    if (v > 1e9) return v * 1000;
    return null;
  }

  const s = String(v).trim();
  if (!s) return null;

  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeMode(m) {
  const s = String(m || "eth").toLowerCase().trim();
  return s === "rth" ? "rth" : "eth";
}

function normalizeTfStr(tf) {
  const t = String(tf || "1m").toLowerCase().trim();
  if (t === "1d") return "1d";
  if (t.endsWith("m")) return t;
  if (t.endsWith("h")) return t;
  return "1m";
}

function normalizeTfMin(tf) {
  const t = normalizeTfStr(tf);
  if (t === "1d") return 1440;
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  return 1;
}

function labelTf(tfMin) {
  return tfMin >= 1440
    ? "1d"
    : tfMin % 60 === 0
      ? `${tfMin / 60}h`
      : `${tfMin}m`;
}

function safeJsonShape(value) {
  if (!value || typeof value !== "object") return typeof value;

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sampleKeys:
        value.length && value[0] && typeof value[0] === "object"
          ? Object.keys(value[0]).slice(0, 30)
          : [],
    };
  }

  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 50)) {
    if (Array.isArray(v)) {
      out[k] = {
        type: "array",
        length: v.length,
        sampleKeys:
          v.length && v[0] && typeof v[0] === "object"
            ? Object.keys(v[0]).slice(0, 30)
            : [],
      };
    } else if (v && typeof v === "object") {
      out[k] = {
        type: "object",
        keys: Object.keys(v).slice(0, 30),
      };
    } else {
      out[k] = typeof v;
    }
  }

  return out;
}

/* -------------------------------------------------
   SSE helpers
-------------------------------------------------- */

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/* -------------------------------------------------
   Session bucketing
-------------------------------------------------- */

function nyAnchors(unixSec) {
  const ny = DateTime.fromSeconds(unixSec, { zone: NY_ZONE });
  const dayStart = ny.startOf("day");
  const open = dayStart.plus({ hours: 9, minutes: 30 });
  const close = dayStart.plus({ hours: 16, minutes: 0 });

  return {
    dayStartSec: Math.floor(dayStart.toSeconds()),
    openSec: Math.floor(open.toSeconds()),
    closeSec: Math.floor(close.toSeconds()),
  };
}

function bucketStartSecRth(unixSec, tfMin) {
  const { dayStartSec, openSec, closeSec } = nyAnchors(unixSec);

  if (tfMin >= 1440) return dayStartSec;
  if (unixSec < openSec || unixSec >= closeSec) return null;

  const size = tfMin * 60;
  const idx = Math.floor((unixSec - openSec) / size);
  const bucket = openSec + idx * size;

  if (bucket >= closeSec) return null;
  return bucket;
}

function bucketStartSecEth(unixSec, tfMin) {
  if (tfMin >= 1440) {
    const { dayStartSec } = nyAnchors(unixSec);
    return dayStartSec;
  }

  const size = tfMin * 60;
  return Math.floor(unixSec / size) * size;
}

function bucketStartSecByMode(unixSec, tfMin, mode) {
  return mode === "rth"
    ? bucketStartSecRth(unixSec, tfMin)
    : bucketStartSecEth(unixSec, tfMin);
}

/* -------------------------------------------------
   Polygon ES ticker handling
-------------------------------------------------- */

function isSpreadTicker(ticker) {
  return String(ticker || "").includes("-");
}

function isPlainFuturesTicker(ticker, productCode) {
  const t = String(ticker || "").trim().toUpperCase();
  const pc = String(productCode || "").trim().toUpperCase();

  if (!t || !pc) return false;
  if (isSpreadTicker(t)) return false;

  const re = new RegExp(`^${pc}[FGHJKMNQUVXZ]\\d{1,2}$`);
  return re.test(t);
}

function getContractYearHint(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  const m = t.match(/(\d{1,2})$/);
  return m ? m[1] : null;
}

function normalizePolygonCandidate(row, productCode) {
  if (!row || typeof row !== "object") return null;

  const details = row.details || {};
  const session = row.session || {};

  const ticker = String(details.ticker || "").trim().toUpperCase();
  const rowProductCode = String(details.product_code || productCode || "")
    .trim()
    .toUpperCase();

  if (rowProductCode !== String(productCode).toUpperCase()) return null;
  if (!isPlainFuturesTicker(ticker, productCode)) return null;

  const settlementDate = details.settlement_date || null;
  const settlementMs = parseDateMs(settlementDate);
  const volume = toNum(session.volume) ?? 0;
  const close = toNum(session.close);
  const open = toNum(session.open);
  const high = toNum(session.high);
  const low = toNum(session.low);

  const now = Date.now();
  const daysToSettlement =
    settlementMs && settlementMs > 0
      ? Math.round((settlementMs - now) / 86400000)
      : null;

  const isExpired =
    settlementMs && Number.isFinite(settlementMs) ? settlementMs < now : false;

  return {
    ticker,
    productCode: rowProductCode,
    settlementDate,
    settlementMs,
    daysToSettlement,
    isExpired,
    volume,
    close,
    open,
    high,
    low,
    yearHint: getContractYearHint(ticker),
    rawKeys: Object.keys(row).slice(0, 40),
    detailKeys: Object.keys(details).slice(0, 40),
    sessionKeys: Object.keys(session).slice(0, 40),
  };
}

function chooseResolvedContractFromSnapshot(json, productCode) {
  const results = Array.isArray(json?.results) ? json.results : [];

  const allCandidates = results
    .map((row) => normalizePolygonCandidate(row, productCode))
    .filter(Boolean);

  const validNonExpired = allCandidates.filter((c) => !c.isExpired);

  const sorted = [...validNonExpired].sort((a, b) => {
  const aSettle = Number(a.settlementMs || Number.MAX_SAFE_INTEGER);
  const bSettle = Number(b.settlementMs || Number.MAX_SAFE_INTEGER);

  if (aSettle !== bSettle) return aSettle - bSettle;

  return Number(b.volume || 0) - Number(a.volume || 0);
});

  const selected = sorted[0] || null;

  return {
    resolvedSymbol: selected?.ticker || null,
    selected,
    candidates: sorted,
    allCandidateCount: allCandidates.length,
    rawResultCount: results.length,
  };
}

/* -------------------------------------------------
   Polygon REST resolver
-------------------------------------------------- */

async function fetchFuturesSnapshot(productCode, apiKey) {
  const base = String(POLYGON_REST_BASE || "").replace(/\/+$/, "");
  const url = new URL(`${base}${FUTURES_SNAPSHOT_PATH}`);
  url.searchParams.set("product_code", productCode);
  url.searchParams.set("apiKey", apiKey);

  const r = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await r.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: r.ok,
    status: r.status,
    statusText: r.statusText,
    json,
    textPreview: json ? null : text.slice(0, 500),
  };
}

async function resolveFuturesContract(productCode) {
  const apiKey = resolvePolygonKey();

  if (!apiKey) {
    return {
      ok: false,
      error: "missing_polygon_api_key",
      productCode,
      checkedAt: nowIso(),
    };
  }

  const cacheKey = productCode;
  const cached = resolveCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAtMs < RESOLVE_CACHE_MS) {
    return {
      ...cached.value,
      cached: true,
      cacheAgeMs: Date.now() - cached.cachedAtMs,
    };
  }

  const fetched = await fetchFuturesSnapshot(productCode, apiKey);

  if (!fetched.ok) {
    const value = {
      ok: false,
      error: "polygon_futures_snapshot_failed",
      productCode,
      status: fetched.status,
      statusText: fetched.statusText,
      polygonPreview: fetched.textPreview,
      polygonShape: safeJsonShape(fetched.json),
      checkedAt: nowIso(),
      cached: false,
    };

    resolveCache.set(cacheKey, {
      cachedAtMs: Date.now(),
      value,
    });

    return value;
  }

  const chosen = chooseResolvedContractFromSnapshot(fetched.json, productCode);

  const value = {
    ok: true,
    productCode,
    resolvedSymbol: chosen.resolvedSymbol,
    source: "polygon_futures_snapshot",
    selectionRule:
      "plain_non_spread_contract_highest_volume_then_nearest_settlement",
    needsInspection: !chosen.resolvedSymbol,
    selected: chosen.selected,
    candidateCount: chosen.candidates.length,
    allCandidateCount: chosen.allCandidateCount,
    rawResultCount: chosen.rawResultCount,
    candidates: chosen.candidates.slice(0, 12),
    polygonShape: safeJsonShape(fetched.json),
    checkedAt: nowIso(),
    cached: false,
  };

  resolveCache.set(cacheKey, {
    cachedAtMs: Date.now(),
    value,
  });

  return value;
}

/* -------------------------------------------------
   Trade -> candle builder
-------------------------------------------------- */

function getTradeSymbol(msg) {
  return String(
    msg?.sym ??
      msg?.symbol ??
      msg?.ticker ??
      msg?.T ??
      msg?.contract ??
      ""
  ).toUpperCase();
}

function getTradePrice(msg) {
  return toNum(msg?.p) ?? toNum(msg?.price);
}

function getTradeSize(msg) {
  return toNum(msg?.s) ?? toNum(msg?.size) ?? toNum(msg?.volume) ?? 0;
}

function getTradeTimestampSec(msg) {
  return (
    toUnixSec(msg?.t) ??
    toUnixSec(msg?.timestamp) ??
    toUnixSec(msg?.sip_timestamp) ??
    toUnixSec(msg?.participant_timestamp) ??
    toUnixSec(Date.now())
  );
}

function parseFuturesAM(msg) {
  const rawSym = getTradeSymbol(msg);

  const sSec = toUnixSec(
    msg?.s ??
      msg?.start_timestamp ??
      msg?.timestamp ??
      msg?.t
  );

  const o = toNum(msg?.o ?? msg?.open);
  const h = toNum(msg?.h ?? msg?.high);
  const l = toNum(msg?.l ?? msg?.low);
  const c = toNum(msg?.c ?? msg?.close);
  const v = toNum(msg?.v ?? msg?.volume) ?? 0;

  if (!Number.isFinite(sSec)) return null;
  if (![o, h, l, c].every(Number.isFinite)) return null;

  const minuteSec = Math.floor(sSec / 60) * 60;

  return {
    symbol: rawSym,
    bar: {
      time: minuteSec,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(v) ? v : 0,
    },
  };
}

function applyTradeTo1m(cur, msg) {
  const price = getTradePrice(msg);
  const size = getTradeSize(msg);
  const tSec = getTradeTimestampSec(msg);

  if (!Number.isFinite(price) || !Number.isFinite(tSec) || tSec <= 0) {
    return cur;
  }

  const minuteSec = Math.floor(tSec / 60) * 60;

  if (!cur || cur.time < minuteSec) {
    return {
      time: minuteSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number.isFinite(size) ? size : 0,
    };
  }

  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

function updateAggFrom1m(lastAgg, bar1m, tfMin, mode) {
  const bucket = bucketStartSecByMode(bar1m.time, tfMin, mode);
  if (bucket === null) return { agg: lastAgg, changed: false };

  if (tfMin === 1) return { agg: bar1m, changed: true };

  if (!lastAgg || lastAgg.time < bucket) {
    return {
      agg: {
        time: bucket,
        open: bar1m.open,
        high: bar1m.high,
        low: bar1m.low,
        close: bar1m.close,
        volume: Number(bar1m.volume || 0),
      },
      changed: true,
    };
  }

  if (lastAgg.time === bucket) {
    const upd = { ...lastAgg };
    upd.high = Math.max(upd.high, bar1m.high);
    upd.low = Math.min(upd.low, bar1m.low);
    upd.close = bar1m.close;
    upd.volume = Number(upd.volume || 0) + Number(bar1m.volume || 0);

    return { agg: upd, changed: true };
  }

  return { agg: lastAgg, changed: false };
}

/* -------------------------------------------------
   Routes
-------------------------------------------------- */

router.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "futures-stream",
    phase: "resolver-and-live-sse",
    ts: nowIso(),
  });
});

router.get("/resolve", async (req, res) => {
  try {
    const productCode = cleanProductCode(
      req.query.product_code || req.query.productCode || req.query.symbol || "ES"
    );

    const result = await resolveFuturesContract(productCode);

    if (!result.ok && result.error === "missing_polygon_api_key") {
      return res.status(500).json(result);
    }

    return res.json(result);
  } catch (err) {
    console.error("[futures.resolve] error:", err?.stack || err);

    return res.status(500).json({
      ok: false,
      error: "futures_resolve_exception",
      detail: String(err?.message || err),
      checkedAt: nowIso(),
    });
  }
});

router.get("/agg", async (req, res) => {
  const apiKey = resolvePolygonKey();

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "missing_polygon_api_key",
      ts: nowIso(),
    });
  }

  const symbol = cleanProductCode(req.query.symbol || "ES");
  const tfStr = normalizeTfStr(req.query.tf || "1m");
  const tfMin = normalizeTfMin(tfStr);
  const tf = labelTf(tfMin);

  // Futures default should be ETH/full electronic session.
  // You can still request mode=rth for stock-market-hours-only filtering.
  const mode = normalizeMode(req.query.mode || "eth");

  const resolved = await resolveFuturesContract(symbol);

  if (!resolved.ok || !resolved.resolvedSymbol) {
    return res.status(500).json({
      ok: false,
      error: "could_not_resolve_futures_contract",
      symbol,
      resolver: resolved,
      ts: nowIso(),
    });
  }

  const resolvedSymbol = String(resolved.resolvedSymbol).toUpperCase();

  sseHeaders(res);

  let alive = true;

  sseSend(res, {
    ok: true,
    type: "snapshot",
    symbol,
    resolvedSymbol,
    tf,
    mode,
    bars: [],
    resolver: {
      productCode: resolved.productCode,
      resolvedSymbol: resolved.resolvedSymbol,
      selected: resolved.selected,
      selectionRule: resolved.selectionRule,
      cached: resolved.cached || false,
    },
    note: "Phase 2 futures stream: live bars only. Historical ES candles will be added in Backend-1 Phase 3.",
    updated_at_utc: nowIso(),
  });

  const ping = setInterval(() => {
    if (alive) res.write(`:ping ${Date.now()}\n\n`);
  }, 15000);

  const diag = {
    startedAt: nowIso(),
    symbol,
    resolvedSymbol,
    tf,
    tfMin,
    mode,
    wsUrl: POLY_FUTURES_WS_URL,
    wsOpen: 0,
    wsClose: 0,
    wsError: 0,
    status: [],
    messagesSeen: 0,
    amSeen: 0,
    tradesSeen: 0,
    matchedTrades: 0,
    unmatchedTrades: 0,
    barsEmitted: 0,
    lastEventType: null,
    lastRawKeys: [],
    lastRawSymbol: null,
    lastPrice: null,
    lastTradeAt: null,
  };

  const diagTimer = setInterval(() => {
    if (!alive) return;
    sseSend(res, { ok: true, type: "diag", diag });
  }, 5000);

  let lastEmitAt = 0;

  function emitBar(bar) {
    const now = Date.now();

    // Do not spam browser with every tick.
    if (now - lastEmitAt < 250) return;

    lastEmitAt = now;
    diag.barsEmitted += 1;

    sseSend(res, {
      ok: true,
      type: "bar",
      symbol,
      resolvedSymbol,
      tf,
      mode,
      bar,
    });
  }

  const ws = new WebSocket(POLY_FUTURES_WS_URL);
  let trade1m = null;
  let aggBar = null;

  ws.on("open", () => {
    diag.wsOpen += 1;

    ws.send(
      JSON.stringify({
        action: "auth",
        params: apiKey,
      })
    );

    ws.send(
      JSON.stringify({
        action: "subscribe",
        params: `AM.${resolvedSymbol},T.${resolvedSymbol}`,
      })
    ); 

    sseSend(res, {
      ok: true,
      type: "diag",
      diag: {
        ...diag,
        subscribed: `AM.${resolvedSymbol},T.${resolvedSymbol}`,
      },
    });
  });

  ws.on("message", (buf) => {
    let arr;

    try {
      arr = JSON.parse(buf.toString("utf8"));
    } catch {
      return;
    }

    if (!Array.isArray(arr)) arr = [arr];

    for (const msg of arr) {
      diag.messagesSeen += 1;
      diag.lastEventType = msg?.ev || msg?.event || null;
      diag.lastRawKeys = Object.keys(msg || {}).slice(0, 30);

      const ev = msg?.ev || msg?.event;

      if (ev === "status") {
        const line = `${msg?.status || ""} ${msg?.message || ""}`.trim();
        diag.status.push(line);
        if (diag.status.length > 12) diag.status.shift();
        continue;
      }

    // Expected futures events from Polygon:
    // AM.ESM6 = official 1-minute candle
    // T.ESM6  = live trade fallback

    if (ev === "AM") {
      diag.amSeen += 1;

      const parsed = parseFuturesAM(msg);
      if (!parsed?.bar) continue;

      const rawSym = String(parsed.symbol || "").toUpperCase();
      diag.lastRawSymbol = rawSym;

      if (rawSym && rawSym !== resolvedSymbol) {
        diag.unmatchedTrades += 1;
        continue;
      }

      const { agg, changed } = updateAggFrom1m(
        aggBar,
        parsed.bar,
        tfMin,
        mode
     );

     aggBar = agg;
     trade1m = null;

     if (changed && aggBar) {
       emitBar(aggBar);
     }

     continue;
   }

      if (ev !== "T") continue;

      diag.tradesSeen += 1;

      const rawSym = getTradeSymbol(msg);
      diag.lastRawSymbol = rawSym;

      if (rawSym && rawSym !== resolvedSymbol) {
        diag.unmatchedTrades += 1;
        continue;
      }

      const price = getTradePrice(msg);
      diag.lastPrice = price;
      diag.lastTradeAt = nowIso();
      diag.matchedTrades += 1;

      trade1m = applyTradeTo1m(trade1m, msg);
      if (!trade1m) continue;

      const { agg, changed } = updateAggFrom1m(
        aggBar,
        trade1m,
        tfMin,
        mode
      );

      aggBar = agg;

      if (changed && aggBar) {
        emitBar(aggBar);
      }
    }
  });

  ws.on("error", (err) => {
    diag.wsError += 1;
    diag.status.push(`ws_error ${String(err?.message || err)}`);
    if (diag.status.length > 12) diag.status.shift();
  });

  ws.on("close", (code, reason) => {
    diag.wsClose += 1;
    diag.status.push(`ws_close ${code} ${String(reason || "")}`.trim());
    if (diag.status.length > 12) diag.status.shift();
  });

  req.on("close", () => {
    alive = false;
    clearInterval(ping);
    clearInterval(diagTimer);

    try {
      ws.close();
    } catch {}

    try {
      res.end();
    } catch {}
  });
});
