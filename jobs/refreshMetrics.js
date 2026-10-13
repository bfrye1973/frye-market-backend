// jobs/refreshMetrics.js
import { Store } from '../data/store.js';
import { CONFIG } from '../config.js';

/**
 * Compute a simple ADR over the last `n` bars.
 * ADR here = average of (high - low) / close. Returns a number (2 decimals) or null.
 */
function calcADR(bars, n) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const len = Math.min(n, bars.length);
  let sum = 0;
  let count = 0;

  for (let i = bars.length - len; i < bars.length; i++) {
    const b = bars[i];
    if (b && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.c !== 0) {
      sum += (b.h - b.l) / b.c;
      count++;
    }
  }
  if (count === 0) return null;
  return Number((sum / count).toFixed(2));
}

/**
 * Is the latest close a new N‑day high?
 */
function isNewHigh(bars, n) {
  if (!Array.isArray(bars) || bars.length === 0) return false;
  const len = Math.min(n, bars.length);
  const slice = bars.slice(-len);
  const latest = slice[slice.length - 1]?.c;
  if (!Number.isFinite(latest)) return false;
  for (const b of slice) {
    if (!Number.isFinite(b?.c)) return false;
    if (b.c > latest) return false;
  }
  return true;
}

/**
 * Is the latest close a new N‑day low?
 */
function isNewLow(bars, n) {
  if (!Array.isArray(bars) || bars.length === 0) return false;
  const len = Math.min(n, bars.length);
  const slice = bars.slice(-len);
  const latest = slice[slice.length - 1]?.c;
  if (!Number.isFinite(latest)) return false;
  for (const b of slice) {
    if (!Number.isFinite(b?.c)) return false;
    if (b.c < latest) return false;
  }
  return true;
}

/**
 * Compute per‑sector metrics and (optionally) broadcast them.
 * `sectors` shape: { "Technology": ["AAPL","MSFT",...], "Energy": [...], ... }
 */
export async function computeMetrics(sectors, broadcast = () => {}) {
  const lookback = Number(CONFIG?.lookbackDays) || 20;

  const out = {
    timestamp: new Date().toISOString(),
    sectors: [],
  };

  for (const [sectorName, tickers] of Object.entries(sectors || {})) {
    let nh = 0;
    let nl = 0;

    let adrSum = 0;
    let adrCount = 0;

    for (const tkr of tickers) {
      const bars = Store.getDaily?.(tkr) || Store.get?.('daily', tkr) || []; // tolerate either accessor

      // New Highs / New Lows (using closes)
      if (isNewHigh(bars, lookback)) nh++;
      if (isNewLow(bars, lookback)) nl++;

      // ADR
      const adr = calcADR(bars, lookback);
      if (adr !== null) {
        adrSum += adr;
        adrCount++;
      }
    }

    out.sectors.push({
      sector: sectorName,
      newHighs: nh,
      newLows: nl,
      adrAvg: adrCount ? Number((adrSum / adrCount).toFixed(2)) : null,
    });
  }

  // Persist latest metrics in Store for REST / WS endpoints to read
  if (typeof Store.setMetrics === 'function') {
    Store.setMetrics(out);
  } else if (typeof Store.set === 'function') {
    Store.set('metrics', out);
  }

  // Push to clients if a broadcaster was provided
  try {
    broadcast(out);
  } catch {
    // no-op if broadcaster throws
  }

  return out;
}
