// Engine18 controlled ES recording launch gate. Pure/private; NEVER opens a socket,
// makes a purchase, reads credentials or enables licensed capture.
const CHECKS=Object.freeze([
 'managerApprovedTrial','separatePrivateWorker','recordingDiskVerified',
 'dedicatedStorageIsolation','credentialsLoadedPrivately','credentialRotationPlan',
 'readOnlyEntitlementVerified','privateEncryptedBackupVerified',
 'independentInventoryPinVerified','restorationDrillPassed',
 'sourceContractVerified','hostClockQualityVerified','sessionCalendarVerified',
 'subscriptionEvidenceVerified','reconnectAndGapEvidenceVerified',
 'recorderHealthAlertsVerified','maxQueueAndDiskLatencyAccepted',
 'supervisorPresent','stopProcedureTested'
]);
export function assessEngine18ControlledTrialReadiness(evidence={}){
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))
  throw Error('readiness evidence object required');
 const missing=CHECKS.filter(key=>evidence[key]!==true);
 // No secret contents or raw prices are ever returned, only the boolean gate IDs.
 return Object.freeze({
  schema:'engine18.controlledTrial.readiness.v1',
  trialScope:'LIMITED_SUPERVISED_ES_RAW_READ_ONLY',
  recordingAllowed:missing.length===0,
  status:missing.length?'BLOCKED':'READY_FOR_SEPARATE_ACTIVATION',
  failedChecks:Object.freeze(missing),
  requiredChecks:CHECKS.length,
  liveCaptureActive:false
 });
}
