import { CandleError, requireTruth, range, resolution, instant, validateProviderAlias, hash } from './identity.js';
import { validateCalendarPlan, assessCoverage } from './calendar.js';
import { normalizeRawRows } from './normalize.js';

const ORIGINS = new Set(['https://api.massive.com', 'https://api.polygon.io']);
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// JSON.parse would round a numeric nanosecond timestamp. Quote this vendor field
// before parsing; all other raw numeric values retain their original values.
export function parseProviderJson(text) {
  requireTruth(typeof text === 'string' && text.length <= 32 * 1024 * 1024, 'INVALID_PROVIDER_BODY');
  try { return JSON.parse(text.replace(/("window_start"\s*:\s*)(\d{16,20})(?=\s*[,}])/g, '$1"$2"')); }
  catch { throw new CandleError('INVALID_PROVIDER_JSON'); }
}

export function safePageUrl(input, initial) {
  let url;
  try { url = new URL(input); } catch { throw new CandleError('INVALID_PROVIDER_NEXT_URL'); }
  const original = new URL(initial);
  requireTruth(ORIGINS.has(url.origin) && url.origin === original.origin && url.pathname === original.pathname &&
    !url.username && !url.password && !url.hash, 'UNSAFE_PROVIDER_NEXT_URL');
  url.searchParams.delete('apiKey');
  requireTruth(url.toString().length <= 8192 && [...url.searchParams.keys()].every(key =>
    ['cursor', 'limit', 'resolution', 'window_start.gte', 'window_start.lt', 'sort'].includes(key)), 'UNSAFE_PROVIDER_PAGE_PARAMETERS');
  // Existing date/resolution filters may be omitted by opaque vendor cursors,
  // but if present they must not alter the query.
  for (const key of ['resolution', 'window_start.gte', 'window_start.lt', 'sort']) {
    requireTruth(!url.searchParams.has(key) || url.searchParams.get(key) === original.searchParams.get(key), 'PROVIDER_PAGE_QUERY_DRIFT');
  }
  return url;
}

async function fetchPage(url, { fetchImpl, apiKey, attempts, timeoutMs, signal, sleep }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new CandleError('ACQUISITION_ABORTED');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + apiKey }, signal: controller.signal });
      if (response.ok) {
        const body = await response.text();
        if (controller.signal.aborted) throw new CandleError(signal?.aborted ? 'ACQUISITION_ABORTED' : 'PROVIDER_TIMEOUT');
        return parseProviderJson(body);
      }
      if (response.status === 401 || response.status === 403) throw new CandleError('ENTITLEMENT_DENIED');
      if (!RETRYABLE.has(response.status)) throw new CandleError('PROVIDER_HTTP_ERROR');
      if (attempt === attempts - 1) throw new CandleError('PROVIDER_RETRY_EXHAUSTED');
      const retryAfter = Number(response.headers?.get('retry-after'));
      await sleep(Math.min(3000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 100 * 2 ** attempt));
    } catch (error) {
      if (error instanceof CandleError) throw error;
      if (signal?.aborted) throw new CandleError('ACQUISITION_ABORTED');
      if (attempt === attempts - 1) throw new CandleError('PROVIDER_TRANSPORT_UNAVAILABLE');
      await sleep(100 * 2 ** attempt);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  }
}

