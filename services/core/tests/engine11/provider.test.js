import test from 'node:test';
import assert from 'node:assert/strict';
import { acquisition, response, row, FROM, TO, plan } from './fixtures.js';
import { acquireRawEs, parseProviderJson } from '../../logic/engine11/rawCandles/provider.js';

test('numeric provider timestamp is preserved before JSON parse', () => {
  const text = '{"results":[{"window_start":1791810000000000000,"close":7800.25}]}';
  assert.equal(parseProviderJson(text).results[0].window_start, '1791810000000000000');
});
test('real adapter request uses explicit ticker, exclusive range and no URL credential', async () => {
  let request;
  const result = await acquisition({ fetchImpl: async (url, options) => {
    request = { url: new URL(url), options }; return response({ results: [row(0), row(1), row(2)] });
  } });
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.quality.coverageComplete, true);
  assert.equal(request.url.pathname, '/futures/v1/aggs/ESZ6'); assert.equal(request.url.searchParams.has('apiKey'), false);
  assert.equal(request.url.searchParams.get('sort'), 'window_start.asc'); assert.equal(request.options.headers.Authorization, 'Bearer fixture-credential');
  assert.ok(!JSON.stringify(result).includes('fixture-credential'));
});
test('multiple pages traverse fully and deduplicate boundaries', async () => {
  let n = 0;
  const result = await acquisition({ fetchImpl: async () => ++n === 1 ? response({ results: [row(0), row(1)], next_url: 'https://api.massive.com/futures/v1/aggs/ESZ6?cursor=next' }) : response({ results: [row(1), row(2)] }) });
  assert.equal(result.records.length, 3); assert.equal(result.receipt.pages.length, 2); assert.equal(result.quality.duplicates.length, 1);
});
test('interrupted later page never exposes partial publishable records', async () => {
  let n = 0;
  const result = await acquisition({ attempts: 1, fetchImpl: async () => ++n === 1 ? response({ results: [row()], next_url: 'https://api.massive.com/futures/v1/aggs/ESZ6?cursor=next' }) : response({}, 503) });
  assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.records.length, 0); assert.equal(result.quality.coverageComplete, false);
});
for (const next_url of ['https://evil.test/futures/v1/aggs/ESZ6', 'http://api.massive.com/futures/v1/aggs/ESZ6',
  'https://api.massive.com/futures/v1/aggs/ESU6', 'https://user:pass@api.massive.com/futures/v1/aggs/ESZ6',
  'https://api.massive.com/futures/v1/aggs/ESZ6?resolution=5min', 'https://api.massive.com/futures/v1/aggs/ESZ6#secret']) {
  test('unsafe pagination rejected ' + next_url, async () => {
    let calls = 0; const result = await acquisition({ fetchImpl: async () => { calls++; return response({ results: [row()], next_url }); } });
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(calls, 1);
  });
}
test('credential in vendor next URL is stripped and not persisted', async () => {
  let n = 0;
  const result = await acquisition({ fetchImpl: async url => {
    if (++n === 1) return response({ results: [row(0)], next_url: 'https://api.massive.com/futures/v1/aggs/ESZ6?cursor=next&apiKey=vendor-secret' });
    assert.ok(!url.includes('vendor-secret')); return response({ results: [row(1), row(2)] });
  } });
  assert.equal(result.status, 'COMPLETE'); assert.ok(!JSON.stringify(result).includes('vendor-secret'));
});
test('cursor cycle fails instead of repeating old page', async () => {
  const result = await acquisition({ fetchImpl: async () => response({ results: [], next_url: 'https://api.massive.com/futures/v1/aggs/ESZ6?cursor=cycle' }) });
  assert.equal(result.receipt.failure, 'PROVIDER_CURSOR_CYCLE');
});
test('page budget reports incomplete rather than truncating silently', async () => {
  const result = await acquisition({ maxPages: 1, fetchImpl: async () => response({ results: [row()], next_url: 'https://api.massive.com/futures/v1/aggs/ESZ6?cursor=next' }) });
  assert.equal(result.receipt.failure, 'PROVIDER_PAGE_BUDGET_EXCEEDED'); assert.equal(result.records.length, 0);
});
test('row budget reports incomplete', async () => {
  const result = await acquisition({ maxRows: 2 }); assert.equal(result.receipt.failure, 'PROVIDER_ROW_BUDGET_EXCEEDED');
});
test('429 retries within budget and succeeds', async () => {
  let n = 0, waited;
  const result = await acquisition({ sleep: async ms => { waited = ms; }, fetchImpl: async () => ++n === 1 ? response({}, 429, { 'retry-after': '1' }) : response({ results: [row(0), row(1), row(2)] }) });
  assert.equal(n, 2); assert.equal(waited, 1000); assert.equal(result.status, 'COMPLETE');
});
test('entitlement error has no retry or credential-bearing exception', async () => {
  let n = 0;
  const result = await acquisition({ fetchImpl: async () => { n++; return response('sensitive provider body', 403); } });
  assert.equal(n, 1); assert.equal(result.receipt.failure, 'ENTITLEMENT_DENIED'); assert.ok(!JSON.stringify(result).includes('sensitive'));
});
test('transport errors do not leak URL or secret', async () => {
  const result = await acquisition({ attempts: 1, fetchImpl: async () => { throw Error('url with fixture-credential'); } });
  assert.equal(result.receipt.failure, 'PROVIDER_TRANSPORT_UNAVAILABLE'); assert.ok(!JSON.stringify(result).includes('fixture-credential'));
});
test('abort yields no partial records', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await acquisition({ signal: controller.signal }); assert.equal(result.receipt.failure, 'ACQUISITION_ABORTED');
});
test('invalid provider payload, conflicting revisions and missing fields fail closed', async () => {
  for (const body of ['not json', { results: {} }, { status: 'ERROR', results: [] }, { results: [row(), row(0, { close: 7800.5 })] }, { results: [row(0, { open: null })] }]) {
    const result = await acquisition({ fetchImpl: async () => response(body) }); assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.records.length, 0);
  }
});
test('provider snapped boundary rows do not enter half-open result', async () => {
  const result = await acquisition({ fetchImpl: async () => response({ results: [row(-1), row(0), row(1), row(2), row(3)] }) });
  assert.equal(result.records.length, 3); assert.equal(result.receipt.excludedRows, 2);
});
test('empty provider history is unknown, not complete coverage', async () => {
  const result = await acquisition({ fetchImpl: async () => response({ results: [] }) }); assert.equal(result.status, 'COMPLETE'); assert.equal(result.quality.coverageComplete, false);
  assert.equal(result.quality.gaps.length, 3);
});
test('future source watermark is rejected before fetching', async () => {
  await assert.rejects(acquisition({ sourceAsOf: '2026-10-13T00:00:00Z' }), { code: 'SOURCE_WATERMARK_AFTER_ASOF' });
});
test('fixture provider parity compares original OHLCV without transformation', async () => {
  const result = await acquisition();
  result.records.forEach((bar, i) => { const source = row(i); for (const key of ['open', 'high', 'low', 'close', 'volume']) assert.equal(bar[key], source[key]); });
  assert.equal(result.structuralEligible, undefined); result.records.forEach(bar => assert.equal(bar.structuralEligible, false));
});
test('nonmonotonic source page is invalid evidence, not silently sorted away', async () => {
  const result = await acquisition({ fetchImpl: async () => response({ results: [row(1), row(0)] }) });
  assert.equal(result.receipt.failure, 'NONMONOTONIC_PROVIDER_PAGE');
});
test('source row budget includes snapped/excluded rows on every page', async () => {
  let n = 0;
  const result = await acquisition({ maxRows: 2, fetchImpl: async () => ++n === 1 ?
    response({ results: [row(-2), row(-1)], next_url: 'https://api.massive.com/futures/v1/aggs/ESZ6?cursor=next' }) : response({ results: [row(0)] }) });
  assert.equal(result.receipt.failure, 'PROVIDER_ROW_BUDGET_EXCEEDED');
});
test('unknown next-url authentication parameters are rejected', async () => {
  const result = await acquisition({ fetchImpl: async () => response({ results: [], next_url: 'https://api.massive.com/futures/v1/aggs/ESZ6?api_key=secret' }) });
  assert.equal(result.receipt.failure, 'UNSAFE_PROVIDER_PAGE_PARAMETERS');
});
