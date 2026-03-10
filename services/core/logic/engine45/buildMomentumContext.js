async function fetchBars(symbol, tf) {
  const baseUrl = getBaseUrl();
  const url = new URL("/api/v1/ohlc", baseUrl);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("tf", tf);
  url.searchParams.set("limit", "120");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`OHLC fetch failed (${tf}) status=${res.status}`);
  }

  const data = await res.json();

  // Accept multiple possible payload shapes
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.bars)) {
    return data.bars;
  }

  if (Array.isArray(data?.data?.bars)) {
    return data.data.bars;
  }

  if (Array.isArray(data?.rows)) {
    return data.rows;
  }

  throw new Error(
    `OHLC payload invalid (${tf}) keys=${Object.keys(data || {}).join(",")}`
  );
}
