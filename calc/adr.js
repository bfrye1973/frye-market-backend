export function adrPercent(dailyBars, lookback) {
  if (!dailyBars || dailyBars.length < lookback + 1) return null;
  const last = dailyBars[dailyBars.length - 1].c;
  const ranges = dailyBars.slice(-lookback).map(b => (b.h - b.l));
  const mean = ranges.reduce((a,b)=>a+b,0) / ranges.length;
  return last ? (100 * mean / last) : null;
}
