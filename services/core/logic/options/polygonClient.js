const POLYGON_BASE = "https://api.polygon.io";

function getApiKey() {
  const key =
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    process.env.POLYGON_KEY;

  if (!key) throw new Error("MISSING_POLYGON_API_KEY");
  return key;
}

function withApiKey(url) {
  const u = new URL(url);
  if (!u.searchParams.has("apiKey")) {
    u.searchParams.set("apiKey", getApiKey());
  }
  return u.toString();
}

async function fetchJson(url) {
  const res = await fetch(withApiKey(url));
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(json?.error || json?.message || `HTTP_${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json;
}

export async function polygonLastTrade(ticker) {
  const u = new URL(`${POLYGON_BASE}/v2/last/trade/${encodeURIComponent(ticker)}`);
  const j = await fetchJson(u.toString());

  const p = Number(j?.results?.p);
  const t = j?.results?.t ? new Date(j.results.t).toISOString() : null;

  return {
    last: Number.isFinite(p) ? p : null,
    ts: t
  };
}