export async function acquireRawEs({ contract, providerTicker, timeframe, from, to, calendar,
  asOf, sourceAsOf = null, noTrades = [], apiKey, baseUrl = 'https://api.massive.com',
  fetchImpl = globalThis.fetch, maxPages = 100, maxRows = 100000, attempts = 3, timeoutMs = 20000,
  signal, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  validateProviderAlias(contract, providerTicker);
  const query = { contract, providerTicker, timeframe, range: range(from, to), priceBasis: 'RAW_CONTRACT' };
  resolution(timeframe); instant(asOf);
  if (sourceAsOf != null) requireTruth(instant(sourceAsOf) <= instant(asOf), 'SOURCE_WATERMARK_AFTER_ASOF');
  const plan = validateCalendarPlan(calendar, query);
  requireTruth(typeof apiKey === 'string' && apiKey.length > 0, 'PROVIDER_CREDENTIAL_REQUIRED');
  requireTruth(ORIGINS.has(baseUrl), 'UNSAFE_PROVIDER_BASE');
  requireTruth(typeof fetchImpl === 'function' && Number.isInteger(maxPages) && maxPages > 0 && maxPages <= 1000 &&
    Number.isInteger(maxRows) && maxRows > 0 && maxRows <= 1000000 &&
    Number.isInteger(attempts) && attempts > 0 && attempts <= 5 && timeoutMs > 0 && timeoutMs <= 60000, 'INVALID_ACQUISITION_BUDGET');
  const initial = new URL('/futures/v1/aggs/' + encodeURIComponent(providerTicker), baseUrl);
  initial.searchParams.set('resolution', resolution(timeframe));
  initial.searchParams.set('window_start.gte', String(BigInt(instant(query.range.fromInclusive)) * 1000000n));
  initial.searchParams.set('window_start.lt', String(BigInt(instant(query.range.toExclusive)) * 1000000n));
  initial.searchParams.set('sort', 'window_start.asc'); initial.searchParams.set('limit', '50000');
  const rows = [], pages = [], visited = new Set();
  const acquisitionStartedAt = new Date().toISOString();
  let next = initial, failure = null, excludedRows = 0, sourceRowCount = 0, previousTimestamp = null;
  const context = { contract, providerTicker, timeframe, calendar: plan, provider: 'MASSIVE_FUTURES', asOf, sourceAsOf };
  try {
    while (next) {
      requireTruth(pages.length < maxPages, 'PROVIDER_PAGE_BUDGET_EXCEEDED');
      const requestHash = hash(next.toString());
      requireTruth(!visited.has(requestHash), 'PROVIDER_CURSOR_CYCLE'); visited.add(requestHash);
      const page = await fetchPage(next, { fetchImpl, apiKey, attempts, timeoutMs, signal, sleep });
      requireTruth(page && Array.isArray(page.results) && (!page.status || page.status === 'OK'), 'INVALID_PROVIDER_RESULTS');
      sourceRowCount += page.results.length;
      requireTruth(sourceRowCount <= maxRows, 'PROVIDER_ROW_BUDGET_EXCEEDED');
      pages.push({ pageNumber: pages.length + 1, requestHash, rowCount: page.results.length });
      for (const row of page.results) {
        requireTruth(typeof row?.window_start === 'string' && /^\d{16,20}$/.test(row.window_start), 'EXACT_NANOSECOND_TIMESTAMP_REQUIRED');
        const stamp = BigInt(row.window_start);
        requireTruth(previousTimestamp === null || stamp >= previousTimestamp, 'NONMONOTONIC_PROVIDER_PAGE');
        previousTimestamp = stamp;
        const lo = BigInt(instant(query.range.fromInclusive)) * 1000000n, hi = BigInt(instant(query.range.toExclusive)) * 1000000n;
        if (stamp < lo || stamp >= hi) { excludedRows++; continue; }
        rows.push(row);
      }
      next = page.next_url ? safePageUrl(page.next_url, initial) : null;
    }
    const normalized = normalizeRawRows(rows, context);
    const quality = assessCoverage(normalized.records, plan, true, asOf, noTrades);
    return { schemaVersion: 'engine11.acquisition.v1', status: 'COMPLETE', query, calendar: plan,
      records: normalized.records, quality: { ...quality, duplicates: normalized.duplicates },
      receipt: { provider: context.provider, acquisitionStartedAt, observedAt: new Date().toISOString(), asOf, sourceAsOf, pages, excludedRows,
        rawRevisionIds: normalized.records.map(x => x.rawRevisionId), failure: null } };
  } catch (error) {
    failure = error instanceof CandleError ? error.code : 'ACQUISITION_FAILED';
  }
  // Partial/conflicting pages never masquerade as a publishable dataset.
  return { schemaVersion: 'engine11.acquisition.v1', status: 'INCOMPLETE', query, calendar: plan, records: [],
    quality: { acquisitionComplete: false, coverageComplete: false, gaps: [], reasonCodes: [failure] },
    receipt: { provider: context.provider, acquisitionStartedAt, observedAt: new Date().toISOString(), asOf, sourceAsOf, pages, excludedRows, rawRevisionIds: [], failure } };
}
