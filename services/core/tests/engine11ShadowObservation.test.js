import test from 'node:test';
import assert from 'node:assert/strict';
import {captureReceiptV3,bindSelectedBarsToReceipt} from
  '../logic/engine11/sourceReceiptV3/captureReceiptV3.js';
import {buildEngine11ShadowObservation} from
  '../logic/engine11/sourceReceiptV3/buildShadowObservation.js';

const start=1795000200;
const evaluationTimeMs=(start+120)*1000;
const decisionComputedAtMs=evaluationTimeMs+1000;
const bar=Object.freeze({time:start,open:6000,high:6002,low:5999,close:6001,volume:14});
function frame(tf,physicalContract='ESZ6'){
 const resolution={'1m':'1min','5m':'5min','10m':'10min'}[tf];
 const request='https://api.polygon.io/futures/v1/aggs/'+physicalContract+
  '?resolution='+resolution+'&window_start.gte=2026-11-18&window_start.lte=2026-11-19&apiKey=secret';
 const body=Buffer.from(JSON.stringify({results:[{
   window_start:String(BigInt(start)*1000000000n),
   open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume,
 }]}));
 const receipt=captureReceiptV3({
   request,body,physicalContract,frame:tf,
   requestStartedAtMs:evaluationTimeMs+100,
   firstByteAtMs:evaluationTimeMs+120,
   bodyCompletedAtMs:evaluationTimeMs+140,
   requestToFirstByteMonoMs:20,requestToBodyMonoMs:40,
 });
 const bars=[bar];
 return {bars,engine11Receipt:receipt,
  selectedBarReferences:bindSelectedBarsToReceipt(receipt,bars),
  consumerReceivedAtMs:evaluationTimeMs+160};
}
const frames=()=>({'1m':frame('1m'),'5m':frame('5m'),'10m':frame('10m')});
const build=f=>buildEngine11ShadowObservation({
 frames:f,evaluationTimeMs,decisionComputedAtMs,
});
test('three-frame shadow accurately distinguishes closed-label and forming',()=>{
 const result=build(frames());
 assert.equal(result.ok,true);
 assert.equal(result.physicalContract,'ESZ6');
 assert.equal(result.frames['1m'].completedCount,1);
 assert.equal(result.frames['5m'].formingCount,1);
 assert.equal(result.frames['10m'].formingCount,1);
 assert.equal(result.frames['1m'].sourceToEvaluationLagMs,140);
 assert.equal(result.frames['1m'].observations[0].completionLabel,
  'WINDOW_CLOSED_NOT_PROVIDER_FINAL');
 assert.equal(result.engine3ConsumptionAttested,false);
 assert.equal(result.providerFinalityVerified,false);
 assert.equal(result.calibrationAdmissible,false);
});
test('cross-timeframe contract mismatch fails without any trust',()=>{
 const f=frames();f['10m']=frame('10m','ESH7');
 assert.equal(build(f).reasonCode,'SHADOW_CROSS_TIMEFRAME_CONTRACT_MISMATCH');
});
test('incorrect selected-source digest fails closed',()=>{
 const f=frames();
 f['5m'].selectedBarReferences=[{...f['5m'].selectedBarReferences[0],
  sourcePayloadDigest:'a'.repeat(64)}];
 assert.equal(build(f).reasonCode,'SHADOW_REFERENCES_MISMATCH');
});
test('source consumed after decision blocks shadow evidence',()=>{
 const f=frames();f['1m'].consumerReceivedAtMs=decisionComputedAtMs+1;
 assert.equal(build(f).reasonCode,'SHADOW_RECEIPT_CONSUMPTION_ORDER_INVALID');
});
test('forming observations cannot be presented as final provider evidence',()=>{
 const f=frames();
 assert.equal(build(f).frames['10m'].observations[0].completionLabel,
  'FORMING_AT_EVALUATION_LABEL');
 assert.equal(build(f).sourceEvidenceVerified,false);
});
