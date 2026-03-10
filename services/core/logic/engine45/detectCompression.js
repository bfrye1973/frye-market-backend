// detectCompression.js

function detectCompression(smi, signal) {
  const lookback = 10;

  const widths = [];

  for (let i = smi.length - lookback; i < smi.length; i++) {
    if (i < 0) continue;

    const width = Math.abs(smi[i] - signal[i]);
    widths.push(width);
  }

  let count = 0;

  widths.forEach(w => {
    if (w < 5) count++;
  });

  const avgWidth =
    widths.reduce((a, b) => a + b, 0) / widths.length || 0;

  return {
    active: count >= 4,
    bars: count,
    width: Number(avgWidth.toFixed(2))
  };
}

module.exports = detectCompression;
