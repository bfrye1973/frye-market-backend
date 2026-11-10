// Engine 18 isolated Ironbeam v2 DEMO Level 2 research monitor.
// MARKET DATA ONLY. No order/account/trading methods, no raw packets in logs.
// Automatically recreates stream after disconnect; bounded in-memory research.
// For demo only; entitlement/delay remains unverified.
import {createEngine18Level2ZoneReader} from "./ironbeamV2Level2Zones.js";
const HOST="https://demo.ironbeamapi.com";
const SYMBOL="XCME:ES.Z26";
const SUBS=["quotes","depths","trades"];
export function startEngine18IronbeamLevel2Monitor({
 username,password,apikey,fetchImpl=fetch,WebSocketImpl=globalThis.WebSocket,
 onStatus=()=>{},initialRetryMs=2000,maxRetryMs=60000,
 heartbeatTimeoutMs=30000
}={}){
 if(!username||!password||!apikey)throw Error("ENGINE18_DEMO_CREDENTIALS_REQUIRED");
 if(typeof WebSocketImpl!=="function")throw Error("ENGINE18_WEBSOCKET_NOT_AVAILABLE");
 let zoneReader=createEngine18Level2ZoneReader({symbol:SYMBOL,minObservations:3,
   maxHistory:180,allowDelayedResearch:true});
 let stopped=false,ws=null,reconnectTimer=null,watchdog=null,generation=0;
 let lastMessageAt=0,backoff=initialRetryMs;
 const stats={mode:"DEMO_RESEARCH",state:"STARTING",connected:false,
   subscriptions:{quotes:false,depth:false,trades:false},frames:{q:0,d:0,tr:0},
   reconnects:0,authenticated:false,lastErrorCode:null,streamEstablishedAt:null,
   lastFrameReceivedAt:null,level3:false,tradingEnabled:false};
 const safeStatus=()=>({...stats,frames:{...stats.frames},
   subscriptions:{...stats.subscriptions},
   zoneSummary:(()=>{const s=zoneReader.snapshot({feedTier:"UNVERIFIED"});
     return {usable:s.usable,reason:s.reason,images:s.images,
       zoneCount:s.zones.length,lastReceivedMs:s.lastReceivedMs,
       displayOnly:true,level3:false};})()});
 const notify=()=>{try{onStatus(safeStatus());}catch{}};
 const stopConnection=()=>{if(watchdog){clearInterval(watchdog);watchdog=null;}
   if(ws){try{ws.close();}catch{}ws=null;}stats.connected=false;};
 const schedule=(code)=>{
   if(stopped||stats.state==="RECONNECTING")return;
   ++generation; // Old close/error handlers cannot trigger another reconnect.
   stats.state="RECONNECTING";stats.lastErrorCode=code;
   stopConnection();
   zoneReader=createEngine18Level2ZoneReader({symbol:SYMBOL,minObservations:3,maxHistory:180,allowDelayedResearch:true});
   stats.reconnects++;notify();
   if(reconnectTimer)clearTimeout(reconnectTimer);
   reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();},backoff);
   backoff=Math.min(backoff*2,maxRetryMs);
 };
 const api=async(path,token,method="GET",body)=>{
   const res=await fetchImpl(HOST+path,{method,headers:{
     Accept:"application/json",...(body?{"Content-Type":"application/json"}:{}),
     ...(token?{Authorization:"Bearer "+token}:{})},
     ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
   if(!res.ok)throw Error("ENGINE18_HTTP_"+res.status);
   const json=await res.json();
   if(json?.status==="ERROR")throw Error("ENGINE18_API_REJECTED");
   return json;
 };
 async function connect(){
   if(stopped)return;
   const myGeneration=++generation;
   stats.state="CONNECTING";stats.authenticated=false;notify();
   try{
     const login=await api("/v2/auth",null,"POST",{username,password,apiKey:apikey});
     if(!login?.token||stopped||generation!==myGeneration)throw Error("ENGINE18_AUTH_FAILED");
     stats.authenticated=true;
     const created=await api("/v2/stream/create",login.token);
     if(!created?.streamId||stopped||generation!==myGeneration)throw Error("ENGINE18_STREAM_CREATE_FAILED");
     const url="wss://demo.ironbeamapi.com/v2/stream/"+
       encodeURIComponent(created.streamId)+"?token="+encodeURIComponent(login.token);
     const socket=new WebSocketImpl(url);ws=socket;
     await new Promise((resolve,reject)=>{
       let done=false;
       const complete=(err)=>{if(done)return;done=true;clearTimeout(timeout);
         if(err)reject(Error(err));else resolve();};
       const timeout=setTimeout(()=>complete("ENGINE18_WS_OPEN_TIMEOUT"),6000);
       socket.addEventListener("open",()=>complete(null),{once:true});
       socket.addEventListener("error",()=>complete("ENGINE18_WS_OPEN_ERROR"),{once:true});
       socket.addEventListener("close",()=>complete("ENGINE18_WS_EARLY_CLOSE"),{once:true});
     });
     if(stopped||myGeneration!==generation){try{socket.close();}catch{}return;}
     stats.connected=true;stats.streamEstablishedAt=Date.now();
     stats.subscriptions={quotes:false,depth:false,trades:false};notify();
     socket.addEventListener("message",event=>{
       if(stopped||myGeneration!==generation)return;
       lastMessageAt=Date.now();stats.lastFrameReceivedAt=lastMessageAt;
       try{
         const p=JSON.parse(typeof event.data==="string"?event.data:String(event.data));
         if(p?.q!=null)stats.frames.q++;
         if(p?.tr!=null)stats.frames.tr++;
         if(p?.d!=null){stats.frames.d++;zoneReader.observe(p,{receivedAtMs:lastMessageAt});}
       }catch{stats.lastErrorCode="MALFORMED_FRAME";}
     });
     socket.addEventListener("close",()=>{if(!stopped&&myGeneration===generation)schedule("WS_CLOSED");});
     socket.addEventListener("error",()=>{if(!stopped&&myGeneration===generation)schedule("WS_ERROR");});
     for(const type of SUBS){
       await api("/v2/market/"+type+"/subscribe/"+encodeURIComponent(created.streamId)+
         "?symbols="+encodeURIComponent(SYMBOL),login.token);
       if(stopped||myGeneration!==generation)return;
       stats.subscriptions[type==="depths"?"depth":type]=true;
     }
     backoff=initialRetryMs;lastMessageAt=Date.now();
     stats.state="RECEIVING";notify();
     watchdog=setInterval(()=>{
       if(stopped||myGeneration!==generation)return;
       if(Date.now()-lastMessageAt>heartbeatTimeoutMs)
         schedule("STREAM_HEARTBEAT_TIMEOUT");
       else notify();
     },5000);
   }catch{
     if(!stopped&&myGeneration===generation)schedule("CONNECTION_OR_SUBSCRIPTION_FAILED");
   }
 }
 const monitor=Object.freeze({
   status:safeStatus,
   // Detail stays inside server memory, not exposed through public endpoints.
   research:()=>zoneReader.snapshot({feedTier:"UNVERIFIED"}),
   stop:()=>{stopped=true;generation++;if(reconnectTimer)clearTimeout(reconnectTimer);
     stopConnection();stats.state="STOPPED";notify();}
 });
 connect();
 return monitor;
}
