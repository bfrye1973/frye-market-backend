// Engine18 STRICTLY SEPARATE raw-frame diagnostic, NOT the clock-verified live worker.
// Never imported or launched by Render standby or the production backend.
// Design/test only until independently authorized, credentialed, backed up and restored.
// All receipt timestamps remain UNVERIFIED and cannot inform models or trading.
import {statSync,readFileSync} from 'node:fs';
import {Engine18BufferedRecorder} from './engine18BufferedRecorder.js';
import {Engine18IronbeamLiveRecorderSource} from './engine18IronbeamLiveRecorderSource.js';
import {createEngine18ReceiptClock} from './engine18ReceiptClock.js';
import {Engine18S3PrivateStore} from './engine18S3PrivateStore.js';
import {Engine18S3ArchiveCoordinator} from './engine18Phase5S3Coordinator.js';
import {Engine18ContinuousBackup} from './engine18ContinuousBackup.js';

const ROOT='/var/data/engine18-recorder';
const DISK=ROOT+'/records';
const CONTRACT='XCME:ES.Z26';
const keys=['IRONBEAM_USERNAME','IRONBEAM_PASSWORD','IRONBEAM_API_KEY',
 'ENGINE18_R2_ENDPOINT','ENGINE18_R2_BUCKET','ENGINE18_R2_ACCESS_KEY',
 'ENGINE18_R2_SECRET_KEY','ENGINE18_R2_ENCRYPTION_KEY_HEX',
 'ENGINE18_R2_KEY_ID','ENGINE18_INDEPENDENT_INVENTORY_PIN',
 'ENGINE18_RAW_DIAGNOSTIC_OWNER_APPROVED',
 'ENGINE18_RAW_DIAGNOSTIC_MANAGER_APPROVED',
 'ENGINE18_RAW_DIAGNOSTIC_RESTORE_VERIFIED',
 'ENGINE18_RAW_DIAGNOSTIC_COST_APPROVED',
 'ENGINE18_RAW_DIAGNOSTIC_OPERATOR_START',
 'ENGINE18_IRONBEAM_ES_DEMO_ENTITLED',
 'ENGINE18_CME_CALENDAR_VERIFIED'];
