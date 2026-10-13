// services/core/logic/engine45/computeSMI.js
// TradingView-style SMI calculation
// Matches the user's Pine Script structure:
// smi = 200 * (ema(ema(relativeRange, lengthD), lengthD) / ema(ema(range, lengthD), lengthD))
// signal = ema(smi, lengthEMA)

function ema(values, length) {
  if (!Array.isArray(values) || !values.length || length <= 0) return [];

  const k = 2 / (length + 1);
  const out = new Array(values.length);

  let prev = Number(values[0]) || 0;
  out[0] = prev;

  for (let i = 1; i < values.length; i++) {
    const v = Number(values[i]) || 0;
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }

  return out;
}

function emaEma(values, length) {
  return ema(ema(values, length), length);
}

function highest(arr, length, index) {
  const start = Math.max(0, index - length + 1);
  let max = -Infinity;
  for (let i = start; i <= index; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

function lowest(arr, length, index) {
  const start = Math.max(0, index - length + 1);
  let min = Infinity;
  for (let i = start; i <= index; i++) {
    if (arr[i] < min) min = arr[i];
  }
  return min;
}

export function computeSMI(bars, lengthK = 12, lengthD = 7, lengthEMA = 5) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return null;
  }

  const highs = bars.map((b) => Number(b.high) || 0);
  const lows = bars.map((b) => Number(b.low) || 0);
  const closes = bars.map((b) => Number(b.close) || 0);

  const relativeRange = new Array(bars.length);
  const highestLowestRange = new Array(bars.length);

  for (let i = 0; i < bars.length; i++) {
    const hh = highest(highs, lengthK, i);
    const ll = lowest(lows, lengthK, i);

    const range = hh - ll;
    const rel = closes[i] - (hh + ll) / 2;

    highestLowestRange[i] = range;
    relativeRange[i] = rel;
  }

  const smoothedRel = emaEma(relativeRange, lengthD);
  const smoothedRange = emaEma(highestLowestRange, lengthD);

  const smi = smoothedRel.map((v, i) => {
    const denom = smoothedRange[i];
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) return 0;
    return 200 * (v / denom);
  });

  const signal = ema(smi, lengthEMA);

  return { smi, signal };
}

export function detectCross(smi, signal, windowBars = 3) {
  if (!Array.isArray(smi) || !Array.isArray(signal)) return "NONE";
  if (smi.length < 2 || signal.length < 2) return "NONE";

  const start = Math.max(1, smi.length - windowBars);

  for (let i = smi.length - 1; i >= start; i--) {
    const prevK = smi[i - 1];
    const prevD = signal[i - 1];
    const currK = smi[i];
    const currD = signal[i];

    if (prevK < prevD && currK > currD) return "BULLISH";
    if (prevK > prevD && currK < currD) return "BEARISH";
  }

  return "NONE";
}
