// Engine 18 live worker v1: thin runner + read-only HTTP endpoint shape. NOT deployed.
// - The runner feeds parsed Rithmic messages (from any source that emits parseInbound() objects) into the
//   pure live worker and closes minutes on a wall-clock tick. It opens no sockets itself: the long-running
//   Rithmic session adapter (login, subscribe, heartbeat, reconnect, logout) is a separate, later step.
// - GET /engine18/live returns the latest snapshot. Gated by ENGINE18_LIVE_ENDPOINT_ENABLED=YES (default OFF).
// Read-only. No trading, no order plant, no recording, no credentials or raw data in responses.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createLiveWorker} from './engine18LiveWorker.js';
import {parseOwnerZones} from './engine18LiquidityMap.js';

export const LIVE_ENDPOINT_PATH='/engine18/live';

// Owner hand-drawn zones: read-only.
export function loadOwnerZones(path=fileURLToPath(new URL('../../data/es-smz-manual-zones.txt',import.meta.url))){
 try{return parseOwnerZones(fs.readFileSync(path,'utf8'))}catch{return []}
}

export function createLiveRunner({worker=null,workerParams={},now=Date.now,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval,tickMs=1000}={}){
 const w=worker||createLiveWorker({ownerZones:loadOwnerZones(),...workerParams});
 let timer=null,started=null,messages=0,lastMinuteAt=null;
 const onSnap=s=>{if(s)lastMinuteAt=now()};
 return {
  start(){if(timer)return;started=now();timer=setIntervalImpl(()=>onSnap(w.tick(Math.floor(now()/1000))),tickMs)},
  stop(){if(timer){clearIntervalImpl(timer);timer=null}},
  onMessage(msg){messages++;onSnap(w.ingest(msg))},
  snapshot(){return w.snapshot()},
  health(){return {running:!!timer,startedAt:started,messages,lastMinuteAt,builder:w.stats()}},
 };
}

// Returns a request handler (req,res)=>boolean (true when it handled the request).
export function createLiveHttpHandler({getSnapshot,getHealth=()=>null,env=process.env}){
 return (req,res)=>{
  const path=(req.url||'').split('?')[0];
  if(path!==LIVE_ENDPOINT_PATH)return false;
  if(env.ENGINE18_LIVE_ENDPOINT_ENABLED!=='YES'){res.writeHead(404);res.end();return true}
  if(req.method!=='GET'){res.writeHead(405,{allow:'GET'});res.end();return true}
  const snap=getSnapshot();
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(snap?{status:'LIVE',snapshot:snap,health:getHealth()}:{status:'WARMING_UP',snapshot:null,health:getHealth()}));
  return true;
 };
}
