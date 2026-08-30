// services/core/jobs/updateEngine25IntradayMacro.js
// Engine 25 Intraday Macro v0.2 — canonical Finlight event handoff
//
// Approved Phase 2-4 implementation:
// - Resolve nearby CL / BZ / ZN / ZB outright futures.
// - Prefer highest-volume nearby eligible contract.
// - Fetch 5m / 10m futures bars.
// - Fetch TLT 5m / 10m bars.
// - Fetch slow FRED DGS10 / DGS30 context.
// - Build and atomically write data/engine25-intraday-macro.json.
//
// Not yet implemented in this phase:
// - temporary/manual event adapter
// - event lifecycle persistence
// - route/context/full-dashboard exposure
//
// Scope lock:
// - No LONG/SHORT.
// - No Engine 6 permission.
// - No Engine 3/4/22/26 changes.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  FUTURES_TF_MAP,
  FUTURES_DAYS_BY_TF,
  fetchFuturesAggs,
} from "../providers/futuresOhlcProvider.js";

import { fetchFredSeries } from "../logic/engine25DataSources.js";

import {
  buildIntradayMacro,
  buildRollingChanges,
  pctChange,
} from "../logic/engine25IntradayMacro.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-intraday-macro.json");
const TEMP_EVENTS_FILE = path.join(DATA_DIR, "engine25-temporary-events.json");
const NEWS_EVENTS_FILE = path.join(DATA_DIR, "engine25-news-events.json");

const POLY_KEY =
  process.env.POLYGON_API ||
  process.env.POLYGON_API_KEY ||
  process.env.POLY_API_KEY ||
  "";

const FRED_KEY =
  process.env.FRED_API_KEY ||
  process.env.FRED_API ||
  process.env.FRED_KEY ||
  "";

const POLYGON_REST_BASE =
  process.env.POLYGON_REST_BASE ||
  process.env.POLYGON_BASE_URL ||
  "https://api.polygon.io";

const MONTH_CODES = Object.freeze([
  "F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z",
]);

function nowIso() {
  return new Date().toISOString();
}

function dateOnlyUtc(d) {
  return d.toISOString().slice(0, 10);
}

function shortYear(year) {
  return String(year).slice(-1);
}

function addMonthsUtc(date, months) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      0,
      0,
      0,
      0
    )
  );
}

function buildMonthlyCandidates(productCode, now = new Date(), horizon = 6) {
  const out = [];
  const seen = new Set();

  for (let i = 0; i < horizon; i += 1) {
    const d = addMonthsUtc(now, i);
    const code = MONTH_CODES[d.getUTCMonth()];
    const ticker = `${productCode}${code}${shortYear(d.getUTCFullYear())}`;

    if (!seen.has(ticker)) {
      seen.add(ticker);
      out.push(ticker);
    }
  }

  return out;
}

function quarterMonthIndexesFromNow(now = new Date(), count = 4) {
  const currentMonth = now.getUTCMonth();
  const currentYear = now.getUTCFullYear();
  const quarterlyMonths = [2, 5, 8, 11];
  const out = [];

  let year = currentYear;

  while (out.length < count) {
    for (const month of quarterlyMonths) {
      if (year > currentYear || month >= currentMonth) {
        out.push({ year, month });
        if (out.length >= count) return out;
      }
    }
    year += 1;
  }

  return out;
}

function buildQuarterlyCandidates(productCode, now = new Date(), count = 4) {
  return quarterMonthIndexesFromNow(now, count).map(({ year, month }) => {
    const monthCode = MONTH_CODES[month];
    return `${productCode}${monthCode}${shortYear(year)}`;
  });
}

function candidateTickers(productCode, now = new Date()) {
  if (productCode === "CL" || productCode === "BZ") {
    return buildMonthlyCandidates(productCode, now, 6);
  }

  if (productCode === "ZN" || productCode === "ZB") {
    return buildQuarterlyCandidates(productCode, now, 4);
  }

  throw new Error(`Unsupported Engine 25 futures product: ${productCode}`);
}

