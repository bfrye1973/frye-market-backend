// Additive, read-only, trade-only ES feed for Engine27 V3 shadow development.
// No entry, execution, trade management, bar aggregation or broker writes.
import express from "express";
import WebSocket from "ws";
import { normalizeEngine27V3EsTrade } from "./engine27V3TradeContract.js";
import { resolveFuturesContract } from "./futuresStream.js";
const router=express.Router();
const wsUrl=process.env.POLY_FUTURES_WS_URL||process.env.POLYGON_FUTURES_WS_URL||"wss://socket.polygon.io/futures";
const apiKey=()=>process.env.POLYGON_API||process.env.POLYGON_API_KEY||process.env.POLY_API_KEY||"";
const send=(res,data)=>{if(!res.destroyed&&!res.writableEnded)res.write("data: "+JSON.stringify(data)+"\n\n")};
router.get("/",async(req,res)=>{
 if(req.query.symbol && String(req.query.symbol).toUpperCase()!=="ES")return res.status(400).json({ok:false,error:"ES_ONLY"});
 const key=apiKey();
 if(!key)return res.status(503).json({ok:false,error:"PRICE_PROVIDER_UNAVAILABLE"});
 let contract;
 try{contract=await resolveFuturesContract("ES")}catch{return res.status(503).json({ok:false,error:"CONTRACT_RESOLUTION_FAILED"})}
 const ticker=String(contract?.resolvedSymbol??"").toUpperCase();
 if(contract?.ok!==true||!/^ES[FGHJKMNQUVXZ][0-9]{1,2}$/.test(ticker))return res.status(503).json({ok:false,error:"UNVERIFIED_RESOLVED_CONTRACT"});
 res.setHeader("Content-Type","text/event-stream; charset=utf-8");
 res.setHeader("Cache-Control","no-store, no-transform");
 res.setHeader("Connection","keep-alive");
 res.setHeader("X-Accel-Buffering","no");
 res.flushHeaders?.();
 let alive=true;
 send(res,{ok:true,type:"snapshot",source:"POLYGON_DIRECT_ES_TRADE",symbol:"ES",resolvedSymbol:ticker,readOnly:true,updatedAt:new Date().toISOString()});
 const ws=new WebSocket(wsUrl);
 const ping=setInterval(()=>{if(alive&&!res.destroyed)res.write(":ping\n\n")},15000);
 let authorized=false;
 ws.on("open",()=>{ws.send(JSON.stringify({action:"auth",params:key}))});
 ws.on("message",buf=>{
  let messages;
  try{messages=JSON.parse(buf.toString("utf8"))}catch{return}
  for(const message of Array.isArray(messages)?messages:[messages]){
   if((message?.ev??message?.event)==="status"){
    const status=String(message.status??"").toLowerCase();
    if(status==="auth_success"&&!authorized){
      authorized=true;
      ws.send(JSON.stringify({action:"subscribe",params:"T."+ticker}));
    }else if(status==="auth_failed")send(res,{ok:false,type:"status",reasonCode:"PROVIDER_AUTH_FAILED"});
    continue;
   }
   if(!authorized)continue;
   const receivedAt=new Date().toISOString();
   const trade=normalizeEngine27V3EsTrade(message,{resolvedSymbol:ticker,observedAt:receivedAt});
   if(trade)send(res,{ok:true,...trade});
  }
 });
 ws.on("error",()=>{send(res,{ok:false,type:"status",reasonCode:"PROVIDER_STREAM_ERROR"})});
 ws.on("close",()=>{send(res,{ok:false,type:"status",reasonCode:"PROVIDER_STREAM_DISCONNECTED"})});
 req.on("close",()=>{alive=false;clearInterval(ping);try{ws.close()}catch{}});
});
export default router;
