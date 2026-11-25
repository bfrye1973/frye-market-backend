// services/core/logic/engine45/detectCompression.js

export function detectCompression(smi, signal, opts = {}) {
  const lookback = Number(opts.lookback ?? 10);
  const threshold = Number(opts.threshold ?? 5);
  const minBars = Number(opts.minBars ?? 4);

  if (!Array.isArray(smi) || !Array.isArray(signal) || !smi.length || !signal.length) {
    return {
      active: false,
      bars: 0,
      width: 0,
    };
  }

  const start = Math.max(0, smi.length - lookback);
  const widths = [];

  for (let i = start; i < smi.length; i++) {
    const width = Math.abs((Number(smi[i]) || 0) - (Number(signal[i]) || 0));
    widths.push(width);
  }

  const bars = widths.filter((w) => w < threshold).length;
  const avgWidth = widths.length
    ? widths.reduce((sum, w) => sum + w, 0) / widths.length
    : 0;

  return {
    active: bars >= minBars,
    bars,
    width: Number(avgWidth.toFixed(2)),
  };
}
