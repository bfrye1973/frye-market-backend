// computeSMI.js
// TradingView-accurate SMI calculation

function ema(values, length) {
  const k = 2 / (length + 1);
  let emaArray = [];
  let prev;

  values.forEach((v, i) => {
    if (i === 0) {
      prev = v;
      emaArray.push(v);
      return;
    }

    const next = v * k + prev * (1 - k);
    emaArray.push(next);
    prev = next;
  });

  return emaArray;
}

function emaEma(values, length) {
  const first = ema(values, length);
  return ema(first, length);
}

function highest(arr, length, index) {
  const start = Math.max(0, index - length + 1);
  return Math.max(...arr.slice(start, index + 1));
}

function lowest(arr, length, index) {
  const start = Math.max(0, index - length + 1);
  return Math.min(...arr.slice(start, index + 1));
}

function computeSMI(bars, lengthK = 12, lengthD = 7, lengthEMA = 5) {
  if (!bars || bars.length === 0) {
    return null;
  }

  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  const relativeRange = [];
  const highestLowestRange = [];

  for (let i = 0; i < bars.length; i++) {
    const hh = highest(highs, lengthK, i);
    const ll = lowest(lows, lengthK, i);

    const range = hh - ll;
    const rel = closes[i] - (hh + ll) / 2;

    highestLowestRange.push(range);
    relativeRange.push(rel);
  }

  const smoothedRel = emaEma(relativeRange, lengthD);
  const smoothedRange = emaEma(highestLowestRange, lengthD);

  const smi = smoothedRel.map((v, i) => {
    const denom = smoothedRange[i];
    if (!denom) return 0;
    return 200 * (v / denom);
  });

  const signal = ema(smi, lengthEMA);

  return {
    smi,
    signal
  };
}

function detectCross(smi, signal) {
  const len = smi.length;

  for (let i = len - 1; i >= Math.max(1, len - 3); i--) {
    const prevK = smi[i - 1];
    const prevD = signal[i - 1];
    const currK = smi[i];
    const currD = signal[i];

    if (prevK < prevD && currK > currD) {
      return "BULLISH";
    }

    if (prevK > prevD && currK < currD) {
      return "BEARISH";
    }
  }

  return "NONE";
}

module.exports = {
  computeSMI,
  detectCross
};
