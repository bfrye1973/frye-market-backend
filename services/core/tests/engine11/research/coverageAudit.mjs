// Research diagnostics only. No production imports, writes, calendar acceptance,
// synthetic bars, continuous series, source finality or structural promotion.
import { hash } from '../../../logic/engine11/rawCandles/identity.js';
import { parseProviderJson, safePageUrl } from '../../../logic/engine11/rawCandles/provider.js';

export function inspectRows(rows, { ticker, from, to, stepMs = null }) {
  const errors = [], stamps = [], revisions = new Map(), conflictSamples = [];
  let duplicates = 0, conflicts = 0, excluded = 0;
  for (const row of rows) {
    if (typeof row.window_start !== 'string' || !/^\d{16,20}$/.test(row.window_start)) {
      errors.push('INEXACT_TIMESTAMP'); continue;
    }
    const ns = BigInt(row.window_start);
    if (ns % 1000000n) errors.push('SUBMILLISECOND_ALIGNMENT');
    const ms = Number(ns / 1000000n);
    if (ms < Date.parse(from) || ms >= Date.parse(to)) { excluded++; continue; }
    if (row.ticker !== ticker) errors.push('TICKER_MISMATCH');
    const prices = ['open', 'high', 'low', 'close'].map(k => row[k]);
    if (!prices.every(p => typeof p === 'number' && Number.isFinite(p) && p > 0 && Math.abs(p * 4 - Math.round(p * 4)) < 1e-8)) errors.push('INVALID_ES_PRICE');
    else if (row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close) || row.low > row.high) errors.push('INVALID_OHLC');
    if (row.volume != null && (!Number.isSafeInteger(row.volume) || row.volume < 0)) errors.push('INVALID_VOLUME');
    if (stamps.length && ms < stamps.at(-1)) errors.push('NONMONOTONIC');
    const digest = hash(row);
    if (revisions.has(row.window_start)) {
      const prior = revisions.get(row.window_start);
      if (prior.digest === digest) duplicates++;
      else {
        conflicts++;
        if (conflictSamples.length < 5) conflictSamples.push({ window_start: row.window_start,
          classification: prior.row.session_end_date !== row.session_end_date ? 'SOURCE_BUCKET_COLLISION_ACROSS_SESSION_LABELS' : 'SAME_BUCKET_CHANGED_VALUES',
          prior: prior.row, observed: row });
      }
    } else revisions.set(row.window_start, { digest, row });
    stamps.push(ms);
  }
  const gaps = [];
  if (stepMs) for (let i = 1; i < stamps.length; i++) if (stamps[i] - stamps[i - 1] > stepMs) {
    gaps.push({ from: new Date(stamps[i - 1] + stepMs).toISOString(), to: new Date(stamps[i]).toISOString(), classification: 'UNKNOWN_SOURCE_ABSENCE' });
  }
  return { sourceRows: rows.length, inRangeRows: stamps.length, excluded, duplicates, conflicts,
    errors: [...new Set(errors)], first: stamps.length ? new Date(stamps[0]).toISOString() : null,
    last: stamps.length ? new Date(stamps.at(-1)).toISOString() : null,
    rowDigest: hash(rows), fields: [...new Set(rows.flatMap(row => Object.keys(row)))].sort(),
    observationSamples: rows.slice(0, 3).map(({ window_start, session_end_date, close, settlement_price, transactions, volume }) =>
      ({ window_start, session_end_date, close, settlement_price, transactions, volume })),
    gapCount: gaps.length, gapSamples: gaps.slice(0, 12), conflictSamples,
    sourceFinality: 'UNKNOWN', calendarAccepted: false, structuralEligible: false, coverageComplete: false };
}

export function verifyContract(rows, ticker, year) {
  const matching = rows.filter(row => row.ticker === ticker && row.product_code === 'ES' &&
    typeof row.settlement_date === 'string' && row.settlement_date.startsWith(year + '-'));
  return { verified: matching.length === 1, matchingCount: matching.length,
    metadata: matching.map(({ ticker, product_code, settlement_date, first_trade_date, last_trade_date, trading_venue }) =>
      ({ ticker, product_code, settlement_date, first_trade_date, last_trade_date, trading_venue })) };
}

export function chicagoClock(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format( new Date(iso));
}

export async function requestJson(url, { apiKey, fetchImpl = fetch, attempts = 3, captureSuccessBody = false } = {}) {
  // No provider error bodies/URLs are logged. Never put credentials in a URL.
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
      if (response.ok) {
        const bodyText = await response.text();
        if (captureSuccessBody && bodyText.includes(apiKey)) throw new Error('Credential in provider body');
        return { status: response.status, body: parseProviderJson(bodyText), ...(captureSuccessBody ? { bodyText } : {}) };
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || i === attempts - 1) return { status: response.status, body: null };
    } catch { if (i === attempts - 1) return { status: 'TRANSPORT_UNAVAILABLE', body: null }; }
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** i));
  }
}

export async function probeAggregates({ ticker, from, to, resolution = '1session', maxPages = 1, stepMs = null, apiKey, fetchImpl }) {
  const initial = new URL('https://api.massive.com/futures/v1/aggs/' + ticker);
  initial.search = new URLSearchParams({ resolution, 'window_start.gte': String(BigInt(Date.parse(from)) * 1000000n),
    'window_start.lt': String(BigInt(Date.parse(to)) * 1000000n), sort: 'window_start.asc', limit: '50000' }).toString();
  const rows = [], pages = [], seen = new Set();
  let next = initial, traversalComplete = false, failure = null;
  while (next) {
    if (pages.length >= maxPages) { failure = 'PAGE_BUDGET_EXCEEDED'; break; }
    const requestDigest = hash(next.toString());
    if (seen.has(requestDigest)) { failure = 'CURSOR_CYCLE'; break; }
    seen.add(requestDigest);
    const result = await requestJson(next.toString(), { apiKey, fetchImpl });
    pages.push({ number: pages.length + 1, status: result.status, requestDigest, rows: result.body?.results?.length ?? 0 });
    if (!Array.isArray(result.body?.results) || (result.body.status && result.body.status !== 'OK')) { failure = 'PROVIDER_UNAVAILABLE_OR_INVALID'; break; }
    rows.push(...result.body.results);
    try { next = result.body.next_url ? safePageUrl(result.body.next_url, initial) : null; }
    catch { failure = 'UNSAFE_CURSOR'; break; }
    if (!next) traversalComplete = true;
  }
  return { ticker, from, to, resolution, pages, traversalComplete, failure,
    observedAt: new Date().toISOString(), ...inspectRows(rows, { ticker, from, to, stepMs }) };
}
