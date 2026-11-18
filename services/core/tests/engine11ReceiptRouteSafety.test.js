import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { captureReceiptV3,bindSelectedBarsToReceipt } from '../logic/engine11/sourceReceiptV3/captureReceiptV3.js';

const routeSource=readFileSync(new URL('../routes/futuresOhlc.js',import.meta.url),'utf8');
function buildIsolatedRoute(enabled) {
  let handler;
  let calls=0;
  const physical='ESZ6';
  const body=JSON.stringify({results:[{
    window_start:'1795000000000000000',open:6000,high:6002,
    low:5999,close:6001,volume:14,
  }],status:'OK'});
  const context={
    express:{Router:()=>({get:(_path,fn)=>{handler=fn;}})},
    captureReceiptV3,bindSelectedBarsToReceipt,performance,URL,Buffer,Response,Date,Number,Map,
    String,Object,Array,Math,JSON,console,Error,
    process:{env:{POLYGON_API:'SYNTHETIC_SECRET',ES_CONTRACT_OVERRIDE:physical,
      ENGINE11_SOURCE_RECEIPT_V3_ENABLED:enabled?'1':'0'}},
    fetch:async url=>{
      calls++;
      assert.match(String(url),/\/futures\/v1\/aggs\/ESZ6/);
      return new Response(body,{status:200,headers:{'content-type':'application/json'}});
    },
  };
  // The route is evaluated as a regular script, with only its two ES module
  // import/export declarations removed. This exercises the REAL handler with
  // deterministic mocks, never a network connection or persistent data.
  const script=routeSource
    .replace('import express from "express";','')
    .replace('import { performance } from "node:perf_hooks";','')
    .replace('import { captureReceiptV3, bindSelectedBarsToReceipt } from "../logic/engine11/sourceReceiptV3/captureReceiptV3.js";','')
    .replace('export default router;','');
  vm.runInNewContext(script,context,{filename:'futuresOhlc.js',timeout:1500});
  assert.equal(typeof handler,'function');
  return {request:async (query={})=>{
    const headers={};
    const res={setHeader:(name,value)=>{headers[name]=value;},
      json:body=>({body,headers}),
      status:code=>({json:body=>({body,code,headers})})};
    return handler({query:{symbol:'ES',timeframe:'1m',limit:'10',...query}},res);
  },calls:()=>calls};
}

test('default and disabled evidence return identical bare chart bars',async()=>{
  const legacy=buildIsolatedRoute(false);
  const normal=await legacy.request();
  const disabled=await legacy.request({evidence:'1'});
  assert.deepEqual(JSON.parse(JSON.stringify(normal.body)),
    JSON.parse(JSON.stringify(disabled.body)));
  assert.ok(Array.isArray(normal.body));
  assert.equal(legacy.calls(),2);
});

test('enabled evidence reuses the same provider call and returns no source body',async()=>{
  const app=buildIsolatedRoute(true);
  const plain=await app.request();
  const shadow=await app.request({evidence:'1'});
  assert.equal(app.calls(),2);
  assert.equal(shadow.code,undefined,JSON.stringify(shadow.body));
  assert.deepEqual(JSON.parse(JSON.stringify(shadow.body.bars)),
    JSON.parse(JSON.stringify(plain.body)));
  const receipt=shadow.body.engine11Receipt;
  assert.equal(receipt.physicalContract,'ESZ6');
  assert.equal(receipt.observations.length,1);
  assert.equal(receipt.engine3ConsumptionVerified,false);
  assert.equal(receipt.sourceMode,'REST_AGGREGATE_OBSERVED');
  assert.equal(shadow.body.selectedBarReferences.length,1);
  assert.equal(shadow.body.selectedBarReferences[0].receiptId,receipt.receiptId);
  assert.equal(shadow.body.selectedBarReferences[0].sourcePayloadDigest,receipt.observations[0].rowDigest);
  assert.ok(receipt.bodyCompletedAtMs>=receipt.requestStartedAtMs);
  assert.ok(receipt.bodyCompletedAtMs>=receipt.firstByteAtMs);
  assert.equal(receipt.bodyRetained,false);
  assert.equal(receipt.sourceTrustVerified,false);
  assert.doesNotMatch(JSON.stringify(shadow.body),/SYNTHETIC_SECRET|bodyBase64|rowBase64/);
});

test('opt-in receipt is unavailable for non-evidence frames',async()=>{
  const app=buildIsolatedRoute(true);
  const response=await app.request({timeframe:'15m',evidence:'1'});
  assert.ok(Array.isArray(response.body));
});
