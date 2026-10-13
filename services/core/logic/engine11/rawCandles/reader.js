import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, hash, instant, requireTruth, CandleError } from './identity.js';
import { validateReadWindow } from './store.js';

export function createRawReader({ store, cursorSecret } = {}) {
  requireTruth(store && typeof store.read === 'function' && typeof cursorSecret === 'string' && cursorSecret.length >= 32,
    'READER_CONFIGURATION_REQUIRED');
  const sign = text => createHmac('sha256', cursorSecret).update(text).digest('hex');
  function encode(body) { const text = Buffer.from(canonicalJson(body)).toString('base64url'); return text + '.' + sign(text); }
  function decode(cursor) {
    requireTruth(typeof cursor === 'string' && cursor.length <= 8192, 'INVALID_CURSOR');
    const [text, signature, extra] = cursor.split('.');
    requireTruth(!extra && /^[a-f0-9]{64}$/.test(signature || '') && /^[A-Za-z0-9_-]+$/.test(text || ''), 'INVALID_CURSOR');
    requireTruth(timingSafeEqual(Buffer.from(sign(text), 'hex'), Buffer.from(signature, 'hex')), 'INVALID_CURSOR');
    try { return JSON.parse(Buffer.from(text, 'base64url').toString()); } catch { throw new CandleError('INVALID_CURSOR'); }
  }
  return async function readPage({ datasetVersion, seriesId, timeframe, priceBasis = 'RAW_CONTRACT', from, to,
    limit = 1000, cursor = null, asOf = null, completedOnly = true, purpose = 'RESEARCH' } = {}) {
    requireTruth(['RESEARCH', 'CHART_REVIEW'].includes(purpose), 'CONSUMER_NOT_AUTHORIZED');
    requireTruth(priceBasis === 'RAW_CONTRACT' && typeof completedOnly === 'boolean' &&
      Number.isInteger(limit) && limit > 0 && limit <= 5000, 'INVALID_READ_QUERY');
    const dataset = await store.read(datasetVersion);
    requireTruth(dataset.seriesId === seriesId && dataset.query.timeframe === timeframe, 'SERIES_QUERY_MISMATCH');
    validateReadWindow(dataset, from, to, asOf);
    const pin = { datasetVersion, seriesId, timeframe, priceBasis, from, to, asOf, completedOnly, purpose,
      calendarVersion: dataset.calendar.version, alignmentVersion: dataset.calendar.alignmentVersion };
    const queryHash = hash(pin);
    let last = null;
    if (cursor) { const token = decode(cursor); requireTruth(token.queryHash === queryHash, 'CURSOR_PIN_MISMATCH'); last = token.last; }
    const rows = dataset.records.filter(x => instant(x.intervalStart) >= instant(from) && instant(x.intervalStart) < instant(to) &&
      (!completedOnly || x.completionState === 'COMPLETED'));
    const key = row => row.intervalStart + ':' + row.rawCandleId;
    if (last !== null) requireTruth(typeof last === 'string' && rows.some(x => key(x) === last), 'CURSOR_KEY_UNAVAILABLE');
    const remaining = rows.filter(x => last === null || key(x) > last);
    const bars = remaining.slice(0, limit), hasMore = remaining.length > bars.length;
    const response = { schemaVersion: 'engine11.rawRead.v1', ...pin, usageClass: 'ISOLATED_RESEARCH_ONLY', structuralEligible: false,
      bars, count: bars.length, hasMore, nextCursor: hasMore ? encode({ queryHash, last: key(bars.at(-1)) }) : null,
      truncated: !dataset.quality.coverageComplete, quality: dataset.quality };
    return { ...response, etag: '"' + hash(response) + '"' };
  };
}
