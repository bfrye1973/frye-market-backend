// services/core/logic/engine45/detectCompressionRelease.js
// Engine 4.5 Phase 2
// Detects compression release / slope / tightness from 10m SMI arrays

function clamp100(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function round2(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function findRecentCross(smi, signal, windowBars = 3) {
  if (!Array.isArray(smi) || !Array.isArray(signal)) {
    return { cross: "NONE", barsAgo: null };
  }

  const len = Math.min(smi.length, signal.length);
  if (len < 2) return { cross: "NONE", barsAgo: null };

  const start = Math.max(1, len - windowBars);

  for (let i = len - 1; i >= start; i--) {
    const prevK = Number(smi[i - 1]);
    const prevD = Number(signal[i - 1]);
    const currK = Number(smi[i]);
    const currD = Number(signal[i]);

    if (![prevK, prevD, currK, currD].every(Number.isFinite)) continue;

    if (prevK < prevD && currK > currD) {
      return { cross: "BULLISH", barsAgo: len - 1 - i };
    }

    if (prevK > prevD && currK < currD) {
      return { cross: "BEARISH", barsAgo: len - 1 - i };
    }
  }

  return { cross: "NONE", barsAgo: null };
}

function computeTightnessFromWidths(widths) {
  if (!Array.isArray(widths) || !widths.length) return 0;

  const avgWidth = widths.reduce((sum, w) => sum + w, 0) / widths.length;

  // Locked simple scoring model from passover:
  // tightness = 100 - (avgWidth * 20)
  return clamp100(100 - avgWidth * 20);
}

function gradeRelease({ state, tightness, releaseBarsAgo, expanding }) {
  if (state !== "RELEASING_UP" && state !== "RELEASING_DOWN") return "NONE";
  if (!expanding) return "C";
  if (tightness >= 70 && releaseBarsAgo != null && releaseBarsAgo <= 1) return "A";
  if (tightness >= 50 && releaseBarsAgo != null && releaseBarsAgo <= 2) return "B";
  return "C";
}

export function detectCompressionRelease(
  smi,
  signal,
  compression,
  opts = {}
) {
  const lookback = Number(opts.lookback ?? 10);
  const crossWindow = Number(opts.crossWindow ?? 3);

  if (!Array.isArray(smi) || !Array.isArray(signal) || !smi.length || !signal.length) {
    return {
      state: "NONE",
      quality: "NONE",
      tightness: 0,
      releaseBarsAgo: null,
      early: false,
      slope: {
        smi: 0,
        signal: 0,
        widthNow: 0,
        widthPrev: 0,
        expanding: false,
      },
    };
  }

  const len = Math.min(smi.length, signal.length);
  if (len < 2) {
    return {
      state: "NONE",
      quality: "NONE",
      tightness: 0,
      releaseBarsAgo: null,
      early: false,
      slope: {
        smi: 0,
        signal: 0,
        widthNow: 0,
        widthPrev: 0,
        expanding: false,
      },
    };
  }

  const start = Math.max(0, len - lookback);
  const widths = [];

  for (let i = start; i < len; i++) {
    const k = Number(smi[i]);
    const d = Number(signal[i]);
    if (!Number.isFinite(k) || !Number.isFinite(d)) continue;
    widths.push(Math.abs(k - d));
  }

  const tightness = computeTightnessFromWidths(widths);

  const smiNow = Number(smi[len - 1]);
  const smiPrev = Number(smi[len - 2]);
  const sigNow = Number(signal[len - 1]);
  const sigPrev = Number(signal[len - 2]);

  const smiSlope =
    Number.isFinite(smiNow) && Number.isFinite(smiPrev) ? smiNow - smiPrev : 0;
  const signalSlope =
    Number.isFinite(sigNow) && Number.isFinite(sigPrev) ? sigNow - sigPrev : 0;

  const widthNow =
    Number.isFinite(smiNow) && Number.isFinite(sigNow) ? Math.abs(smiNow - sigNow) : 0;
  const widthPrev =
    Number.isFinite(smiPrev) && Number.isFinite(sigPrev) ? Math.abs(smiPrev - sigPrev) : 0;

  const expanding = widthNow > widthPrev;

  const recentCross = findRecentCross(smi, signal, crossWindow);

  let state = "NONE";

  if (compression?.active === true && recentCross.cross === "NONE") {
    state = "COILING";
  }

  if (
    compression?.active === true &&
    recentCross.cross === "BULLISH" &&
    smiSlope > 0 &&
    expanding
  ) {
    state = "RELEASING_UP";
  }

  if (
    compression?.active === true &&
    recentCross.cross === "BEARISH" &&
    smiSlope < 0 &&
    expanding
  ) {
    state = "RELEASING_DOWN";
  }

  const quality = gradeRelease({
    state,
    tightness,
    releaseBarsAgo: recentCross.barsAgo,
    expanding,
  });

  return {
    state,
    quality,
    tightness,
    releaseBarsAgo: recentCross.barsAgo,
    early:
      recentCross.barsAgo != null &&
      recentCross.barsAgo <= 1 &&
      (state === "RELEASING_UP" || state === "RELEASING_DOWN"),
    slope: {
      smi: round2(smiSlope),
      signal: round2(signalSlope),
      widthNow: round2(widthNow),
      widthPrev: round2(widthPrev),
      expanding,
    },
  };
}

export default detectCompressionRelease;
