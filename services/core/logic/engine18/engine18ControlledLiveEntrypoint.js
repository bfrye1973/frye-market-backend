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
   void session.stop().then(()=>{process.exitCode=0;},()=>{
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
