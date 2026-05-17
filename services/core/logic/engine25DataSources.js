// services/core/logic/engine25DataSources.js

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

const FISCALDATA_OPERATING_CASH_BALANCE_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";

const ENGINE25_FRED_SERIES = [
  {
    id: "UNRATE",
    label: "Unemployment Rate",
    component: "laborMarketHealth",
  },
  {
    id: "ICSA",
    label: "Initial Jobless Claims",
    component: "laborMarketHealth",
  },
  {
    id: "CCSA",
    label: "Continuing Jobless Claims",
    component: "laborMarketHealth",
  },
  {
    id: "PAYEMS",
    label: "Nonfarm Payrolls",
    component: "laborMarketHealth",
  },
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
  {
    id: "DGS10",
    label: "10-Year Treasury Rate",
    component: "fedBondMarket",
  },
  {
    id: "DGS2",
    label: "2-Year Treasury Rate",
    component: "fedBondMarket",
  },
  {
    id: "T10Y2Y",
    label: "10Y minus 2Y Yield Spread",
    component: "fedBondMarket",
  },
  {
    id: "T10Y3M",
    label: "10Y minus 3M Yield Spread",
    component: "fedBondMarket",
  },
  {
    id: "WALCL",
    label: "Fed Balance Sheet",
    component: "liquidityConditions",
  },
  {
    id: "RRPONTSYD",
    label: "Reverse Repo",
    component: "liquidityConditions",
  },
  {
    id: "WRESBAL",
    label: "Bank Reserves",
    component: "liquidityConditions",
  },
  {
    id: "M2SL",
    label: "M2 Money Supply",
    component: "liquidityConditions",
  },
  {
    id: "CPIAUCSL",
    label: "Consumer Price Index",
    component: "inflation",
  },
  {
    id: "PPIACO",
    label: "Producer Price Index",
    component: "inflation",
  },
];

function toNumber(value) {
  if (value === null || value === undefined || value === "." || value === "") {
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
  } catch (err) {
    throw new Error(`Invalid JSON response from ${url}: ${text.slice(0, 250)}`);
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} from ${url}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  return json;
}

async function fetchFredSeries({
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
    seriesId,
    count: observations.length,
    validCount: validObservations.length,
    latest,
    observations,
  };
}

async function fetchEngine25FredBundle({
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

async function fetchFiscalDataOperatingCashBalance({ pageSize = 5000 } = {}) {
  const params = new URLSearchParams({
    "page[size]": String(pageSize),
    sort: "record_date",
    format: "json",
  });

  const url = `${FISCALDATA_OPERATING_CASH_BALANCE_URL}?${params.toString()}`;
  const json = await fetchJson(url);

  const rows = Array.isArray(json.data)
    ? json.data.map((row) => ({
        record_date: row.record_date,
        account_type: row.account_type || null,
        close_today_bal: toNumber(row.close_today_bal),
        open_today_bal: toNumber(row.open_today_bal),
        raw: row,
      }))
    : [];

  const validRows = rows.filter((row) => row.close_today_bal !== null);
  const latest = validRows[validRows.length - 1] || null;

  return {
    ok: true,
    source: "U.S. Treasury FiscalData",
    dataset: "Daily Treasury Statement",
    table: "Operating Cash Balance",
    endpoint: "/v1/accounting/dts/operating_cash_balance",
    count: rows.length,
    validCount: validRows.length,
    latest,
    rows,
  };
}

module.exports = {
  ENGINE25_FRED_SERIES,
  fetchFredSeries,
  fetchEngine25FredBundle,
  fetchFiscalDataOperatingCashBalance,
};
