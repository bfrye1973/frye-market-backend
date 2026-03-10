async function fetchBars(symbol, tf) {
  const baseUrl = getBaseUrl();
  const url = new URL("/api/v1/ohlc", baseUrl);

  url.searchParams.set("symbol", String(symbol || "SPY").toUpperCase().trim());
  url.searchParams.set("timeframe", String(tf || "10m").trim());
  url.searchParams.set("limit", "120");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }

    throw new Error(
      `OHLC fetch failed (${tf}) status=${res.status}${detail ? ` detail=${detail.slice(0, 300)}` : ""}`
    );
  }

  const data = await res.json();

  console.log(
    `[engine45] OHLC ${tf} payload:`,
    JSON.stringify(data).slice(0, 500)
  );

  let bars = null;

  if (Array.isArray(data)) {
    bars = data;
  } else if (Array.isArray(data?.bars)) {
    bars = data.bars;
  } else if (Array.isArray(data?.data?.bars)) {
    bars = data.data.bars;
  } else if (Array.isArray(data?.rows)) {
    bars = data.rows;
  }

  if (!Array.isArray(bars)) {
    throw new Error(
      `OHLC payload invalid (${tf}) keys=${Object.keys(data || {}).join(",")}`
    );
  }

  const normalized = bars
    .map((b) => {
      const time = Number(b?.time);
      const open = Number(b?.open);
      const high = Number(b?.high);
      const low = Number(b?.low);
      const close = Number(b?.close);
      const volume = Number(b?.volume ?? 0);

      if (
        !Number.isFinite(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return null;
      }

      return {
        time,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter(Boolean);

  if (!normalized.length) {
    throw new Error(`OHLC payload empty/invalid after normalize (${tf})`);
  }

  return normalized;
}
