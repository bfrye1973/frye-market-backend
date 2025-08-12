export function isNewHigh(dailyBars, lookback) {
  if (!dailyBars || dailyBars.length < lookback + 1) return false;
  const today = dailyBars[dailyBars.length - 1].h;
  const prevMax = Math.max(...dailyBars.slice(-lookback-1, -1).map(b => b.h));
  return today >= prevMax;
}

export function isNewLow(dailyBars, lookback) {
  if (!dailyBars || dailyBars.length < lookback + 1) return false;
  const today = dailyBars[dailyBars.length - 1].l;
  const prevMin = Math.min(...dailyBars.slice(-lookback-1, -1).map(b => b.l));
  return today <= prevMin;
}
