import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSourceConsumptionTiming} from
 '../logic/engine11/sourceReceiptV3/inspectSourceConsumptionTiming.js';
const receipt={schema:'engine11.es.originalSourceReceipt.v3',bodyCompletedAtMs:2000};
test('post-evaluation receipt is not presented as available at evaluation',()=>{
 const state=inspectSourceConsumptionTiming({receipt,evaluationTimeMs:1000,
   consumerReceivedAtMs:2100,decisionComputedAtMs:2400});
 assert.equal(state.validObservationOrder,true);
 assert.equal(state.receivedAfterEvaluationLabel,true);
 assert.equal(state.sourceToEvaluationLagMs,1000);
 assert.equal(state.engine3ConsumptionAttested,false);
 assert.equal(state.calibrationAdmissible,false);
});
test('valid source-before-label timing never certifies provider arrival',()=>{
 const state=inspectSourceConsumptionTiming({receipt,evaluationTimeMs:2200,
   consumerReceivedAtMs:2100,decisionComputedAtMs:2400});
 assert.equal(state.validObservationOrder,true);
 assert.equal(state.receivedAfterEvaluationLabel,false);
 assert.equal(state.providerPublicationTimeKnown,false);
 assert.equal(state.sourceClockVerified,false);
});
test('impossible or missing consumer chronology is rejected',()=>{
 for(const values of [
   {consumerReceivedAtMs:1999,decisionComputedAtMs:2400},
   {consumerReceivedAtMs:2300,decisionComputedAtMs:2200},
   {consumerReceivedAtMs:null,decisionComputedAtMs:2400}
 ]) {
   const state=inspectSourceConsumptionTiming({receipt,evaluationTimeMs:1000,...values});
   assert.equal(state.validObservationOrder,false);
   assert.equal(state.calibrationAdmissible,false);
 }
});
