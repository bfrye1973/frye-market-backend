// Engine11 P0: pure observation/decision ordering inspection.
// This never upgrades clock quality, market-data finality or source trust.
const validTime = x => Number.isSafeInteger(x) && x > 0;
const failure = (code, receipt, label) => Object.freeze({
  schema:'engine11.es.sourceConsumptionTiming.v1',
  validObservationOrder:false,reasonCode:code,
  evaluationTimeMs:label??null,
  sourceReceivedAtMs:validTime(receipt?.bodyCompletedAtMs) ? receipt.bodyCompletedAtMs : null,
  sourceClockVerified:false,calibrationAdmissible:false,
});
export function inspectSourceConsumptionTiming({
  receipt,evaluationTimeMs,consumerReceivedAtMs,decisionComputedAtMs
}={}) {
  if(receipt?.schema!=='engine11.es.originalSourceReceipt.v3' ||
      !validTime(receipt.bodyCompletedAtMs))
    return failure('SOURCE_RECEIPT_MISSING',receipt,evaluationTimeMs);
  if(![evaluationTimeMs,consumerReceivedAtMs,decisionComputedAtMs].every(validTime))
    return failure('SOURCE_CONSUMPTION_TIMES_MISSING',receipt,evaluationTimeMs);
  if(receipt.bodyCompletedAtMs>consumerReceivedAtMs ||
      consumerReceivedAtMs>decisionComputedAtMs)
    return failure('SOURCE_CONSUMPTION_ORDER_INVALID',receipt,evaluationTimeMs);
  const sourceToEvaluationLagMs=receipt.bodyCompletedAtMs-evaluationTimeMs;
  return Object.freeze({
    schema:'engine11.es.sourceConsumptionTiming.v1',
    validObservationOrder:true,
    reasonCode:'STRUCTURAL_ORDER_ONLY',
    evaluationTimeMs,sourceReceivedAtMs:receipt.bodyCompletedAtMs,
    consumerReceivedAtMs,decisionComputedAtMs,
    sourceToEvaluationLagMs,
    receivedAfterEvaluationLabel:sourceToEvaluationLagMs>0,
    sourceClockVerified:false,providerPublicationTimeKnown:false,
    engine3ConsumptionAttested:false,calibrationAdmissible:false,
  });
}
