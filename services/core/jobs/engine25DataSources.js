export const ENGINE25_POLYGON_SYMBOLS = [
  // Index / market ETFs
  { symbol: "SPY", label: "S&P 500 ETF", component: "marketTrend" },
  { symbol: "QQQ", label: "Nasdaq 100 ETF", component: "marketTrend" },
  { symbol: "IWM", label: "Russell 2000 ETF", component: "marketTrend" },
  { symbol: "DIA", label: "Dow Jones ETF", component: "marketTrend" },

  // Volatility / bonds / macro proxies
  { symbol: "UVXY", label: "Leveraged VIX Futures ETF", component: "volatility" },
  { symbol: "TLT", label: "20+ Year Treasury Bond ETF", component: "bonds" },
  { symbol: "UUP", label: "U.S. Dollar ETF", component: "commoditiesDollar" },
  { symbol: "GLD", label: "Gold ETF", component: "commoditiesDollar" },
  { symbol: "USO", label: "Oil ETF", component: "commoditiesDollar" },

  // Sectors
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
  { symbol: "SMH", label: "Semiconductor ETF", component: "aiLeadership" },
  { symbol: "IGV", label: "Software ETF", component: "aiLeadership" },

  // AI / mega-cap leadership
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
