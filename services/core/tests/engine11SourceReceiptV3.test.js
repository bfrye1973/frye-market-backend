import test from 'node:test';
import assert from 'node:assert/strict';
import {captureReceiptV3,sanitizeMassiveAggregateRequest} from
  '../logic/engine11/sourceReceiptV3/captureReceiptV3.js';
import {parseBody,sha256} from '../logic/engine11/sourceObservationsV2/evidence.js';

const base='https://api.polygon.io/futures/v1/aggs/ESZ6?resolution=1min&window_start.gte=2026-11-18&window_start.lte=2026-11-19&sort=asc&limit=50000&apiKey=SUPER_SECRET';
const row=(close=6001)=>'{"window_start":1795000000000000000,"open":6000,"high":6002,"low":5999,"close":'+close+',"volume":14}';
const source=(close=6001)=>Buffer.from('{"results":['+row(close)+'],"status":"OK"}');
const make=(body=source(),override={})=>captureReceiptV3({
  request:base,body,physicalContract:'ESZ6',frame:'1m',
  requestStartedAtMs:1795000010000,firstByteAtMs:1795000010020,
  bodyCompletedAtMs:1795000010040,requestToFirstByteMonoMs:20,
  requestToBodyMonoMs:40,resolver:{resolvedSymbol:'ESZ6',
    selectionRule:'env_contract_override',checkedAt:'2026-11-18T12:00:00Z'},
  ...override,
});
test('v3 sanitizes credentials and supports live lte request',()=>{
 const s=sanitizeMassiveAggregateRequest(base);
 assert.equal(s.apiKeyRemoved,true);
 assert.match(s.url,/window_start.lte=/);
 assert.doesNotMatch(s.url,/SUPER_SECRET|apiKey/);
 const receipt=make();
 assert.equal(receipt.bodyRetained,false);
 assert.equal(receipt.sourceTrustVerified,false);
 assert.equal(receipt.clock.status,'UNVERIFIED');
 assert.equal(receipt.providerFinality,'UNKNOWN');
 assert.doesNotMatch(JSON.stringify(receipt),/SUPER_SECRET|bodyBase64|rowBase64/);
});
test('v3 row digests use exact pinned v2 byte spans',()=>{
 const bytes=source();
 const r=make(bytes);
 const parsed=parseBody(bytes);
 assert.equal(r.observations[0].rowDigest,
   sha256(bytes.subarray(parsed.rows[0].byteStart,parsed.rows[0].byteEnd)));
 assert.equal(r.observations[0].windowStartNs,'1795000000000000000');
 assert.equal(r.bodySha256,sha256(bytes));
 assert.equal(r.bodyBytes,bytes.length);
});
test('v3 observed changes produce distinct row and receipt digests',()=>{
 const a=make(source(6001)),b=make(source(6000));
 assert.notEqual(a.observations[0].rowDigest,b.observations[0].rowDigest);
 assert.notEqual(a.receiptId,b.receiptId);
});
test('v3 rejects unsafely timed or mismatched observations',()=>{
 assert.throws(()=>make(source(),{bodyCompletedAtMs:1795000010010}),/V3_RECEIPT_TIME_ORDER/);
 assert.throws(()=>make(source(),{physicalContract:'ESH7'}),/V3_CONTRACT_REQUEST_MISMATCH/);
 assert.throws(()=>make(source(),{request:base+'&evil=1'}),/V3_UNSAFE_QUERY_PARAMETER/);
 assert.throws(()=>make(Buffer.from('{"results":[{"window_start":1,"window_start":2}]}')),/V2_DUPLICATE_JSON_KEY/);
});
test('v3 rejects unsanitized paginated URLs, never leaks keys',()=>{
 const bad=Buffer.from('{"results":[],"next_url":"https://other.example/aggs?token=secret"}');
 assert.throws(()=>make(bad),/V3_UNSAFE_ORIGIN/);
 const okay=Buffer.from('{"results":[],"next_url":"https://api.polygon.io/futures/v1/aggs/ESZ6?limit=100&apiKey=secret"}');
 assert.doesNotMatch(make(okay).nextUrl,/apiKey|secret/);
});
