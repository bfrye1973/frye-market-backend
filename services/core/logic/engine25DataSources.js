// services/core/logic/engine25DataSources.js

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

const FISCALDATA_OPERATING_CASH_BALANCE_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";

export const ENGINE25_FRED_SERIES = [
  { id: "UNRATE", label: "Unemployment Rate", component: "laborMarketHealth" },
  { id: "ICSA", label: "Initial Jobless Claims", component: "laborMarketHealth" },
  { id: "CCSA", label: "Continuing Jobless Claims", component: "laborMarketHealth" },
  { id: "PAYEMS", label: "Nonfarm Payrolls", component: "laborMarketHealth" },

  {
    id: "NFCI",
    label: "Chicago Fed National Financial Conditions Index",
    component: "financialStressCredit",
  },
  {
    id: "STLFSI4",
    label: "St. Louis Fed Financial Stress Index",
    component: "financialStressCredit",
  },
  {
    id: "BAMLH0A0HYM2",
    label: "High Yield Credit Spread",
    component: "financialStressCredit",
  },

  { id: "DGS10", label: "10-Year Treasury Rate", component: "fedBondMarket" },
  { id: "DGS2", label: "2-Year Treasury Rate", component: "fedBondMarket" },
  { id: "T10Y2Y", label: "10Y minus 2Y Yield Spread", component: "fedBondMarket" },
  { id: "T10Y3M", label: "10Y minus 3M Yield Spread", component: "fedBondMarket" },

  { id: "WALCL", label: "Fed Balance Sheet", component: "liquidityConditions" },
  { id: "RRPONTSYD", label: "Reverse Repo", component: "liquidityConditions" },
  { id: "WRESBAL", label: "Bank Reserves", component: "liquidityConditions" },
  { id: "M2SL", label: "M2 Money Supply", component: "liquidityConditions" },

  { id: "CPIAUCSL", label: "Consumer Price Index", component: "inflation" },
  { id: "PPIACO", label: "Producer Price Index", component: "inflation" },
];

