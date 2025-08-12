// data/constituents.js
// A small shim so server.js can always call `loadSectors()`.

import { Store } from './store.js';

/**
 * Return a map of sectors to arrays of tickers, e.g.:
 * {
 *   "Technology": ["AAPL","MSFT",...],
 *   "Energy": ["XOM","CVX",...],
 *   ...
 * }
 */
export function loadSectors() {
  // Prefer a Store accessor if present
  if (typeof Store?.getSectors === 'function') {
    return Store.getSectors();
  }
  // Fallback to a generic getter or an in‑memory value
  const fromStore = (typeof Store?.get === 'function') ? Store.get('sectors') : null;
  return fromStore || {};
}