const approved=k=>k==='YES';
export function verifyEngine18RawOnlyEnvironment(env,{stat=statSync,mountTable=()=>readFileSync('/proc/self/mountinfo','utf8')}={}){
 if(!env||typeof env!=='object')throw Error('private environment required');
 const missing=keys.filter(k=>!env[k]);
 if(missing.length)throw Error('raw diagnostic missing private requirements: '+missing.join(','));
 for(const k of keys.filter(k=>k.startsWith('ENGINE18_RAW_DIAGNOSTIC_')||
  k==='ENGINE18_IRONBEAM_ES_DEMO_ENTITLED'||k==='ENGINE18_CME_CALENDAR_VERIFIED'))
  if(!approved(env[k]))throw Error('raw diagnostic gate closed: '+k);
 if(env.ENGINE18_PRIVATE_STANDBY==='YES')throw Error('must not start raw diagnostic in existing standby mode');
 if(env.ENGINE18_LIVE_CAPTURE_APPROVED==='YES'||env.ENGINE18_MANAGER_TRIAL_ACCEPTED==='YES')
  throw Error('raw diagnostic must not share timing-sensitive live authorization');
 if(env.ENGINE18_RECORDER_DISK!==DISK||env.ENGINE18_RAW_DIAGNOSTIC_CONTRACT!==CONTRACT)
  throw Error('raw diagnostic must use the dedicated ES records directory and locked demo contract');
 if(typeof env.ENGINE18_RAW_DIAGNOSTIC_RESTORE_RECEIPT!=='string'||
   !/^[A-Za-z0-9._:-]{12,120}$/.test(env.ENGINE18_RAW_DIAGNOSTIC_RESTORE_RECEIPT))
  throw Error('operator-pinned independent restore receipt required');
 const minutes=Number(env.ENGINE18_RAW_DIAGNOSTIC_MINUTES);
 if(!Number.isInteger(minutes)||minutes<1||minutes>5)throw Error('raw diagnostic must be 1-5 minutes');
 if(!stat(DISK).isDirectory())throw Error('dedicated private records directory missing');
 const mounted=mountTable().split('\n').some(line=>
   line.split(' - ')[0]?.trim().split(/\s+/)[4]===ROOT);
 if(!mounted)throw Error('separate private disk mount not verified');
 let endpoint;try{endpoint=new URL(env.ENGINE18_R2_ENDPOINT);}catch{throw Error('private R2 endpoint invalid');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||
   endpoint.search||endpoint.hash||['localhost','127.0.0.1'].includes(endpoint.hostname))
  throw Error('private encrypted remote backup requires valid HTTPS endpoint');
 if(!/^[a-fA-F0-9]{64}$/.test(env.ENGINE18_R2_ENCRYPTION_KEY_HEX))
  throw Error('invalid AES-256 private backup key');
 const lastSeq=Number(env.ENGINE18_INDEPENDENT_INVENTORY_PIN);
 if(!Number.isSafeInteger(lastSeq)||lastSeq<0)throw Error('invalid independently pinned inventory');
 return Object.freeze({minutes,root:DISK,lastSeq,contract:CONTRACT,
  mode:'RAW_FRAMES_ONLY',clockQuality:'UNVERIFIED',allowTimingInference:false});
}
const alertDefault=code=>{process.stderr.write('ENGINE18_RAW_PRIVATE_ALERT '+code+'\n');};
const safeAlert=(fn,code)=>{try{fn(code);}catch{}};
export async function runEngine18RawOnlyDiagnostic({env=process.env,fetchImpl=fetch,
 WebSocketImpl,onAlert=alertDefault,onResult=()=>{},dependencies={},operatorSignal}={}){
 if(typeof WebSocketImpl!=='function')throw Error('private WebSocket transport required');
 if(!operatorSignal||typeof operatorSignal.addEventListener!=='function'||
   typeof operatorSignal.aborted!=='boolean')throw Error('manual operator stop signal required');
 const config=verifyEngine18RawOnlyEnvironment(env,dependencies.validation||{});
 if(operatorSignal.aborted)throw Error('operator already stopped raw diagnostic');
 const createStore=dependencies.createStore||((options)=>new Engine18S3PrivateStore(options));
 const createCoordinator=dependencies.createCoordinator||((options)=>new Engine18S3ArchiveCoordinator(options));
 const openRecorder=dependencies.openRecorder||((options)=>Engine18BufferedRecorder.openBounded(options));
 const createSource=dependencies.createSource||((options)=>new Engine18IronbeamLiveRecorderSource(options));
 const createScheduler=dependencies.createScheduler||((options)=>new Engine18ContinuousBackup(options));
 const store=createStore({endpoint:env.ENGINE18_R2_ENDPOINT,bucket:env.ENGINE18_R2_BUCKET,
  region:env.ENGINE18_R2_REGION||'auto',accessKeyId:env.ENGINE18_R2_ACCESS_KEY,
  secretAccessKey:env.ENGINE18_R2_SECRET_KEY,keyId:env.ENGINE18_R2_KEY_ID,
  encryptionKey:Buffer.from(env.ENGINE18_R2_ENCRYPTION_KEY_HEX,'hex'),
  stagingRoot:config.root,retentionDays:Number(env.ENGINE18_RETENTION_DAYS||30),
  fetchImpl});
 const backup=createCoordinator({root:config.root,store});
 // Independently pinned inventory and previously completed RESTORE are mandatory.
 await backup.inventory({expectedLastSeq:config.lastSeq});
 if(operatorSignal.aborted)throw Error('operator stopped during backup preflight');
 const writer=await openRecorder({root:config.root,clock:createEngine18ReceiptClock(),
  maxQueued:4096,maxQueueBytes:32*1024*1024,batchSize:128,flushDelayMs:2,
  provider:'IRONBEAM_V2',allowLiveProvider:true});
 let source=null,scheduler=null,timeout=null,monitor=null,ended=false,ending=null;
 let faultCode=null,started=false;
 const fault=code=>{
  if(!faultCode)faultCode=code;
  safeAlert(onAlert,code);
  if(started)void stop('INTEGRITY_FAULT').catch(()=>{});
 };
 const stop=reason=>{
  if(ending)return ending;
  ending=(async()=>{
   if(ended)return;ended=true;clearTimeout(timeout);clearInterval(monitor);
   operatorSignal.removeEventListener?.('abort',operatorStop);
   // Stop source before sealing hour; no more frames should arrive.
   try{await source?.stop();}catch{faultCode||='SOURCE_STOP_FAILED';}
   try{await scheduler?.stop();}catch{faultCode||='BACKUP_STOP_FAILED';}
   const health=writer.health();
   if(health.failedClosed||health.rejected>0||health.gapCount>0||
      source?.health?.().captureUncertain||faultCode){
    writer.fail('RAW_ONLY_DIAGNOSTIC_UNCLEAN');
    safeAlert(onAlert,'RAW_ONLY_DIAGNOSTIC_REQUIRES_RECOVERY');
    throw Error('raw diagnostic stopped uncleanly; review gap evidence');
   }
   await writer.offer({raw:JSON.stringify({schema:'engine18.rawOnly.stop.v1',
    reason,clockQuality:'UNVERIFIED',timingInferenceAllowed:false,
    vendorSequenceCompleteness:'UNVERIFIED'}),msgClass:'control',statusCode:'DIAGNOSTIC_STOP'});
   await writer.close(); // Seal even a sub-hour bounded recording and its manifest.
   try{await backup.syncClosed();}catch{
    safeAlert(onAlert,'PRIVATE_BACKUP_FINAL_SYNC_FAILED');
    throw Error('private encrypted final archive upload failed');
   }
   let remote;
   try{remote=await backup.inventory({forceFull:true});}catch{
    safeAlert(onAlert,'PRIVATE_BACKUP_FINAL_INVENTORY_FAILED');
    throw Error('remote final inventory verification failed');
   }
   const report=Object.freeze({mode:'RAW_FRAMES_ONLY',clockQuality:'UNVERIFIED',
    frames:source?.health?.().framesReceived??null,recorded:writer.health().recorded,
    remoteLastSeq:remote.lastSeq,remoteArchiveVerified:true,
    postTrialIndependentRestoreVerified:false,reason});
   try{onResult(report);}catch{}
   return report;
  })();
  return ending;
 };
 const operatorStop=()=>{void stop('OPERATOR_STOP').catch(()=>{});};
 try{
  scheduler=createScheduler({backup,intervalMs:30000,onFailure:()=>fault('PRIVATE_BACKUP_FAILED')});
  source=createSource({recorder:writer,
   credentials:{username:env.IRONBEAM_USERNAME,password:env.IRONBEAM_PASSWORD,
    apiKey:env.IRONBEAM_API_KEY},fetchImpl,WebSocketImpl,onAlert:()=>fault('SOURCE_OR_RECORDER_FAILURE')});
  await writer.offer({raw:JSON.stringify({schema:'engine18.rawOnly.start.v1',
   physicalContract:CONTRACT,feedTypes:['quotes','depths','trades'],
   clockQuality:'UNVERIFIED',receiptTimeSource:'HOST_WALL_ANCHORED_MONOTONIC',
   timingInferenceAllowed:false,latencyConflationClaimsAllowed:false,
   vendorSequenceCompleteness:'UNVERIFIED',
   operatorRestoreReceipt:env.ENGINE18_RAW_DIAGNOSTIC_RESTORE_RECEIPT,
   trialMinutes:config.minutes}),msgClass:'control',statusCode:'DIAGNOSTIC_START'});
  await scheduler.tick();
  if(operatorSignal.aborted)throw Error('operator stopped before source connection');
  // Session deadline is measured from BEFORE connection, never extended by retry.
  started=true;operatorSignal.addEventListener('abort',operatorStop,{once:true});
  timeout=setTimeout(()=>{void stop('TIME_LIMIT').catch(()=>safeAlert(onAlert,'RAW_ONLY_STOP_FAILED'));},config.minutes*60000);
  scheduler.start();
  const connected=await source.start();
  if(connected!==true||faultCode||ended||operatorSignal.aborted){
   faultCode||='SOURCE_NOT_READY';
   throw Error('Ironbeam source refused, disconnected or exceeded bounded session');
  }
  monitor=setInterval(()=>{
   const h=writer.health(),s=source.health(),b=scheduler.health();
   const free=Number(h.diskFreeBytes),total=Number(h.diskTotalBytes);
   if(!h.recordingActive||h.failedClosed||h.rejected>0||h.gapCount>0||
      h.unacknowledged>=3686||!Number.isFinite(free)||!Number.isFinite(total)||
      total<=0||free/total<=0.2||!s.active||!s.connected||
      s.captureUncertain||s.disconnections>0||s.reconnects>0||
      b.failures>0||b.lastFailureAtMs!==null){
    fault('RAW_DIAGNOSTIC_HEALTH_STOP');
   }
  },1000);
  return Object.freeze({mode:'RAW_FRAMES_ONLY',clockQuality:'UNVERIFIED',
   contract:CONTRACT,stop,health:()=>({
    ...writer.health(),source:source.health(),backup:scheduler.health(),
    clockQuality:'UNVERIFIED',timingInferenceAllowed:false})});
 }catch{
  try{await stop('START_FAILURE');}catch{}
  throw Error('raw-only Ironbeam diagnostic failed closed; no verified time');
 }
}
// No automatic start. It requires an operator-supplied AbortSignal and all
// independent preflight gates; the normal controlled worker stays untouched.
