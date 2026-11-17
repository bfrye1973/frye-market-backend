// Engine18C DAILY RAW SESSION PREPARATION ONLY — no socket, timer or recording start.
// Reuses the existing private recorder after a separately reviewed recovery-aware runner.
// Calendar/session, contract roll, cost and clock MUST be independently approved.
import {createHash} from 'node:crypto';
export const ENGINE18_DAILY_SCHEMA='engine18.dailyRawReadiness.v1';
export const EXISTING_RAW_NAMESPACE='engine18/raw-only/v1';
export const EXISTING_REAL_PIN=Object.freeze({
 lastSeq:492,
 headHash:'c9ab599ef9cf10e14baae17ef3223e09d2be0bce53276382d0aa7eb8aa79166e'
});
export const LEGACY_SYNTHETIC_PIN=Object.freeze({
 lastSeq:4,
 headHash:'d5e31aa9fe1aa2b51801dba5862e86127e2ebc36327739095cf64b095f1d5517'
});
export const PRIVATE_DISK='/var/data/engine18-recorder';
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)&&
 Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===new Date(Date.parse(s)).toISOString();
const positiveInteger=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const deny=reason=>Object.freeze({ok:false,reason,marketConnectionAllowed:false,
  mode:'PREPARATION_ONLY',tradingAllowed:false});
export function evaluateEngine18DailyRawSession({
 plan,inventory,disk,sourceEntitlement,clock,storage,nowMs=Date.now()
}={}){
 if(!plan||plan.schema!==ENGINE18_DAILY_SCHEMA)return deny('UNAPPROVED_PLAN');
 if(plan.executionMode!=='PREPARE_ONLY'||plan.startApproved===true)
  return deny('LIVE_RECORDING_NOT_AUTHORIZED');
 if(plan.calendarVerified!==true||plan.isCmeHoliday!==false||
  plan.sessionSource!=='APPROVED_CME_ES_CALENDAR')
  return deny('CME_SESSION_CALENDAR_UNVERIFIED');
 if(!iso(plan.startUtc)||!iso(plan.stopUtc))return deny('SESSION_WINDOW_INVALID');
 const start=Date.parse(plan.startUtc),stop=Date.parse(plan.stopUtc);
 // No indefinite running, wrong-day calendar or silently extending a session.
 if(stop<=start||stop-start>24*60*60*1000||stop-start<60000||
    !Number.isFinite(nowMs)||nowMs>=stop)return deny('SESSION_DEADLINE_INVALID');
 if(!['XCME:ES.Z26','XCME:ES.H27'].includes(plan.contract)||
    plan.contractApproval!=='PINNED_PHYSICAL_CONTRACT')
  return deny('PHYSICAL_CONTRACT_UNVERIFIED');
 if(plan.contract==='XCME:ES.H27'&&plan.rollDecisionApproved!==true)
  return deny('ROLLOVER_UNVERIFIED');
 if(plan.feedTypes?.join(',')!=='depths,quotes,trades')
  return deny('UNEXPECTED_FEED_SUBSCRIPTIONS');
 if(plan.priceBasisPolicy!=='RAW_PHYSICAL_NO_ROLL')
  return deny('RAW_PRICE_BASIS_CHANGED');
 if(!sourceEntitlement?.licensedEsDepthQuotesTrades||!sourceEntitlement?.storageRetentionConfirmed)
  return deny('VENDOR_RIGHTS_UNVERIFIED');
 if(!plan.ownerLicenseApproved||!plan.ownerCostApproved||
    !positiveInteger(plan.budgetCents,1,1000000)||!positiveInteger(plan.retentionDays,1,365))
  return deny('BUDGET_OR_RETENTION_NOT_APPROVED');
 if(!clock||clock.quality!=='VERIFIED_5MS')
  return deny('FIVE_MS_CLOCK_GATE_NOT_MET');
 if(!inventory||inventory.namespace!==EXISTING_RAW_NAMESPACE||
    inventory.lastSeq!==EXISTING_REAL_PIN.lastSeq||
    inventory.headHash!==EXISTING_REAL_PIN.headHash||
    inventory.syntheticLastSeq!==LEGACY_SYNTHETIC_PIN.lastSeq||
    inventory.syntheticHeadHash!==LEGACY_SYNTHETIC_PIN.headHash)
  return deny('PINNED_INVENTORY_MISMATCH_OR_RESUME_UNVERIFIED');
 // A genuine daily writer must recover local checkpoint and append after existing seq;
 // the 1-5 minute first-run runner rejects any pre-existing records by design.
 if(!inventory.localReplayVerified||!inventory.appendOnlyRecoveryVerified||
    !inventory.independentR2RestoreVerified)
  return deny('RECOVERY_AND_RESTORE_NOT_VERIFIED');
 if(!disk||disk.mountPath!==PRIVATE_DISK||disk.sizeGB!==50||
    !Number.isFinite(disk.totalBytes)||!Number.isFinite(disk.freeBytes)||
    disk.totalBytes<=0||disk.freeBytes<Math.max(disk.totalBytes*.25,10*1024**3))
  return deny('DEDICATED_DISK_HEADROOM_LOW');
 if(!storage?.aes256GcmVerified||!storage?.immutableWriteVerified||
    !storage?.backupFailsClosed||!storage?.queueFailClosed)
  return deny('STORAGE_OR_BACKPRESSURE_UNVERIFIED');
 if(!positiveInteger(plan.maxQueued,1,4096)||
    !positiveInteger(plan.maxQueueBytes,1,32*1024*1024)||
    !positiveInteger(plan.maxBackupLagMs,1000,120000)||
    !positiveInteger(plan.maxRemoteBytes,1,1000000000000))
  return deny('BOUNDED_RESOURCE_POLICY_INVALID');
 return Object.freeze({ok:true,reason:null,marketConnectionAllowed:false,
  mode:'PREPARATION_ONLY',tradingAllowed:false,contract:plan.contract,
  startUtc:plan.startUtc,stopUtc:plan.stopUtc,
  planDigest:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
  readiness:'PREPARED_NOT_AUTHORIZED_TO_RECORD'});
}
export function evaluateEngine18DailyRunHealth({nowMs,stopMs,writer,source,backup,remoteBytes=0,
 maxRemoteBytes=0}={}){
 if(!Number.isFinite(nowMs)||!Number.isFinite(stopMs)||nowMs>=stopMs)
  return {stop:true,reason:'HARD_SESSION_DEADLINE'};
 if(!writer?.recordingActive||writer.failedClosed||writer.rejected>0||
  writer.gapCount>0||writer.unacknowledged>=3686||
  !Number.isFinite(writer.diskFreeBytes)||!Number.isFinite(writer.diskTotalBytes)||
  writer.diskFreeBytes<Math.max(.25*writer.diskTotalBytes,10*1024**3))
  return {stop:true,reason:'LOCAL_RECORDING_UNSAFE'};
 if(!source?.active||!source.connected||source.captureUncertain||
  source.disconnections>0||source.reconnects>0)
  return {stop:true,reason:'SOURCE_CONTINUITY_UNVERIFIED'};
 if(!backup||backup.failures>0||backup.lastFailureAtMs!==null||
  backup.inFlight&&backup.backupLagMs>120000||
  backup.backupLagMs>120000)
  return {stop:true,reason:'REMOTE_BACKUP_UNSAFE'};
 if(!Number.isFinite(remoteBytes)||!positiveInteger(maxRemoteBytes,1,1000000000000)||
  remoteBytes>=maxRemoteBytes)
  return {stop:true,reason:'REMOTE_BUDGET_LIMIT'};
 return {stop:false,reason:null};
}
