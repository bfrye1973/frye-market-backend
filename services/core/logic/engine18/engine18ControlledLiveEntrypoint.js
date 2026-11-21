// Dedicated PRIVATE worker entrypoint. Must never be used by the existing
// production market-data monitor, LIVE chart or trading/execution services.
// No activation unless every manager-approved environment gate passes.
import {verifyEngine18LiveEnvironment,runEngine18ControlledRecording} from './engine18ControlledLiveWorker.js';
async function main(){
 try{
  verifyEngine18LiveEnvironment(process.env);
  const {WebSocket}=await import('ws');
  const session=await runEngine18ControlledRecording({env:process.env,WebSocketImpl:WebSocket});
  const stop=()=>{
   void session.stop().then(()=>{
    const h=session.writer.health(),source=session.source.health(),backup=session.scheduler.health();
    process.stdout.write('ENGINE18_PRIVATE_TRIAL_SUMMARY '+JSON.stringify({
     recorded:h.recorded,received:h.received,rejected:h.rejected,
     recorderGaps:h.gapCount,recordedBytes:h.bytesWritten,
     diskFreeBytes:h.diskFreeBytes,sourceFrames:source.framesReceived,
     sourceDisconnects:source.disconnections,sourceAlerts:source.alerts,
     backupFailures:backup.failures,backupLagMs:backup.backupLagMs,
     fullDepthSemantics:'UNVERIFIED'
    })+'\n');
    process.exitCode=0;
   },()=>{
    process.stderr.write('ENGINE18_PRIVATE_ALERT SHUTDOWN_INCOMPLETE\n');
    process.exitCode=76;
   });
  };
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
 }catch{
  process.stderr.write('ENGINE18_PRIVATE_ALERT LIVE_TRIAL_NOT_AUTHORIZED_OR_NOT_READY\n');
  process.exitCode=78;
 }
}
void main();
// No HTTP listener, broker account or trade APIs.
