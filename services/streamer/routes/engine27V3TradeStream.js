// Engine27 V3 trade-only, protected read-only SSE; one Polygon socket per Render instance.
// Feature branch only. No journal/order writes and no source secrets in output.
import express from "express";
import WebSocket from "ws";
import {normalizeEngine27V3EsTrade} from "./engine27V3TradeContract.js";
import {resolveFuturesContract} from "./futuresStream.js";
const router=express.Router();
const wsUrl=process.env.POLY_FUTURES_WS_URL||process.env.POLYGON_FUTURES_WS_URL||"wss://socket.polygon.io/futures";
const key=()=>process.env.POLYGON_API||process.env.POLYGON_API_KEY||process.env.POLY_API_KEY||"";
const subscribers=new Set();
const blocked=new Set();
const MAX_WRITABLE_BYTES=65536;
const MAX_SUBSCRIBERS=8;
let socket=null,contract=null,starting=false,retry=null,retryAttempt=0,authenticated=false;
const send=(res,x)=>{if(res.destroyed||res.writableEnded)return false;return res.write("data: "+JSON.stringify(x)+"\n\n")};
function fanout(data){for(const res of subscribers){if(!send(res,data)){subscribers.delete(res);try{res.end()}catch{}}}}
function teardown(){
 if(retry){clearTimeout(retry);retry=null}
 if(socket){try{socket.close()}catch{}socket=null}
 contract=null;starting=false;authenticated=false;retryAttempt=0;
}
function retryConnect(){
 if(!subscribers.size){teardown();return}
 const wait=Math.min(30000,1000*2**Math.min(retryAttempt++,5));
 fanout({ok:false,type:"status",reasonCode:"SOURCE_RECONNECTING",retryAfterMs:wait});
 retry=setTimeout(()=>{retry=null;void startSharedFeed()},wait);
}
async function startSharedFeed(){
 if(starting||socket||retry||!subscribers.size)return;
 starting=true;
 try{
  const resolved=await resolveFuturesContract("ES");
  const next=String(resolved?.resolvedSymbol??"").toUpperCase();
  if(!resolved?.ok||!/^ES[FGHJKMNQUVXZ][0-9]{1,2}$/.test(next))throw new Error("CONTRACT_UNAVAILABLE");
  if(contract&&contract!==next)fanout({ok:false,type:"status",reasonCode:"CONTRACT_ROLLOVER_RESET"});
  contract=next;
  const ws=new WebSocket(wsUrl);socket=ws;authenticated=false;
  ws.on("open",()=>{ws.send(JSON.stringify({action:"auth",params:key()}))});
  ws.on("message",buf=>{
   let msgs;try{msgs=JSON.parse(buf.toString("utf8"))}catch{return}
   for(const m of Array.isArray(msgs)?msgs:[msgs]){
    if(m?.ev==="status"){
     if(m.status==="auth_success"&&!authenticated){
       authenticated=true;retryAttempt=0;
       ws.send(JSON.stringify({action:"subscribe",params:"T."+contract}));
       fanout({ok:true,type:"snapshot",symbol:"ES",resolvedSymbol:contract,source:"POLYGON_DIRECT_ES_TRADE",readOnly:true});
     }else if(m.status==="auth_failed"){fanout({ok:false,type:"status",reasonCode:"PROVIDER_AUTH_FAILED"});try{ws.close()}catch{}}
     continue;
    }
    if(!authenticated)continue;
    const observedAt=new Date().toISOString();
    const event=normalizeEngine27V3EsTrade(m,{resolvedSymbol:contract,observedAt});
    if(event)fanout(event);
   }
  });
  ws.on("error",()=>fanout({ok:false,type:"status",reasonCode:"PROVIDER_STREAM_ERROR"}));
  ws.on("close",()=>{
   if(socket!==ws)return;
   socket=null;authenticated=false;
   fanout({ok:false,type:"status",reasonCode:"PROVIDER_STREAM_DISCONNECTED"});
   retryConnect();
  });
 }catch{
  fanout({ok:false,type:"status",reasonCode:"SOURCE_CONNECT_FAILED"});retryConnect();
 }finally{starting=false}
}
router.get("/",async(req,res)=>{
 const token=process.env.ENGINE27_V3_TRADE_READ_TOKEN;
 if(!token)return res.status(503).json({ok:false,error:"V3_TRADE_FEED_DISABLED"});
 // Header token only, not browser URL query strings or loggable credentials.
 if(req.get("X-Engine27-V3-Read-Token")!==token)return res.status(401).json({ok:false,error:"UNAUTHORIZED"});
 if(req.query.symbol&&String(req.query.symbol).toUpperCase()!=="ES")return res.status(400).json({ok:false,error:"ES_ONLY"});
 if(subscribers.size>=MAX_SUBSCRIBERS)return res.status(429).json({ok:false,error:"SUBSCRIBER_LIMIT"});
 if(!key())return res.status(503).json({ok:false,error:"PRICE_PROVIDER_UNAVAILABLE"});
 res.setHeader("Content-Type","text/event-stream; charset=utf-8");
 res.setHeader("Cache-Control","no-store, no-transform");
 res.setHeader("Connection","keep-alive");
 res.setHeader("X-Accel-Buffering","no");
 res.flushHeaders?.();
 subscribers.add(res);
 res.on("drain",()=>blocked.delete(res));
 if(authenticated&&contract)send(res,{ok:true,type:"snapshot",symbol:"ES",resolvedSymbol:contract,source:"POLYGON_DIRECT_ES_TRADE",readOnly:true});
 const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(":heartbeat\n\n")},15000);
 req.on("close",()=>{
  clearInterval(heartbeat);subscribers.delete(res);blocked.delete(res);
  if(!subscribers.size)teardown();
 });
 void startSharedFeed();
});
export default router;
