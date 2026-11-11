// Engine 18 LIMITED independent read-only Ironbeam recorder entrypoint.
// Completely separate from existing chart/monitor/trading services.
// Hard disabled until manager approves private deployment and trial credentials.
import {statSync,realpathSync,existsSync} from 'node:fs';
import {WebSocket} from 'ws';
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
  'ENGINE18_R2_KEY_ID','ENGINE18_INDEPENDENT_INVENTORY_PIN'];
 const missing=required.filter(k=>!env[k]);
 if(missing.length)throw Error('private recorder missing environment requirements: '+missing.join(','));
 if(env.ENGINE18_LIVE_CAPTURE_APPROVED!=='YES'||
    env.ENGINE18_MANAGER_TRIAL_ACCEPTED!=='YES')
  throw Error('real Ironbeam capture disabled without manager operational acceptance');
 const disk=env.ENGINE18_RECORDER_DISK;
 if(!disk.startsWith('/var/data/engine18-recorder/')||disk.includes('..')||
    disk.startsWith('/var/data/replay'))
  throw Error('refusing shared or non-private recorder mount');
 if(!existsSync(disk)||!stat(disk).isDirectory())throw Error('dedicated recorder directory absent');
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
 fetchImpl=fetch,WebSocketImpl=WebSocket,onAlert=alert}={}){
 const config=verifyEngine18LiveEnvironment(env);
 const clock=createEngine18ReceiptClock();
 const writer=await Engine18BufferedRecorder.openBounded({
  root:config.disk,clock,maxQueued:4096,maxQueueBytes:32*1024*1024,
  batchSize:128,flushDelayMs:2
 });
 const encryptedStore=new Engine18S3PrivateStore({
  endpoint:env.ENGINE18_R2_ENDPOINT,bucket:env.ENGINE18_R2_BUCKET,
  region:env.ENGINE18_R2_REGION||'auto',accessKeyId:env.ENGINE18_R2_ACCESS_KEY,
  secretAccessKey:env.ENGINE18_R2_SECRET_KEY,
  keyId:env.ENGINE18_R2_KEY_ID,
  encryptionKey:Buffer.from(env.ENGINE18_R2_ENCRYPTION_KEY_HEX,'hex'),
  stagingRoot:config.disk,retentionDays:Number(env.ENGINE18_RETENTION_DAYS||30)
 });
 const backup=new Engine18S3ArchiveCoordinator({root:config.disk,store:encryptedStore});
 const scheduler=new Engine18ContinuousBackup({backup,intervalMs:30000,onFailure:onAlert});
 const source=new Engine18IronbeamLiveRecorderSource({
  recorder:writer,credentials:{username:env.IRONBEAM_USERNAME,
   password:env.IRONBEAM_PASSWORD,apiKey:env.IRONBEAM_API_KEY},
  fetchImpl,WebSocketImpl,onAlert
 });
 let finished=false,heartbeat=null,stopTimer=null;
 const stop=async()=>{
  if(finished)return;finished=true;
  clearInterval(heartbeat);clearTimeout(stopTimer);
  await source.stop();
  await scheduler.stop();
  if(writer.health().failedClosed){onAlert('RECORDER_UNCLEAN_SHUTDOWN');return;}
  await writer.close();
  // Upload newly sealed final hour; verify complete backup against independent pin
  // only if it is independently advanced by authorized operations.
  await backup.syncClosed();
 };
 try{
  await backup.inventory({expectedLastSeq:config.expectedLastSeq});
  scheduler.start();
  heartbeat=setInterval(()=>{
   const h=writer.health(),b=scheduler.health(),s=source.health();
   const flags=assessEngine18RecorderHealth({
    recordingActive:h.recordingActive,workerConnected:s.active,
    diskFreeBytes:h.diskFreeBytes,diskTotalBytes:h.diskTotalBytes,
    queueDepth:h.unacknowledged,queueCapacity:4096,
    backupLagMinutes:b.backupLagMs===null?null:b.backupLagMs/60000,
    backupInventoryVerified:b.failures===0,
    clockQuality:'UNVERIFIED',calendarQuality:'UNVERIFIED',
    gaps:h.gapCount,rejected:h.rejected,writeFailures:h.failedClosed?1:0
   });
   if(flags.shouldHalt||!s.active){onAlert('LIVE_RECORDER_HEALTH_STOP');void stop();}
  },5000);
  // Host clock quality remains UNVERIFIED until direct Chrony evidence is observed.
  const chrony=makeChronySampler();
  void chrony().then(sample=>{
   if(!sample)onAlert('CLOCK_QUALITY_UNVERIFIED');
  }).catch(()=>onAlert('CLOCK_QUALITY_UNVERIFIED'));
  stopTimer=setTimeout(()=>{void stop();},config.windowMinutes*60000);
  await source.start();
  return {source,writer,backup,scheduler,stop};
 }catch{
  await stop().catch(()=>{});
  throw Error('controlled Ironbeam recorder startup failed closed');
 }
}
// No auto-start on import. An explicitly authorized private worker operator
// invokes this function through the reviewed service entrypoint.