async function readJsonResponse(response, label) {
  const text = await response.text();

  if (!text || !text.trim()) {
    throw new Error(`${label} returned empty response`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label} returned non-JSON response. status=${response.status} preview=${text.slice(
        0,
        300
      )}`
    );
  }
}

async function fetchTickerSnapshot(ticker) {
  if (!POLY_KEY) throw new Error("Missing Polygon API key");

  const base = String(POLYGON_REST_BASE || "").replace(/\/+$/, "");
  const url = new URL(`${base}/futures/v1/snapshot`);

  url.searchParams.set("ticker", ticker);
  url.searchParams.set("apiKey", POLY_KEY);

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ticker,
      ok: false,
      httpStatus: response.status,
      error: `Polygon futures snapshot ${response.status} ${text}`,
    };
  }

  const json = await readJsonResponse(response, `Polygon snapshot ${ticker}`);
  const rows = Array.isArray(json?.results) ? json.results : [];

  const row =
    rows.find(
      (item) =>
        String(item?.details?.ticker || "").toUpperCase() === ticker.toUpperCase()
    ) ||
    rows[0] ||
    null;

  if (!row) {
    return {
      ticker,
      ok: false,
      httpStatus: response.status,
      notFound: true,
      error: null,
    };
  }

  const settlementDate = row?.details?.settlement_date || null;
  const settlementMs = settlementDate
    ? Date.parse(`${settlementDate}T23:59:59.999Z`)
    : null;

  const volume = Number(row?.session?.volume ?? 0);
  const close = Number(row?.session?.close);

  return {
    ticker,
    ok: true,
    httpStatus: response.status,
    productCode: String(row?.details?.product_code || "").toUpperCase() || null,
    settlementDate,
    settlementMs: Number.isFinite(settlementMs) ? settlementMs : null,
    volume: Number.isFinite(volume) ? volume : 0,
    close: Number.isFinite(close) ? close : null,
  };
}

function selectNearbyContract(productCode, snapshots, now = new Date()) {
  const nowMs = now.getTime();

  const valid = snapshots
    .filter((row) => row?.ok === true)
    .filter((row) => row?.productCode === productCode)
    .filter((row) => {
      if (!Number.isFinite(row?.settlementMs)) return true;
      return row.settlementMs >= nowMs;
    });

  if (!valid.length) {
    throw new Error(
      `Could not resolve nearby outright futures contract for ${productCode}`
    );
  }

  const sorted = [...valid].sort((a, b) => {
    const volumeDiff = Number(b.volume || 0) - Number(a.volume || 0);
    if (volumeDiff !== 0) return volumeDiff;

    const aSettle = Number(a.settlementMs || Number.MAX_SAFE_INTEGER);
    const bSettle = Number(b.settlementMs || Number.MAX_SAFE_INTEGER);
    return aSettle - bSettle;
  });

  return {
    productCode,
    resolvedSymbol: sorted[0].ticker,
    selected: sorted[0],
    candidates: valid,
    candidateCount: valid.length,
    selectionRule: "nearby_eligible_outrights_highest_session_volume",
    checkedAt: nowIso(),
  };
}

export async function resolveEngine25FuturesContract(
  productCodeInput,
  now = new Date()
) {
  const productCode = String(productCodeInput || "").trim().toUpperCase();
  const tickers = candidateTickers(productCode, now);

  const snapshots = [];

  for (const ticker of tickers) {
    snapshots.push(await fetchTickerSnapshot(ticker));
  }

  return selectNearbyContract(productCode, snapshots, now);
}

function lookbackDates(timeframe, now = new Date()) {
  const days = FUTURES_DAYS_BY_TF[timeframe] ?? 14;
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    startDate: dateOnlyUtc(start),
    endDate: dateOnlyUtc(end),
  };
}

export async function fetchEngine25FuturesBars({
  productCode,
  timeframe,
  now = new Date(),
  limit = 1000,
}) {
  const tf = String(timeframe || "").toLowerCase();

  if (!["5m", "10m"].includes(tf)) {
    throw new Error(
      `Engine 25 v0.1 only accepts 5m/10m fast bars. Received: ${tf}`
    );
  }

  const resolution = FUTURES_TF_MAP[tf];
  const resolver = await resolveEngine25FuturesContract(productCode, now);
  const { startDate, endDate } = lookbackDates(tf, now);

  const bars = await fetchFuturesAggs({
    resolvedSymbol: resolver.resolvedSymbol,
    resolution,
    startDate,
    endDate,
    limit,
  });

  return {
    ok: true,
    productCode,
    resolvedSymbol: resolver.resolvedSymbol,
    sourceType:
      productCode === "ZN" || productCode === "ZB"
        ? "FUTURES_PROXY"
        : "DIRECT_FUTURES",
    timeframe: tf,
    resolution,
    resolver,
    count: bars.length,
    firstBar: bars[0] || null,
    lastBar: bars[bars.length - 1] || null,
    bars,
  };
}

async function fetchPolygonEtfBars({
  symbol,
  multiplier,
  now = new Date(),
  lookbackDays = 7,
  limit = 5000,
}) {
  if (!POLY_KEY) throw new Error("Missing Polygon API key");

  const from = dateOnlyUtc(
    new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
  );
  const to = dateOnlyUtc(now);

  const base = String(POLYGON_REST_BASE || "").replace(/\/+$/, "");
  const url = new URL(
    `${base}/v2/aggs/ticker/${encodeURIComponent(
      symbol
    )}/range/${multiplier}/minute/${from}/${to}`
  );

  url.searchParams.set("adjusted", "true");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("apiKey", POLY_KEY);

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Polygon ${symbol} aggregates ${response.status} ${text}`);
  }

  const json = await readJsonResponse(response, `Polygon ${symbol} aggregates`);
  const rows = Array.isArray(json?.results) ? json.results : [];

  const bars = rows
    .map((bar) => ({
      time: Number.isFinite(Number(bar?.t))
        ? Math.floor(Number(bar.t) / 1000)
        : null,
      open: Number(bar?.o),
      high: Number(bar?.h),
      low: Number(bar?.l),
      close: Number(bar?.c),
      volume: Number(bar?.v ?? 0),
    }))
    .filter((bar) =>
      [bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
    )
    .sort((a, b) => a.time - b.time);

  return {
    ok: true,
    symbol,
    timeframe: `${multiplier}m`,
    count: bars.length,
    firstBar: bars[0] || null,
    lastBar: bars[bars.length - 1] || null,
    bars,
  };
}

