// services/core/jobs/updateEngine25IntradayMacro.js
// Engine 25 Intraday Macro v0.1
//
// Phase 2/3 implementation:
// - Resolve nearby CL / BZ / ZN / ZB outright futures without modifying the shared provider.
// - Prefer the highest-volume nearby eligible contract.
// - Fetch 5m and 10m bars through the existing shared futures provider.
// - This file does NOT yet write the canonical intradayMacro output.
//   Phase 4+ will add TLT, FRED slow context, temporary events, and final JSON generation.
//
// Scope lock:
// - No trade direction.
// - No Engine 6 permission.
// - No Engine 3/4/22/26 changes.

import {
  FUTURES_TF_MAP,
  FUTURES_DAYS_BY_TF,
  fetchFuturesAggs,
} from "../providers/futuresOhlcProvider.js";

const POLY_KEY =
  process.env.POLYGON_API ||
  process.env.POLYGON_API_KEY ||
  process.env.POLY_API_KEY ||
  "";

const POLYGON_REST_BASE =
  process.env.POLYGON_REST_BASE ||
  process.env.POLYGON_BASE_URL ||
  "https://api.polygon.io";

const MONTH_CODES = Object.freeze([
  "F", // Jan
  "G", // Feb
  "H", // Mar
  "J", // Apr
  "K", // May
  "M", // Jun
  "N", // Jul
  "Q", // Aug
  "U", // Sep
  "V", // Oct
  "X", // Nov
  "Z", // Dec
]);

const QUARTER_CODES = Object.freeze(["H", "M", "U", "Z"]);

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
  const currentMonth = now.getUTCMonth(); // 0-11
  const currentYear = now.getUTCFullYear();

  const quarterlyMonths = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec
  const out = [];

  let year = currentYear;
  while (out.length < count) {
    for (const month of quarterlyMonths) {
      if (
        year > currentYear ||
        month >= currentMonth
      ) {
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
      error: null,
      notFound: true,
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

  // Important:
  // Candidates have already been restricted to a small nearby horizon.
  // Within that horizon, use actual session volume to follow rollover.
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
    throw new Error(`Engine 25 v0.1 only accepts 5m/10m fast bars. Received: ${tf}`);
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

async function phase23Audit() {
  const products = ["CL", "BZ", "ZN", "ZB"];
  const output = {
    ok: true,
    phase: "ENGINE25_INTRADAY_MACRO_PHASE_2_3_AUDIT",
    generatedAtUtc: nowIso(),
    products: {},
    errors: [],
  };

  for (const productCode of products) {
    try {
      const resolver = await resolveEngine25FuturesContract(productCode);

      const fiveMinute = await fetchEngine25FuturesBars({
        productCode,
        timeframe: "5m",
        limit: 12,
      });

      const tenMinute = await fetchEngine25FuturesBars({
        productCode,
        timeframe: "10m",
        limit: 12,
      });

      output.products[productCode] = {
        resolver: {
          productCode: resolver.productCode,
          resolvedSymbol: resolver.resolvedSymbol,
          selectionRule: resolver.selectionRule,
          candidateCount: resolver.candidateCount,
          candidates: resolver.candidates.map((x) => ({
            ticker: x.ticker,
            settlementDate: x.settlementDate,
            volume: x.volume,
            close: x.close,
          })),
        },
        fiveMinute: {
          ok: fiveMinute.ok,
          timeframe: fiveMinute.timeframe,
          count: fiveMinute.count,
          lastBar: fiveMinute.lastBar,
        },
        tenMinute: {
          ok: tenMinute.ok,
          timeframe: tenMinute.timeframe,
          count: tenMinute.count,
          lastBar: tenMinute.lastBar,
        },
      };
    } catch (error) {
      output.ok = false;
      output.errors.push({
        productCode,
        message: error?.message || String(error),
      });
    }
  }

  console.log(JSON.stringify(output, null, 2));

  if (!output.ok) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  phase23Audit().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          phase: "ENGINE25_INTRADAY_MACRO_PHASE_2_3_AUDIT",
          error: error?.message || String(error),
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  });
}
