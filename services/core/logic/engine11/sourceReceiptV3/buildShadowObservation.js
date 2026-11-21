// Pure Engine11 P0 shadow handoff: exact source observations, NOT trusted
// provider finality, not a writer, and not Engine3 decision authority.
import { bindSelectedBarsToReceipt } from './captureReceiptV3.js';

const durations=Object.freeze({'1m':60000,'5m':300000,'10m':600000});
const timestamp=x=>Number.isSafeInteger(x)&&x>0;
const reject=(code,frame=null)=>Object.freeze({
  ok:false,reasonCode:code,frame,sourceEvidenceVerified:false,
  calibrationAdmissible:false,recordingActivated:false,writerInvoked:false,
});

export function buildEngine11ShadowObservation({
  frames=null,evaluationTimeMs=null,decisionComputedAtMs=null
}={}) {
  if(!timestamp(evaluationTimeMs)||!timestamp(decisionComputedAtMs)||
     decisionComputedAtMs<evaluationTimeMs)
    return reject('SHADOW_EVALUATION_CHRONOLOGY_INVALID');
  const output={},contracts=new Set();
  for(const [tf,duration] of Object.entries(durations)) {
    const input=frames?.[tf],receipt=input?.engine11Receipt;
    const bars=input?.bars,refs=input?.selectedBarReferences;
    const consumerTime=input?.consumerReceivedAtMs;
    if(!Array.isArray(bars)||!Array.isArray(refs)||
       !timestamp(consumerTime)||receipt?.frame!==tf)
      return reject('SHADOW_FRAME_INPUT_MISSING',tf);
    if(receipt.bodyCompletedAtMs>consumerTime||
       consumerTime>decisionComputedAtMs)
      return reject('SHADOW_RECEIPT_CONSUMPTION_ORDER_INVALID',tf);
    if(receipt.bodyRetained!==false||
       receipt.sourceTrustVerified!==false||
       receipt.engine3ConsumptionVerified!==false||
       receipt.providerFinality!=='UNKNOWN'||
       receipt.clock?.status!=='UNVERIFIED')
      return reject('SHADOW_RECEIPT_TRUST_CLAIM_UNSUPPORTED',tf);
    if(receipt.resolver?.resolvedSymbol &&
       receipt.resolver.resolvedSymbol!==receipt.physicalContract)
      return reject('SHADOW_RESOLVER_CONTRACT_MISMATCH',tf);
    contracts.add(receipt.physicalContract);
    let matched;
    try{matched=bindSelectedBarsToReceipt(receipt,bars);}
    catch{return reject('SHADOW_SOURCE_BAR_IDENTITY_UNVERIFIED',tf);}
    if(refs.length!==matched.length||
       matched.some((m,i)=>refs[i]?.sourceBarId!==m.sourceBarId||
         refs[i]?.sourceRevisionId!==m.sourceRevisionId||
         refs[i]?.sourcePayloadDigest!==m.sourcePayloadDigest||
         refs[i]?.receiptId!==m.receiptId))
      return reject('SHADOW_REFERENCES_MISMATCH',tf);
    let prior=0,forming=0,completed=0;
    const observations=[];
    for(let i=0;i<bars.length;i++){
      const bar=bars[i],startMs=bar.time*1000;
      if(!timestamp(startMs)||startMs<=prior||!Number.isFinite(bar.volume)||
         ![bar.open,bar.high,bar.low,bar.close].every(Number.isFinite))
        return reject('SHADOW_BAR_INVALID_OR_UNORDERED',tf);
      prior=startMs;
      const endMs=startMs+duration;
      const isCompleted=endMs<=evaluationTimeMs;
      if(isCompleted)completed++;else forming++;
      if(forming>1)return reject('SHADOW_MULTIPLE_FORMING_BARS',tf);
      observations.push(Object.freeze({
        sourceBarId:matched[i].sourceBarId,
        sourceRevisionId:matched[i].sourceRevisionId,
        sourcePayloadDigest:matched[i].sourcePayloadDigest,
        startMs,endMs,completionLabel:isCompleted?
          'WINDOW_CLOSED_NOT_PROVIDER_FINAL':'FORMING_AT_EVALUATION_LABEL',
      }));
    }
    output[tf]=Object.freeze({
      receiptId:receipt.receiptId,physicalContract:receipt.physicalContract,
      requestStartedAtMs:receipt.requestStartedAtMs,
      sourceReceivedAtMs:receipt.bodyCompletedAtMs,
      consumerReceivedAtMs:consumerTime,
      sourceToEvaluationLagMs:receipt.bodyCompletedAtMs-evaluationTimeMs,
      observedCount:bars.length,completedCount:completed,formingCount:forming,
      sourceCoverage:'UNVERIFIED',observations:Object.freeze(observations),
    });
  }
  if(contracts.size!==1)return reject('SHADOW_CROSS_TIMEFRAME_CONTRACT_MISMATCH');
  return Object.freeze({
    ok:true,schema:'engine11.es.shadowSourceObservation.v1',
    status:'STRUCTURAL_ONLY_NOT_ATTESTED',
    evaluationTimeMs,decisionComputedAtMs,
    physicalContract:[...contracts][0],frames:Object.freeze(output),
    sourceEvidenceVerified:false,calibrationAdmissible:false,
    recordingActivated:false,writerInvoked:false,
    providerFinalityVerified:false,engine3ConsumptionAttested:false,
  });
}
