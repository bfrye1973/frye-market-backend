// Authenticated, bounded server-to-server observation relay, never browser/public feed.
// One Polygon socket per category; downstream SSE clients do not open provider sockets.
import express from "express";
import crypto from "node:crypto";
import {sharedOwner,ownerDiagnostics} from "./sharedMarketRuntime.js";
const router=express.Router();
const counts={QQQ:0,VIX:0};
const MAX_CLIENTS=4;
function authorized(req){
 const token=process.env.ENGINE27_SHARED_MARKET_READ_TOKEN||"";
 const header=req.get("authorization")||"";
 if(!token||!header.startsWith("Bearer "))return false;
 const a=Buffer.from(header.slice(7)),b=Buffer.from(token);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function safeTick(symbol,event){
 if(symbol==="QQQ"&&event?.ev==="T"&&event.sym==="QQQ"){
  const price=Number(event.p),time=Number(event.t);
  if(price>0&&Number.isFinite(price)&&Number.isSafeInteger(time))return {ev:"T",sym:"QQQ",p:price,t:time};
 }
 if(symbol==="VIX"&&event?.ev==="V"&&event.T==="I:VIX"){
  const price=Number(event.val),time=Number(event.t);
  if(price>0&&Number.isFinite(price)&&Number.isSafeInteger(time))return {ev:"V",T:"I:VIX",val:price,t:time};
 }
 return null;
}
router.get("/state",(req,res)=>{
 if(!authorized(req))return res.status(401).end();
 res.set("Cache-Control","no-store").json({schema:"engine27.sharedMarketDiagnostics.v1",
  owners:ownerDiagnostics(),activeRelayClients:{...counts},noExecution:true});
});
router.get("/observations/:symbol",(req,res)=>{
 if(!authorized(req))return res.status(401).end();
 const symbol=String(req.params.symbol).toUpperCase();
 if(!["QQQ","VIX"].includes(symbol))return res.status(404).end();
 if(counts[symbol]>=MAX_CLIENTS)return res.status(429).end();
 const owner=sharedOwner(symbol==="QQQ"?"stocks":"indices");
 counts[symbol]++;
 res.set({"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store, no-transform",
  "Connection":"keep-alive","X-Accel-Buffering":"no"});
 res.flushHeaders?.();
 let alive=true;
 const send=msg=>{
  if(!alive)return;
  if(res.writableLength>65536){close();return}
  try{res.write("data: "+JSON.stringify(msg)+"\n\n")}catch{close()}
 };
 const topic=symbol==="QQQ"?"T.QQQ":"V.I:VIX";
 const stop=owner.subscribe(topic,({event,sequence})=>{
  const tick=safeTick(symbol,event);
  if(tick)send({type:"tick",symbol,sequence,tick,noExecution:true});
 });
 const stopStatus=owner.onStatus(st=>send({type:"source",symbol,state:st.state,
  connectionCount:st.connectionCount,reason:st.reason,noExecution:true}));
 const heartbeat=setInterval(()=>send({type:"heartbeat",symbol,at:new Date().toISOString()}),10000);
 heartbeat.unref?.();
 function close(){
  if(!alive)return;alive=false;clearInterval(heartbeat);stop();stopStatus();
  counts[symbol]=Math.max(0,counts[symbol]-1);
  try{res.end()}catch{}
 }
 send({type:"source",symbol,state:owner.status().state,
  connectionCount:owner.status().connectionCount,reason:owner.status().reason,noExecution:true});
 req.on("close",close);
});
export default router;
