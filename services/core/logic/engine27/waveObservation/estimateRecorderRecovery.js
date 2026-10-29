// Read-only capacity estimator. Never presents fixture speed as live throughput.
// One 10m OHLC provider window is reusable across both Micro/Submicro degrees.
export function estimateRecorderRecovery({pendingLegacy,pendingQualified,
 distinctUncachedTenMinuteWindows,requestCapPerMinute=2,legacyBatchSize=60,
 busyCycleSeconds=1,minutesUntilOldestExpiry=null}={}){
 const integers=[pendingLegacy,pendingQualified,distinctUncachedTenMinuteWindows,
  requestCapPerMinute,legacyBatchSize,busyCycleSeconds];
 if(integers.some(n=>!Number.isInteger(n)||n<0)||
    requestCapPerMinute<1||requestCapPerMinute>2||legacyBatchSize<1||legacyBatchSize>120||
    busyCycleSeconds<1||busyCycleSeconds>300||
    (minutesUntilOldestExpiry!==null&&(!Number.isFinite(minutesUntilOldestExpiry)||minutesUntilOldestExpiry<0)))
  return {ok:false,reason:"INVALID_RECOVERY_CAPACITY_INPUT"};
 const total=pendingLegacy+pendingQualified;
 const minimumProviderMinutes=distinctUncachedTenMinuteWindows===0?0:
  (distinctUncachedTenMinuteWindows-1)*60/requestCapPerMinute/60;
 const minimumBusyCycleMinutes=Math.max(0,Math.ceil(total/legacyBatchSize)-1)*busyCycleSeconds/60;
 const theoreticalFloorMinutes=Math.max(minimumProviderMinutes,minimumBusyCycleMinutes);
 return {ok:true,requiredReplayCount:total,minimumProviderRequests:distinctUncachedTenMinuteWindows,
  theoreticalFloorMinutes:Number(theoreticalFloorMinutes.toFixed(2)),
  historicalDeadlineAtRisk:minutesUntilOldestExpiry!==null?
   theoreticalFloorMinutes>=minutesUntilOldestExpiry:null,
  estimatedOperationalMinutes:null,
  warning:"LOWER_BOUND_ONLY_REAL_NETWORK_DISK_BACKPRESSURE_AND_FRESHNESS_UNVERIFIED",
  statisticallyEligible:false};
}
