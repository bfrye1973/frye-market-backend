// Backend-1 direct-child supervisor for Engine8 watcher, HTTP server and optional
// Engine27 V6 recorder. Proposal only: Render startCommand remains unchanged.
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

export function startBackend1Supervisor({
 watcherScript="services/core/jobs/watchEngine8RealSchwabFills.js",
 serverScript="services/core/server.js",
 recorderScript="services/core/jobs/runEngine27V6Recorder.js",
 recorderEnabled=process.env.ENGINE27_V6_RECORDER_ENABLED==="true",
 spawnChild=spawn,restartMs=5000,recorderRestartMs=60000,
 maxRecorderRestarts=4,terminationGraceMs=5000
}={}){
 const children=new Map(),timers=new Set();
 let stopping=false, resolveDone,watcherStarts=0,recorderStarts=0;
 const done=new Promise(resolve=>{resolveDone=resolve});
 const schedule=(fn,ms)=>{if(stopping)return;const t=setTimeout(()=>{timers.delete(t);if(!stopping)fn()},ms);timers.add(t)};
 const start=(name,script)=>{
  if(stopping||children.has(name))return;
  const child=spawnChild(process.execPath,[script],{stdio:"inherit",env:process.env});
  children.set(name,child);
  if(name==="watcher")watcherStarts++;
  if(name==="recorder")recorderStarts++;
  child.once("exit",(code,signal)=>{
   if(children.get(name)===child)children.delete(name);
   if(stopping)return;
   if(name==="server"){void stop("SERVER_EXIT");return}
   if(name==="watcher")schedule(()=>start("watcher",watcherScript),restartMs);
   if(name==="recorder"&&recorderStarts<=maxRecorderRestarts)
    schedule(()=>start("recorder",recorderScript),recorderRestartMs);
   else if(name==="recorder")console.error("[engine27-v6-recorder] bounded restarts exhausted");
  });
 };
 async function stop(reason="SHUTDOWN"){
  if(stopping)return done;
  stopping=true;
  for(const t of timers)clearTimeout(t);timers.clear();
  const live=[...children.values()].filter(child=>child.exitCode===null&&child.signalCode===null);
  for(const child of live)try{child.kill("SIGTERM")}catch{}
  const waits=live.map(child=>new Promise(resolve=>{
   if(child.exitCode!==null||child.signalCode!==null)return resolve();
   const timer=setTimeout(()=>{try{child.kill("SIGKILL")}catch{};resolve()},terminationGraceMs);
   child.once("exit",()=>{clearTimeout(timer);resolve()});
  }));
  await Promise.all(waits);
  children.clear();
  resolveDone({reason,watcherStarts,recorderStarts});
  return done;
 }
 start("watcher",watcherScript);
 if(recorderEnabled)start("recorder",recorderScript);
 start("server",serverScript);
 return Object.freeze({stop,done,status:()=>({stopping,watcherStarts,recorderStarts,
  live:[...children.keys()],pids:Object.fromEntries([...children].map(([name,child])=>[name,child.pid]))})});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const supervisor=startBackend1Supervisor();
 process.once("SIGTERM",()=>{void supervisor.stop("SIGTERM")});
 process.once("SIGINT",()=>{void supervisor.stop("SIGINT")});
 await supervisor.done;
}