function buildCombinedRollingRead({
  fiveMinuteBars = [],
  tenMinuteBars = [],
  productCode = null,
  resolvedContract = null,
  sourceType = null,
  symbol = null,
  sessionStartSec = null,
}) {
  const five = buildRollingChanges(fiveMinuteBars, null, sessionStartSec);
  const ten = buildRollingChanges(tenMinuteBars, null, sessionStartSec);

  return {
    ...(productCode ? { productCode } : {}),
    ...(resolvedContract ? { resolvedContract } : {}),
    ...(symbol ? { symbol } : {}),
    ...(sourceType ? { sourceType } : {}),
    sessionStartUnix: Number.isFinite(Number(sessionStartSec))
      ? Number(sessionStartSec)
      : null,
    sessionStartUtc: Number.isFinite(Number(sessionStartSec))
      ? new Date(Number(sessionStartSec) * 1000).toISOString()
      : null,
    price: five.price ?? ten.price ?? null,
    asOfUnix: five.asOfUnix ?? ten.asOfUnix ?? null,
    asOfUtc: five.asOfUtc ?? ten.asOfUtc ?? null,
    changesPct: {
      "5m": five.changesPct?.["5m"] ?? null,
      "10m": ten.changesPct?.["10m"] ?? five.changesPct?.["10m"] ?? null,
      "30m": five.changesPct?.["30m"] ?? ten.changesPct?.["30m"] ?? null,
      "60m": five.changesPct?.["60m"] ?? ten.changesPct?.["60m"] ?? null,
      session: five.changesPct?.session ?? null,
    },
  };
}

function latestObservation(seriesResult) {
  const latest = seriesResult?.latest || null;

  return {
    value:
      latest && Number.isFinite(Number(latest.value))
        ? Number(latest.value)
        : null,
    date: latest?.date || null,
  };
}

