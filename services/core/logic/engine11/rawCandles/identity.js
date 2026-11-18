import { createHash } from 'node:crypto';

export class CandleError extends Error {
  constructor(code, detail = code) { super(detail); this.name = 'CandleError'; this.code = code; }
}
export function requireTruth(condition, code) {
  if (!condition) throw new CandleError(code);
}

// Keys and numbers are canonicalized before hashing; no retrieval time enters IDs.
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireTruth(Number.isFinite(value), 'NONFINITE_HASH_VALUE');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  requireTruth(value && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_HASH_OBJECT');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}
export const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const id = (kind, value) => kind + ':sha256:' + hash(value);

export function esContract(value) {
  // A short vendor alias alone is ambiguous across decades and is never identity.
  const match = typeof value === 'string' && value.match(/^ES([HMUZ])(\d{4})$/);
  requireTruth(match && Number(match[2]) >= 1900 && Number(match[2]) <= 2199, 'EXPLICIT_FULL_YEAR_ES_CONTRACT_REQUIRED');
  const month = { H: 3, M: 6, U: 9, Z: 12 }[match[1]];
  return Object.freeze({ instrumentId: 'CME:ES:' + match[2] + '-' + String(month).padStart(2, '0'),
    rootSymbol: 'ES', exchange: 'CME', contract: value, expirationYear: Number(match[2]), expirationMonth: month });
}

export const RESOLUTIONS = Object.freeze({ '1m': ['1min', 60], '5m': ['5min', 300],
  '10m': ['10min', 600], '15m': ['15min', 900], '30m': ['30min', 1800],
  '1h': ['1hour', 3600], '4h': ['4hour', 14400], '1d': ['1session', null] });
export function resolution(timeframe) {
  requireTruth(Object.hasOwn(RESOLUTIONS, timeframe), 'UNSUPPORTED_RAW_TIMEFRAME');
  return RESOLUTIONS[timeframe][0];
}
export function instant(value) {
  requireTruth(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), 'UTC_INSTANT_REQUIRED');
  const ms = Date.parse(value);
  requireTruth(Number.isSafeInteger(ms) && new Date(ms).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), 'INVALID_UTC_INSTANT');
  return ms;
}
export function range(from, to) {
  const start = instant(from), end = instant(to);
  requireTruth(start < end, 'INVALID_HALF_OPEN_RANGE');
  return { fromInclusive: new Date(start).toISOString(), toExclusive: new Date(end).toISOString() };
}
export function timestampNs(value) {
  requireTruth(typeof value === 'string' && /^\d{16,20}$/.test(value), 'EXACT_NANOSECOND_TIMESTAMP_REQUIRED');
  const ns = BigInt(value), ms = ns / 1000000n;
  requireTruth(ms > 0n && ms <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_SOURCE_TIMESTAMP');
  requireTruth(ns % 1000000000n === 0n, 'NONSECOND_ALIGNED_AGGREGATE');
  const iso = new Date(Number(ms)).toISOString();
  return { sourceTimestampNs: value, intervalStart: iso };
}

export function validateProviderAlias(contract, providerTicker) {
  const c = esContract(contract);
  const code = contract.slice(2, 3), year = String(c.expirationYear);
  requireTruth([`ES${code}${year}`, `ES${code}${year.slice(-2)}`, `ES${code}${year.slice(-1)}`].includes(providerTicker), 'PROVIDER_CONTRACT_ALIAS_MISMATCH');
  return c;
}
