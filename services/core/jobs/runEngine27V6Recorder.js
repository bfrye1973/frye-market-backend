// Production startup opt-in entrypoint. NOT part of Render startCommand yet.
import {runRecorderWorker} from "../logic/engine27/waveObservation/runRecorderWorker.js";
const controller=new AbortController();
for(const signal of ["SIGTERM","SIGINT"])
 process.on(signal,()=>controller.abort());
const result=await runRecorderWorker({signal:controller.signal,
 enabled:process.env.ENGINE27_V6_RECORDER_ENABLED==="true",
 sleepMs:60000});
if(!result.ok){
 console.error("[engine27-v6-recorder]",JSON.stringify({status:result.status,reason:result.reason??null}));
 process.exitCode=1;
}else{
 console.log("[engine27-v6-recorder]",JSON.stringify({status:result.status,cycles:result.cycles}));
}
