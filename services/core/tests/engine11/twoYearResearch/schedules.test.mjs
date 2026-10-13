import test from 'node:test';
import assert from 'node:assert/strict';
import { safeResearchUrl,scheduleLedger,capturePages } from '../../../logic/engine11/twoYearResearchV1/schedules.js';
const row=(event,timestamp)=>({product_code:'ES',product_name:'E-mini S&P 500 Futures',trading_venue:'XCME',session_end_date:'2026-09-10',event,timestamp});
const ordinary=[row('pre_open','2026-09-09T21:45:00+00:00'),row('open','2026-09-09T22:00:00+00:00'),row('close','2026-09-10T21:00:00+00:00')];
const ledger=rows=>scheduleLedger(rows,{from:'2026-09-10',through:'2026-09-12',traversalComplete:true});
test('date ledger retains each requested date including absent weekend proof',()=>{const r=ledger(ordinary);assert.equal(r.dates.length,3);assert.equal(r.providerCandidateDates,1);assert.equal(r.dates[2].state,'UNKNOWN_NO_SCHEDULE_EVENTS');});
test('provider candidate is never an exchange-approved calendar',()=>{const r=ledger(ordinary);assert.equal(r.dates[0].state,'PROVIDER_SCHEDULE_CANDIDATE');assert.equal(r.calendarAccepted,false);assert.equal(r.structuralEligible,false);});
test('intraday interruption and reopen retain matching segments',()=>{const r=ledger([ordinary[1],row('pause','2026-09-10T17:00:00Z'),row('open','2026-09-10T17:15:00Z'),ordinary[2]]);assert.equal(r.dates[0].matchingSegments.length,2);});
test('unsupported events, missing closes and event ties remain unavailable',()=>{assert.equal(ledger([...ordinary,row('unknown','2026-09-10T18:00:00Z')]).dates[0].state,'UNKNOWN_EVENT_SEMANTICS');assert.equal(ledger(ordinary.slice(0,2)).dates[0].state,'UNKNOWN_INCOMPLETE_SESSION_EVENTS');assert.equal(ledger([...ordinary,row('pause',ordinary[1].timestamp)]).dates[0].state,'UNKNOWN_EVENT_TIMESTAMP_TIE');});
test('wrong product and venue cannot fill ES coverage',()=>{assert.equal(ledger(ordinary.map(x=>({...x,product_code:'NQ'}))).providerCandidateDates,0);assert.equal(ledger(ordinary.map(x=>({...x,trading_venue:'XNYM'}))).unscoped.length,3);});
test('incomplete page traversal quarantines date coverage',()=>assert.equal(scheduleLedger(ordinary,{from:'2026-09-10',through:'2026-09-10',traversalComplete:false}).dates[0].state,'UNKNOWN_INCOMPLETE_TRAVERSAL'));
test('pagination refuses staging examples, cross-path URLs and changed date bounds',()=>{
 const start='https://api.massive.com/futures/v1/schedules?product_code=ES&session_end_date.gte=2024-10-12';
 assert.throws(()=>safeResearchUrl('https://api.staging.massive.com/futures/v2/schedules?cursor=x',start));assert.throws(()=>safeResearchUrl('https://api.massive.com/futures/v1/contracts',start));assert.throws(()=>safeResearchUrl('https://api.massive.com/futures/v1/schedules?session_end_date.gte=2025-01-01',start));
});
test('signed-in provider secret stays in header and original body bytes survive paging',async()=>{
 let n=0;const request='https://api.massive.com/futures/v1/schedules?product_code=ES';
 const a=await capturePages({request,apiKey:'fixture-secret',fetchImpl:async(url,opts)=>{assert.ok(opts.headers.Authorization.includes('fixture-secret'));assert.ok(!url.includes('fixture-secret'));return new Response(JSON.stringify({status:'OK',results:[ordinary[n++]],...(n===1?{next_url:request+'&cursor=next'}:{})}));}});assert.equal(a.rows.length,2);assert.equal(a.receipts.length,2);assert.ok(a.receipts[0].bodyBase64);assert.equal(a.traversalComplete,true);
});
test('actual denial and bounded exhaustion are explicit negative evidence',async()=>{
 const request='https://api.massive.com/futures/v1/schedules';assert.equal((await capturePages({request,apiKey:'fixture-secret',fetchImpl:async()=>new Response('',{status:403})})).failure,'HTTP_403');
 const a=await capturePages({request,apiKey:'fixture-secret',maxPages:1,fetchImpl:async()=>new Response(JSON.stringify({status:'OK',results:[],next_url:request+'?cursor=x'}))});assert.equal(a.failure,'PAGE_BUDGET');assert.equal(a.traversalComplete,false);
});
test('repeated events cannot silently certify or deduplicate a schedule',()=>assert.equal(ledger([...ordinary,ordinary[1]]).dates[0].state,'UNKNOWN_REPEATED_SCHEDULE_EVENT'));
test('invalid or unbounded ledger dates rejected',()=>{assert.throws(()=>scheduleLedger([],{from:'2026-02-31',through:'2026-03-01',traversalComplete:true}));assert.throws(()=>scheduleLedger([],{from:'2020-01-01',through:'2026-01-01',traversalComplete:true}));});
test('credentials and finite acquisition budgets required before network',async()=>assert.rejects(()=>capturePages({request:'https://api.massive.com/futures/v1/schedules',apiKey:'',fetchImpl:async()=>{throw new Error('should not call');}})));
test('calendar spreads and unknown labels never complete outright ES dates',()=>{const spread=ordinary.map(x=>({...x,product_name:'ES Equity Calendar Spread'}));assert.equal(ledger(spread).providerCandidateDates,0);const r=ledger([...ordinary,...spread]);assert.equal(r.dates[0].eventCount,3);assert.equal(r.unscoped.length,3);assert.equal(ledger(ordinary.map(x=>({...x,product_name:'Unverified new product'}))).providerCandidateDates,0);});
test('two opens without intervening closure cannot validate a session',()=>assert.equal(ledger([ordinary[1],row('open','2026-09-10T10:00:00Z'),ordinary[2]]).providerCandidateDates,0));
test('HTTP error body and its digest survive diagnostic capture',async()=>{const body='{"error":"Invalid sort"}';const r=await capturePages({request:'https://api.massive.com/futures/v1/schedules',apiKey:'fixture-secret',fetchImpl:async()=>new Response(body,{status:400})});assert.equal(r.failure,'HTTP_400');assert.equal(Buffer.from(r.receipts[0].bodyBase64,'base64').toString(),body);assert.equal(r.receipts[0].bodySha256.length,64);});
