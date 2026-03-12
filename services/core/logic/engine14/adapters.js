// services/core/logic/engine14/adapters.js

const BASE =
  process.env.ENGINE14_CORE_BASE ||
  process.env.CORE_BASE ||
  `http://127.0.0.1:${process.env.PORT || 10000}`;

const ROUTES = {
  OHLC: process.env.ENGINE14_ROUTE_OHLC || "/api/v1/ohlc",
  ENGINE1: process.env.ENGINE14_ROUTE_ENGINE1 || "/api/v1/engine1-context",
  ENGINE3: process.env.ENGINE14_ROUTE_ENGINE3 || "/api/v1/reaction-score",
  ENGINE4: process.env.ENGINE14_ROUTE_ENGINE4 || "/api/v1/volume-behavior",
  ENGINE45: process.env.ENGINE14_ROUTE_ENGINE45 || "/api/v1/momentum-context",
};

function buildUrl(path, params = {}) {
  const url = new URL(path, BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function getJson(path, params = {}) {
  const res = await fetch(buildUrl(path, params), {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`ENGINE14_FETCH_FAILED ${path} ${res.status}`);
  }

  return res.json();
}

export async function fetchBars(symbol, tf, limit = 120) {
  const json = await getJson(ROUTES.OHLC, { symbol, tf, limit });
  return json?.bars || json?.data || json;
}

export async function fetchEngine1Context(symbol) {
  return getJson(ROUTES.ENGINE1, { symbol, tf: "10m" });
}

export async function fetchEngine3(symbol, zone) {
  return getJson(ROUTES.ENGINE3, {
    symbol,
    tf: "10m",
    lo: zone?.lo,
    hi: zone?.hi,
  });
}

export async function fetchEngine4(symbol, zone) {
  return getJson(ROUTES.ENGINE4, {
    symbol,
    tf: "10m",
    lo: zone?.lo,
    hi: zone?.hi,
  });
}

export async function fetchEngine45(symbol) {
  return getJson(ROUTES.ENGINE45, {
    symbol,
    tf: "10m",
  });
}
