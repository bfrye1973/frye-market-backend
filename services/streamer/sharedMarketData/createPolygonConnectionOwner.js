// One Polygon WebSocket per asset class, no socket per dashboard client.
// All events stay in memory; subscriptions are reference-counted. ES not handled.
import WebSocket from "ws";
import {createSharedMarketEventBus} from "./createSharedMarketEventBus.js";
const TYPES={stocks:{url:"wss://socket.polygon.io/stocks",topics:["T.SPY","T.QQQ","AM.SPY","AM.QQQ"]},
 indices:{url:"wss://socket.polygon.io/indices",topics:["V.I:VIX"]}};
export function createPolygonConnectionOwner({assetClass,apiKey,Socket=WebSocket,clock=()=>Date.now(),
  maxListenersPerTopic=128}={}){
 const config=TYPES[assetClass];
 if(!config)throw Error("UNSUPPORTED_ASSET_CLASS");
 const bus=createSharedMarketEventBus({maxListenersPerTopic});
 const demands=new Map(config.topics.map(t=>[t,0]));
 let ws=null,retry=null,stopped=false,connected=false,generation=0,attempt=0;
 let state="IDLE",reason=null,lastEventAt=null;
 const notifyStatus=new Set();
 const emitStatus=()=>{for(const fn of notifyStatus){try{fn(status())}catch{}}};
 const topicOf=m=>m?.ev==="V"&&m.T==="I:VIX"?"V.I:VIX":
   (m?.ev==="T"||m?.ev==="AM")&&["SPY","QQQ"].includes(m.sym)?m.ev+"."+m.sym:null;
 function desired(){return [...demands].filter(([_,n])=>n>0).map(([t])=>t)}
 function schedule(){
  if(stopped||retry||desired().length===0)return;
  const delay=state==="SUBSCRIPTION_LIMIT"?300000:Math.min(30000,1000*2**Math.min(attempt++,5));
  retry=setTimeout(()=>{retry=null;connect()},delay);retry.unref?.();
 }
 function send(action,topics){
  if(!ws||!connected||topics.length===0)return;
  try{ws.send(JSON.stringify({action,params:topics.join(",")}))}catch{state="SEND_FAILURE";emitStatus()}
 }
 function connect(){
  if(stopped||ws||desired().length===0)return;
  if(!apiKey){state="PROVIDER_NOT_CONFIGURED";emitStatus();return}
  state="CONNECTING";reason=null;emitStatus();
  const id=++generation;let sock;
  try{sock=new Socket(config.url)}catch{state="CONNECTION_ERROR";emitStatus();schedule();return}
  ws=sock;connected=false;
  sock.on("open",()=>{if(id!==generation)return;try{sock.send(JSON.stringify({action:"auth",params:apiKey}))}catch{sock.close()}});
  sock.on("message",raw=>{
   if(id!==generation)return;
   let messages;try{messages=JSON.parse(String(raw))}catch{return}
   for(const m of Array.isArray(messages)?messages:[messages]){
    if(m?.ev==="status"){
     if(m.status==="auth_success"){
      connected=true;attempt=0;state="CONNECTED";reason=null;emitStatus();send("subscribe",desired());
     }else if(["auth_failed","max_connections","error"].includes(m.status)){
      state=m.status==="max_connections"?"SUBSCRIPTION_LIMIT":
        m.status==="auth_failed"?"AUTH_FAILED":"PROVIDER_REJECTED";
      reason=state;connected=false;emitStatus();
      try{sock.close()}catch{}
     }
     continue;
    }
    if(!connected)continue;
    const topic=topicOf(m);
    if(!topic||!demands.has(topic)||demands.get(topic)===0)continue;
    const outcome=bus.publish(topic,m,"POLYGON_"+assetClass.toUpperCase(),clock());
    if(outcome.accepted)lastEventAt=new Date(clock()).toISOString();
   }
  });
  sock.on("error",()=>{if(id!==generation)return;state="CONNECTION_ERROR";reason=state;emitStatus()});
  sock.on("close",()=>{
   if(id!==generation)return;
   ws=null;connected=false;
   if(stopped)return;
   if(!["SUBSCRIPTION_LIMIT","AUTH_FAILED","PROVIDER_REJECTED"].includes(state))state="DISCONNECTED";
   emitStatus();schedule();
  });
 }
 function subscribe(topic,handler){
  if(!demands.has(topic))throw Error("TOPIC_NOT_IN_ASSET_CLASS");
  const unsub=bus.subscribe(topic,handler);
  const count=demands.get(topic);demands.set(topic,count+1);
  if(count===0&&connected)send("subscribe",[topic]);
  if(!ws&&!stopped)connect();
  let closed=false;
  return ()=>{
   if(closed)return;closed=true;unsub();
   const n=Math.max(0,demands.get(topic)-1);demands.set(topic,n);
   if(n===0&&connected)send("unsubscribe",[topic]);
   if(desired().length===0){
    if(retry){clearTimeout(retry);retry=null}
    if(ws){const old=ws;ws=null;generation++;connected=false;try{old.close()}catch{}}
    state="IDLE";reason=null;emitStatus();
   }
  };
 }
 function status(){return {assetClass,state,reason,connectionCount:ws?1:0,connected,
  topics:desired(),lastEventAt,subscribers:bus.diagnostics().subscribers}}
 return Object.freeze({subscribe,status,onStatus(fn){notifyStatus.add(fn);return ()=>notifyStatus.delete(fn)},
  stop(){stopped=true;if(retry)clearTimeout(retry);if(ws){const old=ws;ws=null;generation++;try{old.close()}catch{}}state="STOPPED";emitStatus()}});
}
