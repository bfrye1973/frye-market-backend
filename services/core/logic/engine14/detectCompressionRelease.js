// services/core/logic/engine14/detectCompressionRelease.js

import { THRESHOLDS } from "./constants.js";

export function detectCompressionRelease(smiSeries = []) {
  const inspectBars = THRESHOLDS.compression.inspectBars;
  const minBars = THRESHOLDS.compression.minBars;
  const widthThreshold = THRESHOLDS.compression.widthThreshold;

  const rows = Array.isArray(smiSeries) ? smiSeries.slice(-inspectBars) : [];
  if (!rows.length) {
    return {
      state: "NONE",
      active: false,
      bars: 0,
      width: 0,
      releaseBarsAgo: null,
      early: false,
    };
  }

  let activeBars = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const k = Number(rows[i]?.k ?? 0);
    const d = Number(rows[i]?.d ?? 0);
    const width = Math.abs(k - d);
    if (width < widthThreshold) activeBars += 1;
    else break;
  }

  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2] || last;
  const widthNow = Math.abs(Number(last?.k ?? 0) - Number(last?.d ?? 0));
  const widthPrev = Math.abs(Number(prev?.k ?? 0) - Number(prev?.d ?? 0));

  const active = activeBars >= minBars;
  let state = "NONE";
  let releaseBarsAgo = null;
  let early = false;

  if (active) {
    state = activeBars >= minBars + 1 ? "COILED" : "TIGHTENING";
    early = activeBars === minBars;
  } else if (widthPrev < widthThreshold && widthNow >= widthThreshold) {
    releaseBarsAgo = 0;
    state = Number(last?.k ?? 0) >= Number(last?.d ?? 0) ? "RELEASE_UP" : "RELEASE_DOWN";
  }

  return {
    state,
    active,
    bars: activeBars,
    width: Number(widthNow.toFixed(2)),
    releaseBarsAgo,
    early,
  };
}
