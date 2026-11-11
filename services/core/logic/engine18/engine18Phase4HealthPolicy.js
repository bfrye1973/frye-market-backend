// Engine 18 isolated recorder readiness assessment. No HTTP route or raw source content.
// Fail closed on unknown clock/calendar/storage or queue status.
const safeNum=x=>Number.isFinite(x)&&x>=0?x:null;
export function sanitizedRecordingError(err){
 const known=new Set(['ENOSPC','EIO','EACCES','EROFS','EMFILE','ENFILE','EPIPE','ETIMEDOUT']);
 return known.has(err?.code)?err.code:'UNKNOWN_RECORDING_ERROR';
}
export function assessEngine18RecorderHealth({
 recordingActive=false,clockQuality='UNVERIFIED',calendarQuality='UNVERIFIED',
 diskFreeBytes=null,diskTotalBytes=null,queueDepth=0,queueCapacity=0,
 backupLagMinutes=null,backupInventoryVerified=false,
 gaps=0,rejected=0,writeFailures=0,workerConnected=false,
 maxBackupLagMinutes=120
}={}){
 const reasons=[];let mustStop=false;
 if(!recordingActive||!workerConnected){reasons.push('RECORDER_INACTIVE');mustStop=true;}
 if(clockQuality!=='VERIFIED')reasons.push('CLOCK_UNVERIFIED');
 if(calendarQuality!=='VERIFIED')reasons.push('SESSION_CALENDAR_UNVERIFIED');
 if(backupInventoryVerified!==true)reasons.push('BACKUP_INVENTORY_UNVERIFIED');
 const free=safeNum(Number(diskFreeBytes)),total=safeNum(Number(diskTotalBytes));
 const usage=free!==null&&total!==null&&total>0?Math.max(0,Math.min(1,1-free/total)):null;
 if(usage===null){reasons.push('DISK_USAGE_UNVERIFIED');mustStop=true;}
 else if(usage>=.8){reasons.push('DISK_THRESHOLD_STOP');mustStop=true;}
 else if(usage>=.7)reasons.push('DISK_USAGE_WARNING');
 const q=safeNum(queueDepth),cap=safeNum(queueCapacity);
 const pressure=q!==null&&cap!==null&&cap>0?q/cap:null;
 if(pressure===null){reasons.push('QUEUE_CAPACITY_UNVERIFIED');mustStop=true;}
 else if(pressure>=.9){reasons.push('QUEUE_THRESHOLD_STOP');mustStop=true;}
 else if(pressure>=.7)reasons.push('QUEUE_PRESSURE_WARNING');
 if(!Number.isFinite(backupLagMinutes)||backupLagMinutes<0){reasons.push('BACKUP_LAG_UNVERIFIED');mustStop=true;}
 else if(backupLagMinutes>maxBackupLagMinutes){reasons.push('BACKUP_LAG_THRESHOLD_STOP');mustStop=true;}
 if(rejected>0||writeFailures>0){reasons.push('RECORDING_INTEGRITY_FAULT');mustStop=true;}
 if(gaps>0)reasons.push('RECORDING_GAP_REVIEW_REQUIRED');
 const captureEligible=!mustStop&&clockQuality==='VERIFIED'&&calendarQuality==='VERIFIED'&&backupInventoryVerified===true&&gaps===0;
 return Object.freeze({
  schema:'engine18.recorder.health.policy.v1',
  status:mustStop?'FAIL_CLOSED':reasons.length?'DEGRADED':'OK',
  captureEligible,shouldHalt:mustStop,
  reasons:Object.freeze([...new Set(reasons)]),
  diskUsageFraction:usage,queuePressureFraction:pressure
 });
}