export const ENGINE25_POLYGON_SYMBOLS = [
  // Market trend
  { symbol: "SPY", label: "S&P 500 ETF", component: "marketTrend" },
  { symbol: "QQQ", label: "Nasdaq 100 ETF", component: "marketTrend" },
  { symbol: "IWM", label: "Russell 2000 ETF", component: "marketTrend" },
  { symbol: "DIA", label: "Dow Jones ETF", component: "marketTrend" },

  // Volatility / macro proxies
  { symbol: "UVXY", label: "Leveraged VIX Futures ETF", component: "volatility" },
  { symbol: "TLT", label: "20+ Year Treasury Bond ETF", component: "bonds" },
  { symbol: "UUP", label: "U.S. Dollar ETF", component: "commoditiesDollar" },
  { symbol: "GLD", label: "Gold ETF", component: "commoditiesDollar" },
  { symbol: "USO", label: "Oil ETF", component: "commoditiesDollar" },

  // Sector rotation
  { symbol: "XLK", label: "Technology Sector ETF", component: "sectorRotation" },
  { symbol: "XLY", label: "Consumer Discretionary Sector ETF", component: "sectorRotation" },
  { symbol: "XLF", label: "Financials Sector ETF", component: "sectorRotation" },
  { symbol: "XLI", label: "Industrials Sector ETF", component: "sectorRotation" },
  { symbol: "XLE", label: "Energy Sector ETF", component: "sectorRotation" },
  { symbol: "XLV", label: "Healthcare Sector ETF", component: "sectorRotation" },
  { symbol: "XLP", label: "Consumer Staples Sector ETF", component: "sectorRotation" },
  { symbol: "XLU", label: "Utilities Sector ETF", component: "sectorRotation" },
  { symbol: "XLRE", label: "Real Estate Sector ETF", component: "sectorRotation" },
  { symbol: "XLB", label: "Materials Sector ETF", component: "sectorRotation" },

  // AI / tech leadership
  { symbol: "SMH", label: "Semiconductor ETF", component: "aiLeadership" },
  { symbol: "IGV", label: "Software ETF", component: "aiLeadership" },
  { symbol: "NVDA", label: "Nvidia", component: "aiLeadership" },
  { symbol: "MSFT", label: "Microsoft", component: "aiLeadership" },
  { symbol: "AVGO", label: "Broadcom", component: "aiLeadership" },
  { symbol: "AMD", label: "Advanced Micro Devices", component: "aiLeadership" },
  { symbol: "META", label: "Meta Platforms", component: "aiLeadership" },
  { symbol: "GOOGL", label: "Alphabet", component: "aiLeadership" },
  { symbol: "AMZN", label: "Amazon", component: "aiLeadership" },
  { symbol: "TSM", label: "Taiwan Semiconductor", component: "aiLeadership" },
  { symbol: "ARM", label: "Arm Holdings", component: "aiLeadership" },
  { symbol: "PLTR", label: "Palantir", component: "aiLeadership" },
];

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === "." ||
    value === "" ||
    value === "null"
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from ${url}: ${text.slice(0, 250)}`);
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} from ${url}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  return json;
}

function ema(values, length) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < length) return null;

  const k = 2 / (length + 1);
  let current = nums.slice(0, length).reduce((sum, v) => sum + v, 0) / length;

  for (let i = length; i < nums.length; i += 1) {
    current = nums[i] * k + current * (1 - k);
  }

  return Number(current.toFixed(4));
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }

  return Number((((current - previous) / previous) * 100).toFixed(2));
}

export async function fetchFredSeries({
  seriesId,
  apiKey,
  observationStart = "2015-01-01",
  limit = 5000,
}) {
  if (!apiKey) {
    throw new Error("Missing FRED_API_KEY");
  }

  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: observationStart,
    sort_order: "asc",
    limit: String(limit),
  });

  const url = `${FRED_BASE_URL}?${params.toString()}`;
  const json = await fetchJson(url);

  const observations = Array.isArray(json.observations)
    ? json.observations.map((row) => ({
        date: row.date,
        value: toNumber(row.value),
        rawValue: row.value,
        realtime_start: row.realtime_start,
        realtime_end: row.realtime_end,
      }))
    : [];

  const validObservations = observations.filter((row) => row.value !== null);
  const latest = validObservations[validObservations.length - 1] || null;

  return {
    ok: true,
    source: "FRED",
    seriesId,
    count: observations.length,
    validCount: validObservations.length,
    latest,
    observations,
  };
}

export async function fetchEngine25FredBundle({
  apiKey,
  observationStart = "2015-01-01",
}) {
  const results = {};
  const errors = [];

  for (const series of ENGINE25_FRED_SERIES) {
    try {
      const data = await fetchFredSeries({
        seriesId: series.id,
        apiKey,
        observationStart,
      });

      results[series.id] = {
        ...series,
        ...data,
      };
    } catch (err) {
      errors.push({
        seriesId: series.id,
        label: series.label,
        component: series.component,
        error: err.message,
      });

      results[series.id] = {
        ...series,
        ok: false,
        error: err.message,
      };
    }
  }

  return {
    ok: errors.length === 0,
    source: "FRED",
    observationStart,
    seriesRequested: ENGINE25_FRED_SERIES.length,
    seriesLoaded: Object.values(results).filter((item) => item.ok).length,
    errors,
    results,
  };
}

export async function fetchFiscalDataOperatingCashBalance({
  pageSize = 5000,
  recordStart = "2015-01-01",
} = {}) {
  const params = new URLSearchParams({
    "page[size]": String(pageSize),
    sort: "-record_date",
    format: "json",
    filter: `record_date:gte:${recordStart}`,
  });

  const url = `${FISCALDATA_OPERATING_CASH_BALANCE_URL}?${params.toString()}`;
  const json = await fetchJson(url);

  const rows = Array.isArray(json.data)
    ? json.data.map((row) => {
        const closeBal = toNumber(row.close_today_bal);
        const openBal = toNumber(row.open_today_bal);

        // Newer DTS rows put TGA values in open_today_bal.
        // Older DTS rows used close_today_bal.
        const effectiveBalance =
          closeBal !== null && closeBal !== undefined ? closeBal : openBal;

        return {
          record_date: row.record_date,
          account_type: row.account_type || null,
          close_today_bal: closeBal,
          open_today_bal: openBal,
          effective_balance: effectiveBalance,
          table_nm: row.table_nm || null,
          sub_table_name: row.sub_table_name || null,
          src_line_nbr: row.src_line_nbr || null,
          raw: row,
        };
      })
    : [];

  // For current Engine 25 liquidity, use the TGA Closing Balance row.
  const tgaClosingRows = rows.filter(
    (row) =>
      row.effective_balance !== null &&
      String(row.account_type || "")
        .toLowerCase()
        .includes("treasury general account") &&
      String(row.account_type || "")
        .toLowerCase()
        .includes("closing balance")
  );

  // Fallback for older rows if exact TGA Closing Balance does not exist.
  const validRows =
    tgaClosingRows.length > 0
      ? tgaClosingRows
      : rows.filter((row) => row.effective_balance !== null);

  // Newest row because API is sorted by -record_date.
  const latest = validRows[0] || null;

  // Keep chronological order for future scoring/backtesting.
  const chronologicalRows = [...validRows].sort((a, b) =>
    String(a.record_date).localeCompare(String(b.record_date))
  );

  const latestRecordDate = latest?.record_date || null;
  const latestDateRows = latestRecordDate
    ? rows.filter((row) => row.record_date === latestRecordDate)
    : [];

  return {
    ok: true,
    source: "U.S. Treasury FiscalData",
    dataset: "Daily Treasury Statement",
    table: "Operating Cash Balance",
    endpoint: "/v1/accounting/dts/operating_cash_balance",
    recordStart,
    selectedAccountType: latest?.account_type || null,
    balanceField:
      latest?.close_today_bal !== null ? "close_today_bal" : "open_today_bal",
    sort: "-record_date",
    count: rows.length,
    validCount: validRows.length,
    latest,
    latestRecordDate,
    latestDateRows,
    rows: chronologicalRows,
  };
}

export async function fetchPolygonDailyBars({
  symbol,
  apiKey,
  from,
  to,
  adjusted = true,
  limit = 5000,
}) {
  if (!apiKey) {
    throw new Error("Missing POLYGON_API_KEY");
  }

  const params = new URLSearchParams({
    adjusted: String(adjusted),
    sort: "asc",
    limit: String(limit),
    apiKey,
  });

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}` +
    `?${params.toString()}`;

  const json = await fetchJson(url);

  const bars = Array.isArray(json.results)
    ? json.results.map((bar) => ({
        date: new Date(bar.t).toISOString().slice(0, 10),
        time: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        vwap: bar.vw ?? null,
        transactions: bar.n ?? null,
      }))
    : [];

  const closes = bars.map((bar) => bar.close).filter((v) => Number.isFinite(v));
  const latest = bars[bars.length - 1] || null;

  const close = latest?.close ?? null;
  const close5 = bars.length > 5 ? bars[bars.length - 6]?.close : null;
  const close20 = bars.length > 20 ? bars[bars.length - 21]?.close : null;
  const close50 = bars.length > 50 ? bars[bars.length - 51]?.close : null;
  const close200 = bars.length > 200 ? bars[bars.length - 201]?.close : null;

  const ema10 = ema(closes, 10);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  return {
    ok: true,
    source: "Polygon",
    symbol,
    from,
    to,
    count: bars.length,
    latest,
    metrics: {
      close,
      ema10,
      ema20,
      ema50,
      ema200,
      aboveEma10: close !== null && ema10 !== null ? close > ema10 : null,
      aboveEma20: close !== null && ema20 !== null ? close > ema20 : null,
      aboveEma50: close !== null && ema50 !== null ? close > ema50 : null,
      aboveEma200: close !== null && ema200 !== null ? close > ema200 : null,
      pctChange5d: pctChange(close, close5),
      pctChange20d: pctChange(close, close20),
      pctChange50d: pctChange(close, close50),
      pctChange200d: pctChange(close, close200),
    },
    bars,
  };
}

export async function fetchEngine25PolygonBundle({
  apiKey,
  from = "2015-01-01",
  to = new Date().toISOString().slice(0, 10),
  symbols = ENGINE25_POLYGON_SYMBOLS,
}) {
  const results = {};
  const errors = [];

  for (const item of symbols) {
    try {
      const data = await fetchPolygonDailyBars({
        symbol: item.symbol,
        apiKey,
        from,
        to,
      });

      results[item.symbol] = {
        ...item,
        ...data,
      };
    } catch (err) {
      errors.push({
        symbol: item.symbol,
        label: item.label,
        component: item.component,
        error: err.message,
      });

      results[item.symbol] = {
        ...item,
        ok: false,
        error: err.message,
      };
    }
  }

  return {
    ok: errors.length === 0,
    source: "Polygon",
    from,
    to,
    symbolsRequested: symbols.length,
    symbolsLoaded: Object.values(results).filter((item) => item.ok).length,
    errors,
    results,
  };
}
