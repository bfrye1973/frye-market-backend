// services/core/logic/engine14/normalizeInputs.js

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp01(v) {
  return Math.max(0, Math.min(1, safeNum(v, 0)));
}

export function avg(arr) {
  if (!Array.isArray(arr) || !arr.length) return 0;
  return arr.reduce((a, b) => a + safeNum(b, 0), 0) / arr.length;
}

export function sma(values, len) {
  if (!Array.isArray(values) || values.length < len || len <= 0) return 0;
  return avg(values.slice(values.length - len));
}

export function trueRange(curr, prevClose) {
  if (!curr) return 0;
  const h = safeNum(curr.high);
  const l = safeNum(curr.low);
  const pc = safeNum(prevClose, curr.close);
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

export function atr(bars, len = 14) {
  if (!Array.isArray(bars) || bars.length < len + 1) return 0;
  const trs = [];
  for (let i = 1; i < bars.length; i += 1) {
    trs.push(trueRange(bars[i], bars[i - 1].close));
  }
  return sma(trs, Math.min(len, trs.length));
}

export function zoneMid(zone) {
  if (!zone) return null;
  if (Number.isFinite(Number(zone.mid))) return Number(zone.mid);
  const lo = safeNum(zone.lo, null);
  const hi = safeNum(zone.hi, null);
  if (lo == null || hi == null) return null;
  return (lo + hi) / 2;
}

export function zonePos01(price, zone) {
  if (!zone) return null;
  const lo = safeNum(zone.lo, null);
  const hi = safeNum(zone.hi, null);
  if (lo == null || hi == null || hi <= lo) return null;
  return clamp01((safeNum(price) - lo) / (hi - lo));
}

export function insideZone(price, zone) {
  if (!zone) return false;
  const lo = safeNum(zone.lo, null);
  const hi = safeNum(zone.hi, null);
  if (lo == null || hi == null) return false;
  const p = safeNum(price);
  return p >= lo && p <= hi;
}

export function normalizeBars(rawBars = []) {
  return (Array.isArray(rawBars) ? rawBars : [])
    .map((b) => ({
      time: safeNum(b.time ?? b.t ?? b.ts ?? b.timestamp),
      open: safeNum(b.open ?? b.o),
      high: safeNum(b.high ?? b.h),
      low: safeNum(b.low ?? b.l),
      close: safeNum(b.close ?? b.c),
      volume: safeNum(b.volume ?? b.v),
    }))
    .filter((b) => b.time && Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close))
    .sort((a, b) => a.time - b.time);
}

export function avgVolume(bars, len = 20) {
  return sma(bars.map((b) => safeNum(b.volume)), len);
}

export function candleStats(bar, atr14 = 0, avgVol20 = 0) {
  if (!bar) {
    return {
      range: 0,
      bodySize: 0,
      bodyPercent: 0,
      rangeExpansion: 0,
      volumeExpansion: 0,
      closeNearHigh: false,
      closeNearLow: false,
      direction: "NONE",
    };
  }

  const range = Math.max(0, safeNum(bar.high) - safeNum(bar.low));
  const bodySize = Math.abs(safeNum(bar.close) - safeNum(bar.open));
  const bodyPercent = range > 0 ? bodySize / range : 0;
  const rangeExpansion = atr14 > 0 ? range / atr14 : 0;
  const volumeExpansion = avgVol20 > 0 ? safeNum(bar.volume) / avgVol20 : 0;

  const closeNearHigh = range > 0 ? (safeNum(bar.high) - safeNum(bar.close)) / range <= 0.25 : false;
  const closeNearLow = range > 0 ? (safeNum(bar.close) - safeNum(bar.low)) / range <= 0.25 : false;

  let direction = "NONE";
  if (safeNum(bar.close) > safeNum(bar.open)) direction = "LONG";
  if (safeNum(bar.close) < safeNum(bar.open)) direction = "SHORT";

  return {
    range,
    bodySize,
    bodyPercent,
    rangeExpansion,
    volumeExpansion,
    closeNearHigh,
    closeNearLow,
    direction,
  };
}