async function fetchSlowYieldContext() {
  const warnings = [];

  if (!FRED_KEY) {
    return {
      slowContext: {
        tenYearYield: null,
        tenYearObservationDate: null,
        thirtyYearYield: null,
        thirtyYearObservationDate: null,
      },
      warnings: ["FRED_SLOW_CONTEXT_UNAVAILABLE_MISSING_API_KEY"],
    };
  }

  const observationStart = new Date(
    Date.now() - 45 * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);

  let dgs10 = null;
  let dgs30 = null;

  try {
    dgs10 = await fetchFredSeries({
      seriesId: "DGS10",
      apiKey: FRED_KEY,
      observationStart,
      limit: 100,
    });
  } catch (error) {
    warnings.push(`DGS10_FETCH_FAILED:${error?.message || String(error)}`);
  }

  try {
    dgs30 = await fetchFredSeries({
      seriesId: "DGS30",
      apiKey: FRED_KEY,
      observationStart,
      limit: 100,
    });
  } catch (error) {
    warnings.push(`DGS30_FETCH_FAILED:${error?.message || String(error)}`);
  }

  const ten = latestObservation(dgs10);
  const thirty = latestObservation(dgs30);

  return {
    slowContext: {
      tenYearYield: ten.value,
      tenYearObservationDate: ten.date,
      thirtyYearYield: thirty.value,
      thirtyYearObservationDate: thirty.date,
    },
    warnings,
  };
}

function maxIso(values = []) {
  const valid = values
    .map((x) => (x ? Date.parse(x) : NaN))
    .filter(Number.isFinite);

  if (!valid.length) return null;

  return new Date(Math.max(...valid)).toISOString();
}

const ENGINE25_MARKET_TIME_ZONE = "America/New_York";

