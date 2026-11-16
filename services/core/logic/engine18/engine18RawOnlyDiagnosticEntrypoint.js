// MANUAL PRIVATE OPERATOR ONLY: not referenced by Render, main server or standby.
// No public routes or automatic capture. All live gates checked again in worker.
import {runEngine18RawOnlyDiagnostic} from './engine18RawOnlyDiagnosticWorker.js';
const controller=new AbortController();
const manualStop=()=>controller.abort();
process.once('SIGINT',manualStop);
process.once('SIGTERM',manualStop);
let session;
try{
 if(process.env.ENGINE18_RAW_DIAGNOSTIC_OPERATOR_START!=='YES')
  throw Error('operator did not explicitly request raw diagnostic');
 const {WebSocket}=await import('ws');
 session=await runEngine18RawOnlyDiagnostic({
  env:process.env,WebSocketImpl:WebSocket,operatorSignal:controller.signal
 });
 process.stdout.write('ENGINE18_RAW_DIAGNOSTIC_ACTIVE '+JSON.stringify({
  mode:'RAW_FRAMES_ONLY',clockQuality:'UNVERIFIED',timingInferenceAllowed:false
 })+'\n');
}catch{
 process.stderr.write('ENGINE18_RAW_DIAGNOSTIC_NOT_AUTHORIZED_OR_FAILED_CLOSED\n');
 process.exitCode=78;
}
// Stop is bounded by timer or operator SIGINT/SIGTERM; never auto-start from import.
