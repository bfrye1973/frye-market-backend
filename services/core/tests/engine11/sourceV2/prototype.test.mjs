import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureReceipt,parseBody,bindingFromMetadata,sha256 } from '../../../logic/engine11/sourceObservationsV2/evidence.js';
import { buildSourceDataset,correspondenceReport } from '../../../logic/engine11/sourceObservationsV2/dataset.js';
import { createSourceReader } from '../../../logic/engine11/sourceObservationsV2/reader.js';
import { acquireSourceObservations } from '../../../logic/engine11/sourceObservationsV2/provider.js';
const asOf='2026-10-12T23:00:00.000Z',ticker='ESU6',request='https://api.massive.com/futures/v1/aggs/ESU6?resolution=4hour';
const row={ticker,window_start:'1788984000000000000',session_end_date:'2026-09-09',open:7644.5,high:7648.25,low:7642.5,close:7648,volume:37522};
const encode=rows=>JSON.stringify({status:'OK',results:rows}).replace(/"window_start":"(\d+)"/g,'"window_start":$1');
const receipt=(rows,overrides={})=>captureReceipt({request,body:Buffer.from(encode(rows)),captureId:'fixture-a',observedAt:asOf,evidenceKind:'FIXTURE',...overrides});
const meta=captureReceipt({request:'https://api.massive.com/futures/v1/contracts?ticker=ESU6',captureId:'fixture-metadata',observedAt:asOf,evidenceKind:'FIXTURE',body:Buffer.from(JSON.stringify({status:'OK',results:[{ticker,product_code:'ES',trading_venue:'XCME',settlement_date:'2026-09-18',first_trade_date:'2023-08-21',last_trade_date:'2026-09-18'}]}))});
const binding={contract:'ESU2026',ticker,metadataReceipt:meta};
const dataset=(receipts)=>buildSourceDataset({receipts:[meta,...receipts],bindings:[binding]});
const reader=d=>createSourceReader(d,{cursorSecret:'fixture-secret-minimum-32-characters'});
test('exact original response and nanosecond spelling retained',()=>{
  const r=receipt([row]);assert.equal(r.bodySha256,sha256(Buffer.from(encode([row]))));
  assert.equal(r.observations[0].payload.window_start,row.window_start);assert.ok(Buffer.from(r.observations[0].rowBase64,'base64').toString().includes(':1788984000000000000'));
});
test('UTF8 row spans are byte positions with non-ASCII prefix and unknown fields',()=>{
  const raw=Buffer.from('{"note":"é🎯","results":[{"window_start":1788984000000000000,"extra":"ñ"}],"status":"OK"}');
  const p=parseBody(raw);assert.equal(JSON.parse(raw.subarray(p.rows[0].byteStart,p.rows[0].byteEnd).toString()).extra,'ñ');
});
test('duplicate JSON keys preserved as unparseable receipt, never last value wins',()=>{
  const r=receipt([],{body:Buffer.from('{"results":[{"ticker":"ESU6","ticker":"ESZ6"}]}')});assert.equal(r.parseFailure,'V2_DUPLICATE_JSON_KEY');assert.equal(r.observations.length,0);assert.ok(r.bodyBase64);
});
test('invalid UTF8 preserves body and fails parsed identity',()=>assert.ok(receipt([],{body:Buffer.from([0xff])}).parseFailure));
test('nonfinite/unsafe unknown numeric fields retain numeric lexemes',()=>{
  const p=parseBody(Buffer.from('{"results":[{"large":9007199254740993,"huge":1e999}]}'));assert.equal(p.rows[0].payload.large.numericLexeme,'9007199254740993');assert.equal(p.rows[0].payload.huge.numericLexeme,'1e999');
});
test('receipt body limit fails without provisioning storage',()=>assert.throws(()=>receipt([],{body:Buffer.alloc(8*1024*1024+1)})));
test('duplicate occurrence IDs and repeat receipt IDs remain distinct',()=>{
  const a=receipt([row,row]),b=receipt([row],{captureId:'fixture-b'});assert.notEqual(a.observations[0].observationId,a.observations[1].observationId);assert.notEqual(a.receiptId,b.receiptId);
});
test('shared timestamp with different sessions has distinct keys and revisions',()=>{
  const d=dataset([receipt([row,{...row,session_end_date:'2026-09-10',close:7652}])]);assert.notEqual(d.rows[0].sourceKey,d.rows[1].sourceKey);assert.ok(d.rows.every(x=>!x.structuralEligible&&x.analyticalInterval===null));
});
test('changed same-key payloads retained and correction remains unaccepted',()=>{
  const d=dataset([receipt([row,{...row,close:7652}])]);assert.equal(d.rows[0].sourceKey,d.rows[1].sourceKey);assert.notEqual(d.rows[0].sourceRevisionId,d.rows[1].sourceRevisionId);assert.equal(d.rows[0].revisionClassification,'SAME_KEY_CHANGED_CONTENT_UNCLASSIFIED');assert.equal(d.rows[0].correctionAccepted,false);
});
test('repeat equal content retains each occurrence without correction',()=>{
  const d=dataset([receipt([row,row])]);assert.equal(d.rows[0].sourceRevisionId,d.rows[1].sourceRevisionId);assert.equal(d.rows[0].revisionClassification,'REPEATED_IDENTICAL_CONTENT');
});
test('different byte formatting with same parsed content is not a correction',()=>{
  const a=receipt([row]),b=receipt([row],{captureId:'different',body:Buffer.from(JSON.stringify({status:'OK',results:[row]},null,2).replace(/"window_start": "(\d+)"/g,'"window_start": $1'))});
  assert.equal(dataset([a,b]).rows[0].revisionClassification,'EQUIVALENT_PARSED_CONTENT_DISTINCT_BYTES');
});
test('missing binding preserves observation without global source key',()=>{
  const d=buildSourceDataset({receipts:[receipt([row])]});assert.equal(d.rows[0].sourceKey,null);assert.equal(d.rows[0].identityState,'FULL_CONTRACT_BINDING_UNRESOLVED');
});
test('missing session and malformed date keep original payloads',()=>{
  const d=dataset([receipt([{...row,session_end_date:null},{...row,session_end_date:'2026-02-31'}])]);assert.ok(d.rows.every(x=>x.sourceKey===null));assert.equal(d.rows.length,2);
});
test('short alias cannot bind to wrong decade',()=>assert.throws(()=>bindingFromMetadata('ESU2016',ticker,meta)));
test('metadata source must be archived dependency',()=>assert.throws(()=>buildSourceDataset({receipts:[receipt([row])],bindings:[binding]})));
test('source dates outside verified contract lifespan remain unresolved',()=>assert.equal(dataset([receipt([{...row,session_end_date:'2016-09-09'}])]).rows[0].sourceKey,null));
test('ambiguous bindings for same reused ticker rejected',()=>assert.throws(()=>buildSourceDataset({receipts:[meta,receipt([row])],bindings:[binding,binding]})));
test('signed paging traverses timestamp ties and returns each observation exactly once',()=>{
  const d=dataset([receipt([row,{...row,session_end_date:'2026-09-10'},row])]);const read=reader(d);let cursor=null,ids=[];
  do{const args={datasetVersion:d.datasetVersion,asOf,limit:1,cursor};const p=read(args);assert.deepEqual(p,read(args));ids.push(...p.rows.map(x=>x.observationId));cursor=p.nextCursor;}while(cursor);
  assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
});
test('cursor tamper and query drift fail closed',()=>{
  const d=dataset([receipt([row,row])]),read=reader(d),args={datasetVersion:d.datasetVersion,asOf,limit:1};const p=read(args);
  assert.throws(()=>read({...args,cursor:p.nextCursor.slice(0,-1)+'g'}));assert.throws(()=>read({...args,limit:2,cursor:p.nextCursor}));assert.throws(()=>read({...args,asOf:'2026-10-13T00:00:00Z',cursor:p.nextCursor}));
});
test('no latest fallback, execution or structural reader purpose',()=>{
  const d=dataset([receipt([row])]),read=reader(d);assert.throws(()=>read({datasetVersion:'latest',asOf}));for(const purpose of ['execution','STRUCTURAL','chart'])assert.throws(()=>read({datasetVersion:d.datasetVersion,asOf,purpose}));
});
test('as-of before any dependency refuses future observation evidence',()=>{
  const d=dataset([receipt([row])]);assert.throws(()=>reader(d)({datasetVersion:d.datasetVersion,asOf:'2026-10-12T22:00:00Z'}));
});
test('serialized snapshot is readable and tampered content is rejected',()=>{
  const d=JSON.parse(JSON.stringify(dataset([receipt([row])])));reader(d);d.rows[0].payload.close=1;assert.throws(()=>reader(d));
});
test('receipt corruption rejected before dataset grouping',()=>{
  const r=JSON.parse(JSON.stringify(receipt([row])));r.bodyBase64=Buffer.from(encode([{...row,close:1}])).toString('base64');assert.throws(()=>dataset([r]));
});
test('v1 timestamp alias correspondence is append-only one-to-many',()=>{
  const d=dataset([receipt([row,{...row,session_end_date:'2026-09-10'}])]);const old={v1Id:'ES:4h:timestamp',providerTicker:ticker,sourceResolution:'4hour',sourceTimestampNs:row.window_start};const r=correspondenceReport(d,[old]);assert.equal(r[0].status,'ONE_TO_MANY');assert.equal(r[0].migrationApproved,false);assert.equal(old.v1Id,'ES:4h:timestamp');
});
test('authentic archived 2020/2026 original bodies preserve each conflict; no fixture contract proof promoted',()=>{
  const evidence=JSON.parse(readFileSync('docs/architecture/ENGINE11_ES_ALIGNMENT_ORIGINAL_BODY_EVIDENCE_V1.json','utf8'));
  for(const sample of evidence.observations){const body=sample.data['4hour'];const r=captureReceipt({request:`https://api.massive.com/futures/v1/aggs/${sample.ticker}?resolution=4hour`,body:Buffer.from(body.originalSuccessBodyText),captureId:'archived-'+sample.ticker,observedAt:sample.observedAt,evidenceKind:'ARCHIVED_ORIGINAL_BODY_TEXT'});assert.equal(r.bodySha256,body.bodyUtf8Sha256);assert.equal(r.observations.length,2);assert.notEqual(r.observations[0].payload.session_end_date,r.observations[1].payload.session_end_date);assert.equal(buildSourceDataset({receipts:[r]}).rows[0].sourceKey,null);}
});
test('provider capture archives original HTTP body bytes without credential URLs',async()=>{
  const a=await acquireSourceObservations({request,apiKey:'fixture-secret',fetchImpl:async(url,options)=>{assert.ok(options.headers.Authorization.includes('fixture-secret'));assert.ok(!url.includes('fixture-secret'));return new Response(encode([row]),{status:200});}});
  assert.equal(a.status,'COMPLETE_TRAVERSAL');assert.equal(a.receipts[0].bodySha256,sha256(Buffer.from(encode([row]))));
});
test('provider denial preserves explicit unavailability',async()=>assert.equal((await acquireSourceObservations({request,apiKey:'fixture-secret',fetchImpl:async()=>new Response('',{status:403})})).failure,'V2_ENTITLEMENT_DENIED'));
test('provider same-timestamp page boundary retains both sessions',async()=>{
  let n=0;const a=await acquireSourceObservations({request,apiKey:'fixture-secret',fetchImpl:async()=>new Response(JSON.stringify({status:'OK',results:[{...row,session_end_date:n++?'2026-09-10':'2026-09-09'}],...(n===1?{next_url:request+'&cursor=next'}:{})}))});assert.equal(a.receipts.length,2);assert.equal(a.rowCount,2);
});
test('provider unsafe cursor cannot transmit credentials',async()=>{
  let calls=0;const a=await acquireSourceObservations({request,apiKey:'fixture-secret',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({status:'OK',results:[row],next_url:'https://evil.example/steal'}));}});assert.equal(a.status,'INCOMPLETE');assert.equal(calls,1);assert.equal(a.receipts.length,1);
});
test('page/row budget exhaustion is not completed acquisition',async()=>{
  const a=await acquireSourceObservations({request,apiKey:'fixture-secret',maxPages:1,fetchImpl:async()=>new Response(JSON.stringify({status:'OK',results:[row],next_url:request+'&cursor=next'}))});assert.equal(a.status,'INCOMPLETE');assert.equal(a.failure,'V2_PAGE_BUDGET_EXCEEDED');
});
