// ============================================================================
// Polygon Bars Fetcher
// Used by updateSmzLevels.js and the Smart Money Zone Engine
// ============================================================================

const BASE = "https://api.polygon.io/v2/aggs/ticker";
const KEY = process.env.POLYGON_API_KEY || process.env.POLYGON_KEY || "";

// Fetch bars for a symbol and timeframe
export async function getPolygonBars(symbol, timeframe = "30m", limit = 1500) {
  if (!KEY) throw new Error("Missing POLYGON_API_KEY");

  const tfMap = {
    "30m": { mult: 30, unit: "minute" },
    "1h":  { mult: 60, unit: "minute" },
    "4h":  { mult: 240, unit: "minute" }
  };

  const tf = tfMap[timeframe];
  if (!tf) throw new Error("Invalid timeframe: " + timeframe);

  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 120 * 86400000) // 120 days back
    .toISOString()
    .slice(0, 10);

  const url =
    `${BASE}/${encodeURIComponent(symbol)}/range/${tf.mult}/${tf.unit}/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=${limit}&apiKey=${KEY}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Polygon error ${r.status}: ${txt}`);
  }

  const data = await r.json();
  const arr = Array.isArray(data?.results) ? data.results : [];

  return arr.map(b => ({
    time: Math.floor(Number(b.t) / 1000),
    open:   Number(b.o),
    high:   Number(b.h),
    low:    Number(b.l),
    close:  Number(b.c),
    volume: Number(b.v || 0)
  }));
}
