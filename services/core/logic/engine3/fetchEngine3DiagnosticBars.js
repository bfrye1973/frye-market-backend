const ALLOWED_TIMEFRAMES = new Set(["1m", "5m"]);

function normalizeBars(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.bars)) return payload.bars;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function failClosed(timeframe, reasonCode, detail = null) {
  return {
    ok: false,
    timeframe: timeframe || null,
    bars: [],
    diagnosticOnly: true,
    reasonCode,
    detail,
  };
}

export async function fetchEngine3DiagnosticBars({
  symbol = "ES",
  timeframe,
  limit = 120,
  coreBase,
  fetchJson,
} = {}) {
  if (!ALLOWED_TIMEFRAMES.has(timeframe)) {
    return failClosed(timeframe, "UNSUPPORTED_DIAGNOSTIC_TIMEFRAME");
  }
  if (typeof fetchJson !== "function" || !coreBase) {
    return failClosed(timeframe, "DIAGNOSTIC_FETCH_DEPENDENCY_MISSING");
  }

  const url = new URL(`${coreBase}/api/v1/futures/ohlc`);
  url.searchParams.set("symbol", String(symbol || "ES").toUpperCase());
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("limit", String(limit));

  try {
    const response = await fetchJson(url.toString(), 15000);
    if (response?.ok !== true) {
      return failClosed(
        timeframe,
        "DIAGNOSTIC_BARS_FETCH_FAILED",
        response?.text || null
      );
    }
    return {
      ok: true,
      timeframe,
      bars: normalizeBars(response?.json),
      diagnosticOnly: true,
      source: "/api/v1/futures/ohlc",
      reasonCode: null,
      detail: null,
    };
  } catch (error) {
    return failClosed(
      timeframe,
      "DIAGNOSTIC_BARS_FETCH_FAILED",
      String(error?.message || error)
    );
  }
}

export async function fetchEngine3DiagnosticBarStack(options = {}) {
  const shared = {
    symbol: options.symbol || "ES",
    limit: options.limit ?? 120,
    coreBase: options.coreBase,
    fetchJson: options.fetchJson,
  };
  const [oneMinute, fiveMinute] = await Promise.all([
    fetchEngine3DiagnosticBars({ ...shared, timeframe: "1m" }),
    fetchEngine3DiagnosticBars({ ...shared, timeframe: "5m" }),
  ]);
  return { oneMinute, fiveMinute };
}

export default fetchEngine3DiagnosticBars;
