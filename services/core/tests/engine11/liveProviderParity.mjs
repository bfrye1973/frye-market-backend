// Read-only authentic provider probe. Explicit research plan is NOT an approved
// exchange calendar or structural-source acceptance. No persistence/consumer use.
import assert from 'node:assert/strict';
import { acquireRawEs, parseProviderJson } from '../../logic/engine11/rawCandles/provider.js';

const apiKey = process.env.POLYGON_API_KEY || process.env.POLYGON_API || process.env.POLY_API_KEY;
if (!apiKey) {
  console.log(JSON.stringify({ status: 'SOURCE_UNAVAILABLE', reason: 'PROVIDER_CREDENTIAL_UNAVAILABLE', authenticProof: false }));
  process.exit(process.env.ENGINE11_REQUIRE_LIVE_PROOF === '1' ? 1 : 0);
}
const from = '2026-09-10T13:00:00.000Z', to = '2026-09-10T13:30:00.000Z';
const calendar = { exchange: 'CME', version: 'RESEARCH_NATIVE_REVIEW_PENDING', alignmentVersion: 'NATIVE_10MIN_REVIEW_PENDING',
  evidenceId: 'RESEARCH_INTERVAL_PLAN_NOT_STRUCTURAL_ACCEPTANCE', timeframe: '10m', intervals: [0, 1, 2].map(i => ({
    start: new Date(Date.parse(from) + i * 600000).toISOString(), endExclusive: new Date(Date.parse(from) + (i + 1) * 600000).toISOString(),
    kind: 'OPEN', sessionId: 'RESEARCH_20260910', tradingDate: '2026-09-10', closeConvention: 'LAST_TRADE',
    finalityEvidenceId: 'UNVERIFIED_PROVIDER_FINALITY' })) };
let failed = false;
for (const [contract, providerTicker] of [['ESU2026', 'ESU6'], ['ESZ2026', 'ESZ6']]) {
  const nativeRows = [];
  const result = await acquireRawEs({ contract, providerTicker, timeframe: '10m', from, to, calendar,
    asOf: new Date().toISOString(), sourceAsOf: null, apiKey, baseUrl: 'https://api.polygon.io',
    attempts: 2, maxPages: 5, maxRows: 1000,
    fetchImpl: async (url, options) => {
      const response = await fetch(url, options), text = await response.text();
      if (response.ok) nativeRows.push(...(parseProviderJson(text).results || []));
      return { ok: response.ok, status: response.status, headers: response.headers, text: async () => text };
    } });
  if (result.status !== 'COMPLETE' || !result.records.length) {
    failed = true;
    console.log(JSON.stringify({ contract, providerTicker, status: 'SOURCE_UNAVAILABLE', reason: result.receipt.failure || 'NO_AUTHENTIC_ROWS', authenticProof: false }));
    continue;
  }
  for (const record of result.records) {
    const native = nativeRows.find(row => row.window_start === record.sourceTimestampNs);
    assert.ok(native);
    for (const field of ['open', 'high', 'low', 'close', 'volume']) assert.equal(record[field], native[field] ?? null);
    assert.equal(record.completionState, 'UNKNOWN'); assert.equal(record.structuralEligible, false);
  }
  console.log(JSON.stringify({ contract, providerTicker, status: 'AUTHENTIC_RAW_PARITY_PASS', authenticProof: true,
    count: result.records.length, pages: result.receipt.pages.length, rawRevisionIds: result.records.map(x => x.rawRevisionId),
    first: result.records[0].intervalStart, last: result.records.at(-1).intervalStart,
    coverageComplete: result.quality.coverageComplete, structuralEligible: false, calendarAccepted: false }));
}
if (failed) process.exitCode = 1;
