import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, hash, esContract, validateProviderAlias, instant, timestampNs, range, resolution } from '../../logic/engine11/rawCandles/identity.js';
import { normalizeRawCandle, normalizeRawRows } from '../../logic/engine11/rawCandles/normalize.js';
import { row, context } from './fixtures.js';

test('full expiration identity does not collide across decades', () => {
  assert.notEqual(esContract('ESZ2026').instrumentId, esContract('ESZ2036').instrumentId);
  assert.equal(esContract('ESH2027').expirationMonth, 3);
});
for (const value of ['ES', 'ESZ6', 'ESZ26', 'MESZ2026', 'NQZ2026', 'ESF2026', 'ESZ2026-M2027', '../ESZ2026']) {
  test('reject ambiguous or non-ES contract ' + value, () => assert.throws(() => esContract(value), { code: 'EXPLICIT_FULL_YEAR_ES_CONTRACT_REQUIRED' }));
}
test('aliases require the explicit full-year identity', () => {
  for (const alias of ['ESZ6', 'ESZ26', 'ESZ2026']) assert.equal(validateProviderAlias('ESZ2026', alias).expirationYear, 2026);
  assert.throws(() => validateProviderAlias('ESZ2026', 'ESU6'), { code: 'PROVIDER_CONTRACT_ALIAS_MISMATCH' });
});
test('stable canonical hash independent of key order', () => assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 })));
test('hash rejects undefined and nonfinite evidence', () => {
  for (const value of [NaN, Infinity, { x: undefined }]) assert.throws(() => canonicalJson(value));
});
test('UTC ranges reject date-only, offset and impossible dates', () => {
  for (const value of ['2026-10-12', '2026-10-12T13:00:00-07:00', '2026-02-30T00:00:00Z']) assert.throws(() => instant(value));
  assert.throws(() => range('2026-10-12T13:00:00Z', '2026-10-12T13:00:00Z'));
});
test('exact nanoseconds never pass through an unsafe JS number', () => {
  const value = row().window_start;
  assert.equal(timestampNs(value).sourceTimestampNs, value);
  assert.throws(() => timestampNs(Number(value)));
  assert.throws(() => timestampNs(String(BigInt(value) + 1n)));
});
test('unsupported weekly/monthly has no minute fallback', () => {
  for (const tf of ['1w', '1mo', 'banana', '1day']) assert.throws(() => resolution(tf), { code: 'UNSUPPORTED_RAW_TIMEFRAME' });
  assert.equal(resolution('1d'), '1session');
});
test('raw identity survives different retrieval clocks', () => {
  const a = normalizeRawCandle(row(), context()), b = normalizeRawCandle(row(), context({ asOf: '2026-10-13T00:00:00Z' }));
  assert.equal(a.rawCandleId, b.rawCandleId); assert.deepEqual(a.raw, b.raw);
});
test('correction keeps source key but creates new immutable revision', () => {
  const a = normalizeRawCandle(row(), context()), b = normalizeRawCandle(row(0, { close: 7800.5 }), context());
  assert.equal(a.sourceKey, b.sourceKey); assert.notEqual(a.rawRevisionId, b.rawRevisionId);
});
test('overlapping contracts retain distinct identity', () => {
  const a = normalizeRawCandle(row(), context()), b = normalizeRawCandle(row(0, { ticker: 'ESU6' }), context({ contract: 'ESU2026', providerTicker: 'ESU6' }));
  assert.notEqual(a.sourceKey, b.sourceKey);
});
for (const bad of [{ open: null }, { open: '7800' }, { high: 7790 }, { low: 7802 }, { close: NaN },
  { close: 7800.1 }, { volume: -1 }, { volume: '10' }, { volume: 1.5 }, { ticker: 'ESU6' },
  { session_end_date: '2026-10-13' }, { transactions: -1 }, { settlement_price: '7800' }]) {
  test('invalid raw evidence rejected ' + JSON.stringify(bad), () => assert.throws(() => normalizeRawCandle(row(0, bad), context())));
}
test('missing volume remains unknown, raw OHLC unchanged', () => {
  const candle = normalizeRawCandle(row(0, { volume: null }), context());
  assert.equal(candle.volume, null); assert.equal(candle.priceBasis, 'RAW_CONTRACT'); assert.equal(candle.adjustmentPoints, 0);
  assert.equal(candle.open, row().open); assert.equal(candle.structuralEligible, false);
});
test('identical duplicate idempotent; conflicting revision fails closed', () => {
  const data = normalizeRawRows([row(0), row(0)], context()); assert.equal(data.records.length, 1); assert.equal(data.duplicates.length, 1);
  assert.throws(() => normalizeRawRows([row(0), row(0, { volume: 11 })], context()), { code: 'CONFLICTING_SOURCE_REVISION' });
});
test('absent source watermark cannot manufacture finality', () => {
  assert.equal(normalizeRawCandle(row(), context({ sourceAsOf: null })).completionState, 'UNKNOWN');
  assert.equal(normalizeRawCandle(row(), context({ sourceAsOf: '2026-10-12T13:00:30Z' })).completionState, 'UNKNOWN');
});
test('direct normalization rejects future source watermark', () => {
  assert.throws(() => normalizeRawCandle(row(), context({ sourceAsOf: '2026-10-13T00:00:00Z' })), { code: 'SOURCE_WATERMARK_AFTER_ASOF' });
});