function zonedDateParts(date, timeZone = ENGINE25_MARKET_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function addCalendarDays({ year, month, day }, deltaDays) {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function timeZoneOffsetMs(date, timeZone = ENGINE25_MARKET_TIME_ZONE) {
  const parts = zonedDateParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function zonedDateTimeToUnixSec({ year, month, day, hour, minute = 0, second = 0 }, timeZone = ENGINE25_MARKET_TIME_ZONE) {
  const wallClockUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let guessMs = wallClockUtcMs;

  // Two passes are enough to resolve normal DST offsets for the target date.
  for (let i = 0; i < 2; i += 1) {
    const offsetMs = timeZoneOffsetMs(new Date(guessMs), timeZone);
    guessMs = wallClockUtcMs - offsetMs;
  }

  return Math.floor(guessMs / 1000);
}

function sessionStartUnixSec({ now = new Date(), hour, minute = 0 }) {
  const local = zonedDateParts(now, ENGINE25_MARKET_TIME_ZONE);
  const localMinutes = local.hour * 60 + local.minute;
  const startMinutes = hour * 60 + minute;

  const baseDate =
    localMinutes >= startMinutes
      ? { year: local.year, month: local.month, day: local.day }
      : addCalendarDays(
          { year: local.year, month: local.month, day: local.day },
          -1
        );

  return zonedDateTimeToUnixSec(
    { ...baseDate, hour, minute, second: 0 },
    ENGINE25_MARKET_TIME_ZONE
  );
}

function futuresSessionStartUnixSec(now = new Date()) {
  // CL/BZ/ZN/ZB Globex session begins at 18:00 New York time on the
  // prior calendar day for the daytime trading session.
  return sessionStartUnixSec({ now, hour: 18, minute: 0 });
}

function tltCashSessionStartUnixSec(now = new Date()) {
  // TLT cash-session reference begins at 09:30 New York time.
  return sessionStartUnixSec({ now, hour: 9, minute: 30 });
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function readTemporaryEvents() {
  if (!fs.existsSync(TEMP_EVENTS_FILE)) {
    return {
      ok: false,
      updatedAtUtc: null,
      events: [],
      warnings: ["TEMPORARY_EVENTS_FILE_MISSING"],
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(TEMP_EVENTS_FILE, "utf8"));
    const events = Array.isArray(raw?.events) ? raw.events : [];
    const updatedAtUtc =
      raw?.updatedAtUtc && Number.isFinite(Date.parse(raw.updatedAtUtc))
        ? new Date(Date.parse(raw.updatedAtUtc)).toISOString()
        : null;

    return {
      ok: true,
      updatedAtUtc,
      events,
      warnings: [],
    };
  } catch (error) {
    return {
      ok: false,
      updatedAtUtc: null,
      events: [],
      warnings: [
        `TEMPORARY_EVENTS_FILE_INVALID:${error?.message || String(error)}`,
      ],
    };
  }
}


function readEngine25NewsEvents() {
  if (!fs.existsSync(NEWS_EVENTS_FILE)) {
    return {
      ok: false,
      generatedAtUtc: null,
      events: [],
      warnings: ["ENGINE25_NEWS_EVENTS_FILE_MISSING"],
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(NEWS_EVENTS_FILE, "utf8"));
    const generatedAtUtc =
      raw?.generatedAtUtc && Number.isFinite(Date.parse(raw.generatedAtUtc))
        ? new Date(Date.parse(raw.generatedAtUtc)).toISOString()
        : null;

    if (raw?.ok !== true) {
      return {
        ok: false,
        generatedAtUtc,
        events: [],
        warnings: Array.isArray(raw?.warnings) && raw.warnings.length
          ? raw.warnings
          : ["FINLIGHT_NEWS_UNAVAILABLE"],
      };
    }

    return {
      ok: true,
      generatedAtUtc,
      events: Array.isArray(raw?.events) ? raw.events : [],
      warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
    };
  } catch (error) {
    return {
      ok: false,
      generatedAtUtc: null,
      events: [],
      warnings: [
        `ENGINE25_NEWS_EVENTS_FILE_INVALID:${error?.message || String(error)}`,
      ],
    };
  }
}

export function adaptEngine25NewsEventsForIntradayMacro(events = []) {
  const out = [];

  const geopoliticalTypes = new Set([
    "GEOPOLITICAL_OIL_SUPPLY_RISK",
    "GEOPOLITICAL_ESCALATION",
    "ENERGY_SUPPLY_EVENT",
  ]);

  const treasuryPolicyTypes = new Set([
    "TREASURY_RATES_RISK",
    "FED_POLICY_EVENT",
    "FINANCIAL_STRESS_EVENT",
  ]);

  const passthroughTypes = new Set([
    ...geopoliticalTypes,
    ...treasuryPolicyTypes,
    "MACRO_DATA_RELEASE",
    "TRADE_POLICY_RISK",
  ]);

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;

    const eventType = String(event?.eventType || "").trim().toUpperCase();
    if (!passthroughTypes.has(eventType)) continue;

    let integrationFamily = "GENERAL_MACRO";

    if (geopoliticalTypes.has(eventType)) {
      integrationFamily = "OIL_GEOPOLITICAL";
    } else if (treasuryPolicyTypes.has(eventType)) {
      integrationFamily = "TREASURY_LIQUIDITY";
    }

    out.push({
      ...event,
      normalizedEventType: eventType,
      eventType,
      integrationFamily,
    });
  }

  return out;
}

async function collectFuturesProduct(productCode, now) {
  const resolver = await resolveEngine25FuturesContract(productCode, now);

  const fiveMinute = await fetchEngine25FuturesBars({
    productCode,
    timeframe: "5m",
    now,
    limit: 1000,
  });

  const tenMinute = await fetchEngine25FuturesBars({
    productCode,
    timeframe: "10m",
    now,
    limit: 1000,
  });

  const read = buildCombinedRollingRead({
    fiveMinuteBars: fiveMinute.bars,
    tenMinuteBars: tenMinute.bars,
    productCode,
    resolvedContract: resolver.resolvedSymbol,
    sourceType:
      productCode === "ZN" || productCode === "ZB"
        ? "FUTURES_PROXY"
        : "DIRECT_FUTURES",
    sessionStartSec: futuresSessionStartUnixSec(now),
  });

  return {
    resolver,
    fiveMinute,
    tenMinute,
    read,
  };
}

export async function buildAndWriteEngine25IntradayMacro({
  now = new Date(),
} = {}) {
  const generatedAtUtc = now.toISOString();
  const warnings = [];
  const providerDiagnostics = {};

  const products = {};

  for (const productCode of ["CL", "BZ", "ZN", "ZB"]) {
    try {
      products[productCode] = await collectFuturesProduct(productCode, now);

      providerDiagnostics[productCode] = {
        ok: true,
        resolvedContract: products[productCode].resolver.resolvedSymbol,
        selectionRule: products[productCode].resolver.selectionRule,
        candidates: products[productCode].resolver.candidates.map((x) => ({
          ticker: x.ticker,
          settlementDate: x.settlementDate,
          volume: x.volume,
          close: x.close,
        })),
        fiveMinuteCount: products[productCode].fiveMinute.count,
        tenMinuteCount: products[productCode].tenMinute.count,
      };
    } catch (error) {
      warnings.push(
        `${productCode}_UNAVAILABLE:${error?.message || String(error)}`
      );

      providerDiagnostics[productCode] = {
        ok: false,
        error: error?.message || String(error),
      };

      products[productCode] = {
        read: {
          productCode,
          resolvedContract: null,
          sourceType:
            productCode === "ZN" || productCode === "ZB"
              ? "FUTURES_PROXY"
              : "DIRECT_FUTURES",
          price: null,
          asOfUnix: null,
          asOfUtc: null,
          changesPct: {
            "5m": null,
            "10m": null,
            "30m": null,
            "60m": null,
            session: null,
          },
        },
      };
    }
  }

  let tltFive = null;
  let tltTen = null;
  let tltRead = null;

  try {
    tltFive = await fetchPolygonEtfBars({
      symbol: "TLT",
      multiplier: 5,
      now,
      lookbackDays: 7,
    });

    tltTen = await fetchPolygonEtfBars({
      symbol: "TLT",
      multiplier: 10,
      now,
      lookbackDays: 7,
    });

    tltRead = buildCombinedRollingRead({
      fiveMinuteBars: tltFive.bars,
      tenMinuteBars: tltTen.bars,
      symbol: "TLT",
      sourceType: "ETF_PROXY",
      sessionStartSec: tltCashSessionStartUnixSec(now),
    });

    // Canonical contract uses cashSession for TLT rather than generic session.
    tltRead.changesPct.cashSession = tltRead.changesPct.session;
    delete tltRead.changesPct.session;

    providerDiagnostics.TLT = {
      ok: true,
      fiveMinuteCount: tltFive.count,
      tenMinuteCount: tltTen.count,
      lastFiveMinuteBar: tltFive.lastBar,
      lastTenMinuteBar: tltTen.lastBar,
    };
  } catch (error) {
    warnings.push(`TLT_UNAVAILABLE:${error?.message || String(error)}`);

    tltRead = {
      symbol: "TLT",
      sourceType: "ETF_PROXY",
      price: null,
      asOfUnix: null,
      asOfUtc: null,
      changesPct: {
        "5m": null,
        "10m": null,
        "30m": null,
        "60m": null,
        cashSession: null,
      },
    };

    providerDiagnostics.TLT = {
      ok: false,
      error: error?.message || String(error),
    };
  }

  const { slowContext, warnings: fredWarnings } =
    await fetchSlowYieldContext();

  warnings.push(...fredWarnings);

  const temporaryEventInput = readTemporaryEvents();
  warnings.push(...temporaryEventInput.warnings);

  const newsEventInput = readEngine25NewsEvents();
  warnings.push(...newsEventInput.warnings);

  const newsConfirmationFamilyEvents = adaptEngine25NewsEventsForIntradayMacro(
    newsEventInput.events
  );

  providerDiagnostics.TEMPORARY_EVENTS = {
    ok: temporaryEventInput.ok,
    updatedAtUtc: temporaryEventInput.updatedAtUtc,
    eventCount: temporaryEventInput.events.length,
  };

  providerDiagnostics.FINLIGHT_NEWS = {
    ok: newsEventInput.ok,
    generatedAtUtc: newsEventInput.generatedAtUtc,
    eventCount: newsEventInput.events.length,
    confirmationFamilyEventCount: newsConfirmationFamilyEvents.length,
    warnings: newsEventInput.warnings,
  };

  providerDiagnostics.FRED = {
    ok:
      slowContext.tenYearYield !== null ||
      slowContext.thirtyYearYield !== null,
    DGS10: {
      value: slowContext.tenYearYield,
      observationDate: slowContext.tenYearObservationDate,
    },
    DGS30: {
      value: slowContext.thirtyYearYield,
      observationDate: slowContext.thirtyYearObservationDate,
    },
  };

  const marketDataAsOfUtc = maxIso([
    products.CL.read.asOfUtc,
    products.BZ.read.asOfUtc,
    products.ZN.read.asOfUtc,
    products.ZB.read.asOfUtc,
    tltRead.asOfUtc,
  ]);

  const canonical = buildIntradayMacro({
    generatedAtUtc,
    slowContext,
    tenYearProxy: products.ZN.read,
    thirtyYearProxy: products.ZB.read,
    tlt: tltRead,
    wti: products.CL.read,
    brent: {
      ...products.BZ.read,
      instrumentLabel: "Brent Crude Oil Last Day Financial Futures",
    },
    temporaryEvents: [
      ...temporaryEventInput.events,
      ...newsConfirmationFamilyEvents,
    ],
    freshness: {
      status: marketDataAsOfUtc ? "FRESH" : "DEGRADED",
      marketDataAsOfUtc,
      eventDataAsOfUtc: maxIso([
        temporaryEventInput.updatedAtUtc,
        newsEventInput.generatedAtUtc,
      ]),
      warnings: [
        ...temporaryEventInput.warnings,
        ...newsEventInput.warnings,
      ],
    },
    warnings,
    // Phase 7 persistence has not been proven yet.
    persistenceAvailable: false,
  });

  canonical.providerDiagnostics = providerDiagnostics;
  canonical.newsEvents = {
    source: "FINLIGHT_REUTERS_FEED",
    ok: newsEventInput.ok,
    generatedAtUtc: newsEventInput.generatedAtUtc,
    activeMaterialEvents: newsEventInput.events.filter((event) => {
      const expiresMs = Date.parse(event?.expiresAt || "");
      return (
        event?.material === true &&
        Number.isFinite(expiresMs) &&
        now.getTime() < expiresMs
      );
    }),
    confirmationFamilies: {
      oilGeopolitical: newsConfirmationFamilyEvents.filter(
        (event) => event.integrationFamily === "OIL_GEOPOLITICAL"
      ).length,
      treasuryLiquidity: newsConfirmationFamilyEvents.filter(
        (event) => event.integrationFamily === "TREASURY_LIQUIDITY"
      ).length,
    },
    warnings: newsEventInput.warnings,
  };
  canonical.phase = "ENGINE25_INTRADAY_MACRO_PHASE_5";
  canonical.note =
    "Phase 5 canonical output: futures + TLT + FRED slow context + temporary-event adapter + canonical Finlight news handoff. Finlight event types are preserved unchanged; news identifies events and existing CL/BZ/ZN/ZB/TLT logic remains market-confirmation authority.";


  atomicWriteJson(OUTPUT_FILE, canonical);

  return canonical;
}

async function main() {
  const output = await buildAndWriteEngine25IntradayMacro();

  console.log("========================================");
  console.log("Engine 25 Intraday Macro Phase 5 Complete");
  console.log("OK:", output.ok);
  console.log("State:", output.state);
  console.log("Equity Impact:", output.equityImpact);
  console.log("Severity:", output.severity);
  console.log("Macro Shock:", output.macroShock);
  console.log("Wrote:", OUTPUT_FILE);
  console.log("========================================");

  console.log(
    JSON.stringify(
      {
        ok: output.ok,
        engine: output.engine,
        generatedAtUtc: output.generatedAtUtc,
        state: output.state,
        equityImpact: output.equityImpact,
        severity: output.severity,
        macroShock: output.macroShock,
        freshness: output.freshness,
        components: output.components,
        marketConfirmation: output.marketConfirmation,
        reasonCodes: output.reasonCodes,
        warnings: output.warnings,
        providerDiagnostics: output.providerDiagnostics,
      },
      null,
      2
    )
  );
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          engine: "engine25.intradayMacro.v0.2",
          phase: "ENGINE25_INTRADAY_MACRO_PHASE_5",
          error: error?.message || String(error),
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  });
}
