import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRows, verifyContract, chicagoClock, probeAggregates, requestJson } from './coverageAudit.mjs';
const from = '2026-09-10T13:00:00.000Z', to = '2026-09-10T14:00:00.000Z';
const row = { ticker: 'ESU6', window_start: String(BigInt(Date.parse(from)) * 1000000n), open: 6500, high: 6501, low: 6499, close: 6500.25, volume: 10 };
const inspect = rows => inspectRows(rows, { ticker: 'ESU6', from, to, stepMs: 60000 });
test('fixture audit never certifies finality, calendar, coverage or structural eligibility', () => {
  const result = inspect([row]); assert.equal(result.sourceFinality, 'UNKNOWN');
  for (const flag of ['calendarAccepted', 'structuralEligible', 'coverageComplete']) assert.equal(result[flag], false);
});
test('nanosecond precision required', () => assert.deepEqual(inspect([{ ...row, window_start: Number(row.window_start) }]).errors, ['INEXACT_TIMESTAMP']));
test('full identity requires settlement year, not reused short ticker', () => {
  const rows = [{ ticker: 'ESH7', product_code: 'ES', settlement_date: '2027-03-19' }];
  assert.equal(verifyContract(rows, 'ESH7', 2017).verified, false);
  assert.equal(verifyContract(rows, 'ESH7', 2027).verified, true);
});
test('ambiguous metadata rejected', () => {
  const r = { ticker: 'ESH7', product_code: 'ES', settlement_date: '2017-03-17' };
  assert.equal(verifyContract([r, r], 'ESH7', 2017).verified, false);
});
test('identical duplicates and source conflicts distinguished', () => {
  assert.equal(inspect([row, row]).duplicates, 1);
  assert.equal(inspect([row, { ...row, close: 6500.5 }]).conflicts, 1);
});
test('session-label collisions remain distinct from same-label changed values', () => {
  const a = { ...row, session_end_date: '2026-09-10' };
  const b = { ...row, session_end_date: '2026-09-11' };
  assert.equal(inspect([a, b]).conflictSamples[0].classification, 'SOURCE_BUCKET_COLLISION_ACROSS_SESSION_LABELS');
  assert.equal(inspect([a, { ...a, close: 6500.5 }]).conflictSamples[0].classification, 'SAME_BUCKET_CHANGED_VALUES');
});
test('gap remains unknown, never silently holiday or no-trade', () => {
  const next = { ...row, window_start: String(BigInt(Date.parse(from) + 120000) * 1000000n) };
  assert.equal(inspect([row, next]).gapSamples[0].classification, 'UNKNOWN_SOURCE_ABSENCE');
});
test('UTC half-open bounds preserve snapped exclusions', () => {
  assert.equal(inspect([{ ...row, window_start: String(BigInt(Date.parse(to)) * 1000000n) }]).excluded, 1);
});
test('malformed prices, ticks, volume and ordering detected', () => {
  assert.ok(inspect([{ ...row, high: 6490 }]).errors.includes('INVALID_OHLC'));
  assert.ok(inspect([{ ...row, close: 6500.1 }]).errors.includes('INVALID_ES_PRICE'));
  assert.ok(inspect([{ ...row, volume: -1 }]).errors.includes('INVALID_VOLUME'));
  assert.ok(inspect([{ ...row, window_start: String(BigInt(Date.parse(from) + 60000) * 1000000n) }, row]).errors.includes('NONMONOTONIC'));
});
test('Chicago DST changes UTC session representation', () => {
  assert.match(chicagoClock('2026-03-06T23:00:00Z'), /17:00/);
  assert.match(chicagoClock('2026-03-09T22:00:00Z'), /17:00/);
  assert.match(chicagoClock('2026-11-02T23:00:00Z'), /17:00/);
});
test('pagination enforces bounded research and does not call partial evidence complete', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ results: [row], next_url: 'https://api.massive.com/futures/v1/aggs/ESU6?cursor=x' }) });
  const result = await probeAggregates({ ticker: 'ESU6', from, to, maxPages: 1, fetchImpl, apiKey: 'fixture' });
  assert.equal(result.failure, 'PAGE_BUDGET_EXCEEDED'); assert.equal(result.traversalComplete, false);
});
test('empty 200 is observed absence, not proven exchange closure', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{"results":[]}' });
  const result = await probeAggregates({ ticker: 'ESU6', from, to, fetchImpl, apiKey: 'fixture' });
  assert.equal(result.traversalComplete, true); assert.equal(result.inRangeRows, 0); assert.equal(result.coverageComplete, false);
});
test('entitlement denial produces explicit unavailable evidence', async () => {
  const result = await probeAggregates({ ticker: 'ESU6', from, to, apiKey: 'fixture', fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.equal(result.pages[0].status, 403); assert.equal(result.traversalComplete, false);
});
test('unsafe provider cursor is rejected', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ results: [row], next_url: 'https://evil.example/steal' }) });
  assert.equal((await probeAggregates({ ticker: 'ESU6', from, to, fetchImpl, apiKey: 'fixture' })).failure, 'UNSAFE_CURSOR');
});
test('successful body text capture preserves numeric nanosecond spelling separately from parsed payload',async()=>{
  const bodyText='{"results":[{"window_start":1788984000000000000}]}';
  const response=await requestJson('https://api.massive.com/futures/v1/aggs/ESU6',{apiKey:'fixture-secret',captureSuccessBody:true,fetchImpl:async()=>({ok:true,status:200,text:async()=>bodyText})});
  assert.equal(response.bodyText,bodyText);assert.equal(response.body.results[0].window_start,'1788984000000000000');
});
