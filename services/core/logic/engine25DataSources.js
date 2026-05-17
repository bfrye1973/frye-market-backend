// services/core/logic/engine25DataSources.js

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

const FISCALDATA_OPERATING_CASH_BALANCE_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";

export const ENGINE25_FRED_SERIES = [
  { id: "UNRATE", label: "Unemployment Rate", component: "laborMarketHealth" },
  { id: "ICSA", label: "Initial Jobless Claims", component: "laborMarketHealth" },
  { id: "CCSA", label: "Continuing Jobless Claims", component: "laborMarketHealth" },
  { id: "PAYEMS", label: "Nonfarm Payrolls", component: "laborMarketHealth" },

  { id: "NFCI", label: "Chicago Fed National Financial Conditions Index", component: "financialStressCredit" },
  { id: "STLFSI4", label: "St. Louis Fed Financial Stress Index", component: "financialStressCredit" },
  { id: "BAMLH0A0HYM2", label: "High Yield Credit Spread", component: "financialStressCredit" },

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
    balanceField: latest?.close_today_bal !== null ? "close_today_bal" : "open_today_bal",
    sort: "-record_date",
    count: rows.length,
    validCount: validRows.length,
    latest,
    latestRecordDate,
    latestDateRows,
    rows: chronologicalRows,
  };
}
