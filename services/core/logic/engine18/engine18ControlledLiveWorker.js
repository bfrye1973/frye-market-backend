// Engine 18 LIMITED independent read-only Ironbeam recorder entrypoint.
// Completely separate from existing chart/monitor/trading services.
// Hard disabled until manager approves private deployment and trial credentials.
import {statSync,existsSync,readFileSync} from 'node:fs';
import {Engine18BufferedRecorder} from './engine18BufferedRecorder.js';
import {Engine18IronbeamLiveRecorderSource} from './engine18IronbeamLiveRecorderSource.js';
import {createEngine18ReceiptClock} from './engine18ReceiptClock.js';
import {Engine18S3PrivateStore} from './engine18S3PrivateStore.js';
import {Engine18S3ArchiveCoordinator} from './engine18Phase5S3Coordinator.js';
import {Engine18ContinuousBackup} from './engine18ContinuousBackup.js';
import {makeChronySampler} from './engine18ClockQuality.js';
import {assessEngine18RecorderHealth} from './engine18Phase4HealthPolicy.js';

export function verifyEngine18LiveEnvironment(env,stat=statSync){
 const required=['IRONBEAM_USERNAME','IRONBEAM_PASSWORD','IRONBEAM_API_KEY',
  'ENGINE18_RECORDER_DISK','ENGINE18_R2_ENDPOINT','ENGINE18_R2_BUCKET',
  'ENGINE18_R2_ACCESS_KEY','ENGINE18_R2_SECRET_KEY','ENGINE18_R2_ENCRYPTION_KEY_HEX',
  'ENGINE18_R2_KEY_ID','ENGINE18_INDEPENDENT_INVENTORY_PIN',
  'ENGINE18_CME_CALENDAR_VERIFIED'];
 const missing=required.filter(k=>!env[k]);
 if(missing.length)throw Error('private recorder missing environment requirements: '+missing.join(','));
 if(env.ENGINE18_LIVE_CAPTURE_APPROVED!=='YES'||
    env.ENGINE18_MANAGER_TRIAL_ACCEPTED!=='YES'||
    env.ENGINE18_CME_CALENDAR_VERIFIED!=='YES')
  throw Error('real Ironbeam capture disabled without manager operational acceptance');
 const disk=env.ENGINE18_RECORDER_DISK;
 if(!disk.startsWith('/var/data/engine18-recorder/')||disk.includes('..')||
    disk.startsWith('/var/data/replay'))
  throw Error('refusing shared or non-private recorder mount');
 if(!existsSync(disk)||!stat(disk).isDirectory())throw Error('dedicated recorder directory absent');
 // Avoid silently using Render's ephemeral root filesystem. The worker must
 // actually have the dedicated disk mounted at the proposed private mount.
 let mounts='';try{mounts=readFileSync('/proc/self/mountinfo','utf8');}catch{}
 if(!mounts.split('\n').some(line=>line.split(' - ')[0]?.trim().split(/\s+/)[4]==='/var/data/engine18-recorder'))
  throw Error('dedicated private persistent disk mount not verified');
 if(!/^[a-fA-F0-9]{64}$/.test(env.ENGINE18_R2_ENCRYPTION_KEY_HEX))
  throw Error('private backup encryption key invalid');
 const pin=Number(env.ENGINE18_INDEPENDENT_INVENTORY_PIN);
 if(!Number.isSafeInteger(pin)||pin<0)throw Error('independent remote inventory pin missing');
 const windowMinutes=Number(env.ENGINE18_TRIAL_MINUTES);
 if(!Number.isInteger(windowMinutes)||windowMinutes<1||windowMinutes>30)
  throw Error('trial must be explicitly bounded to 1-30 minutes');
 return Object.freeze({disk,windowMinutes,expectedLastSeq:pin});
}
function alert(code){process.stderr.write('ENGINE18_PRIVATE_ALERT '+code+'\n');}
export async function runEngine18ControlledRecording({env=process.env,
 fetchImpl=fetch,WebSocketImpl,onAlert=alert}={}){
 if(typeof WebSocketImpl!=='function')throw Error('explicit private WebSocket transport required');
 const config=verifyEngine18LiveEnvironment(env);
 // The private host must supply actual Chrony evidence before recording.
 const chrony=makeChronySampler();
 const initialSample=await chrony();
 if(!initialSample||BigInt(initialSample.uncertaintyNs)>5000000n||
    (BigInt(initialSample.offsetNs)<0n?-BigInt(initialSample.offsetNs):BigInt(initialSample.offsetNs))>5000000n)
  throw Error('controlled trial refuses unverified or imprecise host clock');
 const clock=createEngine18ReceiptClock();
 const encryptedStore=new Engine18S3PrivateStore({
  endpoint:env.ENGINE18_R2_ENDPOINT,bucket:env.ENGINE18_R2_BUCKET,
  region:env.ENGINE18_R2_REGION||'auto',accessKeyId:env.ENGINE18_R2_ACCESS_KEY,
  secretAccessKey:env.ENGINE18_R2_SECRET_KEY,
  keyId:env.ENGINE18_R2_KEY_ID,
  encryptionKey:Buffer.from(env.ENGINE18_R2_ENCRYPTION_KEY_HEX,'hex'),
  stagingRoot:config.disk,retentionDays:Number(env.ENGINE18_RETENTION_DAYS||30)
 });
 const backup=new Engine18S3ArchiveCoordinator({root:config.disk,store:encryptedStore});
 // Verify private remote state before opening a recorder or writing START.
 await backup.inventory({expectedLastSeq:config.expectedLastSeq});
 const writer=await Engine18BufferedRecorder.openBounded({
  root:config.disk,clock,maxQueued:4096,maxQueueBytes:32*1024*1024,
  batchSize:128,flushDelayMs:2,provider:'IRONBEAM_V2',
  allowLiveProvider:true
 });
 const scheduler=new Engine18ContinuousBackup({backup,intervalMs:30000,onFailure:onAlert});
 const source=new Engine18IronbeamLiveRecorderSource({
  recorder:writer,credentials:{username:env.IRONBEAM_USERNAME,
   password:env.IRONBEAM_PASSWORD,apiKey:env.IRONBEAM_API_KEY},
  fetchImpl,WebSocketImpl,onAlert
 });
 let finished=false,heartbeat=null,stopTimer=null,clockTimer=null;
 const stop=async()=>{
  if(finished)return;finished=true;
  clearInterval(heartbeat);clearInterval(clockTimer);clearTimeout(stopTimer);
  await source.stop();
  await scheduler.stop();
  if(writer.health().failedClosed){onAlert('RECORDER_UNCLEAN_SHUTDOWN');return;}
  await writer.close();
  // Upload newly sealed final hour; verify complete backup against independent pin
  // only if it is independently advanced by authorized operations.
  await backup.syncClosed();
 };
 try{
  // Durable nonsecret run identity for historical replay; vendor payloads remain raw.
  const softwareVersion=String(env.ENGINE18_SOFTWARE_VERSION||'UNSPECIFIED').replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80);
  const gitCommit=String(env.ENGINE18_GIT_COMMIT||'UNSPECIFIED').replace(/[^A-Fa-f0-9]/g,'').slice(0,40)||'UNVERIFIED';
  await writer.offer({raw:JSON.stringify({schema:'engine18.recorder.startup.v1',
   softwareVersion,gitCommit,provider:'IRONBEAM_V2',apiVersion:'v2',
   physicalContract:'XCME:ES.Z26',contractMapping:'XCME:ES.Z26',
   clockSource:'HOST_WALL_ANCHORED_MONOTONIC',clockQuality:'UNVERIFIED',
   trialMinutes:config.windowMinutes}),msgClass:'control',statusCode:'RECORDER_METADATA'});
  // Establish a trusted backup heartbeat before accepting source frames.
  await scheduler.tick();
  scheduler.start();
  // Revalidate host time source periodically; mark collection unsafe on failure.
  clockTimer=setInterval(()=>{
   void chrony().then(sample=>{
    if(!sample||BigInt(sample.uncertaintyNs)>5000000n||
       (BigInt(sample.offsetNs)<0n?-BigInt(sample.offsetNs):BigInt(sample.offsetNs))>5000000n){
     onAlert('CLOCK_QUALITY_LOST');void stop().catch(()=>{});
    }
   }).catch(()=>{onAlert('CLOCK_QUALITY_LOST');void stop().catch(()=>{});});
  },60000);
  clockTimer.unref?.();
  stopTimer=setTimeout(()=>{void stop().catch(()=>onAlert('SHUTDOWN_INCOMPLETE'));},config.windowMinutes*60000);
  const connected=await source.start();
  if(connected!==true)throw Error('initial Ironbeam subscription not established');
  heartbeat=setInterval(()=>{
   const h=writer.health(),b=scheduler.health(),s=source.health();
   const flags=assessEngine18RecorderHealth({
    recordingActive:h.recordingActive,workerConnected:s.active,
    diskFreeBytes:h.diskFreeBytes,diskTotalBytes:h.diskTotalBytes,
    queueDepth:h.unacknowledged,queueCapacity:4096,
    backupLagMinutes:b.backupLagMs===null?null:b.backupLagMs/60000,
    backupInventoryVerified:b.failures===0,
    clockQuality:'VERIFIED',calendarQuality:'VERIFIED',
    gaps:h.gapCount,rejected:h.rejected,writeFailures:h.failedClosed?1:0
   });
   const reconnectExceeded=!s.connected&&s.disconnectedSinceMs!==null&&
    Date.now()-s.disconnectedSinceMs>30000;
   if(flags.shouldHalt||!s.active||reconnectExceeded){
    onAlert('LIVE_RECORDER_HEALTH_STOP');void stop().catch(()=>onAlert('SHUTDOWN_INCOMPLETE'));
   }else if(!s.connected)onAlert('IRONBEAM_SOURCE_RECONNECTING');
  },5000);
  return {source,writer,backup,scheduler,stop};
 }catch{
  await stop().catch(()=>{});
  throw Error('controlled Ironbeam recorder startup failed closed');
 }
}
// No auto-start on import. An explicitly authorized private worker operator
// invokes this function through the reviewed service entrypoint.
