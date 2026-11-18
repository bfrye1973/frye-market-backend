// Engine11 → Engine12 completed ES candle provenance — DESIGN-ONLY validator.
// This pure function NEVER records, signs, fetches, stores, or grants trading authority.
// Independent signature/origin verification and real provider receipt capture are
// explicitly OUTSIDE this validator; even "validStructure" is NOT trusted provenance.
export const ENGINE11_CANDLE_PROVENANCE_SCHEMA="engine11.es.completedCandleProvenance.v1";
const frames=Object.freeze({"1m":60000,"5m":300000,"10m":600000});
const text=x=>typeof x==="string"&&x.trim().length>0;
const num=x=>typeof x==="number"&&Number.isFinite(x);
const nonneg=x=>Number.isSafeInteger(x)&&x>=0;
const time=x=>Number.isSafeInteger(x)&&x>0;
const tick=x=>num(x)&&x>0&&Math.abs(x*4-Math.round(x*4))<1e-7;
const contract=/^ES[FGHJKMNQUVXZ]\d{1,2}$/;
const reject=(issues,code)=>{if(!issues.includes(code))issues.push(code);};
export function inspectEngine11CandleProvenanceV1({provenance=null,evaluationTimeMs=null}={}){
 const issues=[];
 const p=provenance;
 if(!p||p.schema!==ENGINE11_CANDLE_PROVENANCE_SCHEMA)reject(issues,"CANDLE_SOURCE_PROVENANCE_UNVERIFIED");
 if(!time(evaluationTimeMs)||p?.evaluationTimeMs!==evaluationTimeMs)
   reject(issues,"CANDLE_SOURCE_EVALUATION_ASOF_MISMATCH");
 if(p?.symbol!=="ES"||!text(p?.providerId)||!text(p?.feedId)||
   !text(p?.parserVersion)||!text(p?.configVersion)||!text(p?.sourceFingerprint)||
   !text(p?.receiptId))reject(issues,"CANDLE_SOURCE_IDENTITY_MISSING");
 if(!contract.test(p?.physicalContract||"")||!text(p?.physicalContractCanonical))
   reject(issues,"CANDLE_SOURCE_CONTRACT_MISMATCH");
 if(p?.priceBasis?.kind!=="UNADJUSTED_PHYSICAL"||
   p?.priceBasis?.adjustmentApplied!==false||p?.priceBasis?.tickSize!==0.25)
   reject(issues,"CANDLE_SOURCE_PRICE_BASIS_UNVERIFIED");
 if(!text(p?.rollPolicy?.policyId)||!text(p?.rollPolicy?.resolverRule)||
   !time(p?.rollPolicy?.resolverCheckedAtMs))
   reject(issues,"CANDLE_SOURCE_ROLLOVER_UNVERIFIED");
 if(p?.entitlementMode!=="LIVE_ENTITLED"||p?.sourceMode!=="ORIGINAL_CAPTURE")
   reject(issues,"CANDLE_SOURCE_ENTITLEMENT_UNVERIFIED");
 if(p?.clock?.clockStatus!=="VERIFIED"||p?.clock?.eventClock!=="PROVIDER_UTC"||
   p?.clock?.receiveClock!=="UTC_WALL"||!nonneg(p?.clock?.maxUncertaintyMs))
   reject(issues,"CANDLE_SOURCE_CLOCK_UNVERIFIED");
 if(p?.sourceHealth?.state!=="HEALTHY"||
   !Array.isArray(p?.sourceHealth?.reasonCodes)||
   p.sourceHealth.reasonCodes.length!==0)
   reject(issues,"CANDLE_SOURCE_HEALTH_UNVERIFIED");
 if(p?.barStartSemantics!=="UTC_OPEN_INCLUSIVE"||
   p?.barCloseSemantics!=="UTC_END_EXCLUSIVE")
   reject(issues,"CANDLE_SOURCE_TIME_SEMANTICS_UNVERIFIED");
 // A matching SHA string is still caller-supplied and can never prove
 // authenticity. Cryptographic trust-root verification is a DIFFERENT gate.
 if(p?.signatureOrDigest?.algorithm!=="SHA256"||
   !/^[a-f0-9]{64}$/.test(p?.signatureOrDigest?.value||"")||
   p?.signatureOrDigest?.signatureStatus!=="INDEPENDENTLY_VERIFIED")
   reject(issues,"CANDLE_SOURCE_PROVENANCE_UNVERIFIED");
 let total=0;
 for(const [tf,duration] of Object.entries(frames)){
   const counts=p?.coverage?.[tf], bars=p?.bars?.[tf], map=p?.timeframeSourceMap?.[tf];
   if(!text(map))reject(issues,"CANDLE_SOURCE_TIMEFRAME_MAP_MISSING_"+tf);
   if(!Array.isArray(bars)||!counts){reject(issues,"CANDLE_SOURCE_COVERAGE_INCOMPLETE_"+tf);continue;}
   if(!nonneg(counts.observedCount)||!nonneg(counts.rejectedCount)||
      !nonneg(counts.acceptedCount)||counts.acceptedCount!==bars.length||
      counts.observedCount!==counts.acceptedCount+counts.rejectedCount||
      !nonneg(counts.expectedIntervalCount)||!nonneg(counts.gapCount)||
      !nonneg(counts.duplicateCount)||!nonneg(counts.outOfOrderCount)||
      !nonneg(counts.lateCount)||!nonneg(counts.correctionCount)||
      !text(counts.sessionCalendarVersion)||!Array.isArray(counts.gaps)||
      counts.gaps.length!==counts.gapCount||counts.coverageState!=="COMPLETE"||
      counts.gapCount!==0 || counts.acceptedCount===0)
      reject(issues,"CANDLE_SOURCE_COVERAGE_INCOMPLETE_"+tf);
   const ids=new Map();
   let prev=null;
   for(const bar of bars){
     total++;
     const key=[bar.sourceBarId,bar.sourceRevisionId].join("|");
     if(!text(bar.sourceBarId)||!text(bar.sourceRevisionId)||
        !text(bar.sourcePayloadDigest)||!text(bar.providerEventId)||
        bar.timeframe!==tf||bar.sourceContract!==p.physicalContract||
        !time(bar.startMs)||!time(bar.endMs)||bar.endMs-bar.startMs!==duration||
        !tick(bar.open)||!tick(bar.high)||!tick(bar.low)||!tick(bar.close)||
        bar.low>bar.high||bar.open<bar.low||bar.open>bar.high||
        bar.close<bar.low||bar.close>bar.high||
        !num(bar.volume)||bar.volume<0)
       reject(issues,"CANDLE_SOURCE_BAR_INVALID_"+tf);
     if(prev!==null&&bar.startMs<=prev)reject(issues,"CANDLE_SOURCE_OUT_OF_ORDER_"+tf);
     prev=bar.startMs;
     if(ids.has(key)){reject(issues,ids.get(key)===bar.sourcePayloadDigest?
       "CANDLE_SOURCE_DUPLICATE_"+tf:"CANDLE_SOURCE_DUPLICATE_CONFLICT_"+tf);}
     ids.set(key,bar.sourcePayloadDigest);
     if(!time(bar.endMs)||bar.endMs>evaluationTimeMs)
       reject(issues,"CANDLE_BAR_FUTURE_EVIDENCE_"+tf);
     if(!time(bar.firstReceivedAtMs)||!time(bar.availableAtMs)||
        !time(bar.completionObservedAtMs)||
        bar.firstReceivedAtMs>bar.availableAtMs||
        bar.availableAtMs>evaluationTimeMs||
        bar.completionObservedAtMs>evaluationTimeMs)
       reject(issues,"CANDLE_BAR_UNAVAILABLE_ASOF_"+tf);
     if(bar.finality!=="CONFIRMED")reject(issues,"CANDLE_BAR_NOT_FINAL_"+tf);
     if(bar.clockStatus!=="VERIFIED"||bar.sourceHealth!=="HEALTHY")
       reject(issues,"CANDLE_SOURCE_HEALTH_UNVERIFIED_"+tf);
   }
 }
 return Object.freeze({
   schema:"engine11.es.provenancePreflight.v1",mode:"READ_ONLY_PREFLIGHT",
   validStructure:issues.length===0,issues,
   barsInspected:total,recordingActivated:false,writerInvoked:false,
   // A structurally valid envelope remains untrusted until Engine12 independently
   // verifies the signed receipt and actual raw upstream source bytes.
   independentSourceAttestationVerified:false,calibrationAdmissible:false,
 });
}
