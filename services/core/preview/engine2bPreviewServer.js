// Isolated Engine 2B preview process. No Schwab watcher, broker access, writes or trading routes.
import express from "express";
import { createHash } from "node:crypto";
import { buildEngine2ChartOverlayV1, validateEngine2ChartOverlayV1 } from "../logic/engine2/buildEngine2ChartOverlayV1.js";

const app=express();
const sourceUrl="https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES";
let cached=null;
let pending=null;
const ttlMs=15_000;
async function readSnapshot(){
  if(cached && Date.now()-cached.at<ttlMs)return cached.data;
  if(pending)return pending;
  pending=(async()=>{
    const response=await fetch(sourceUrl,{signal:AbortSignal.timeout(25_000),headers:{Accept:"application/json"}});
    if(!response.ok)throw Error("SNAPSHOT_UPSTREAM_"+response.status);
    const data=await response.json();
    if(data?.symbol && String(data.symbol).toUpperCase()!=="ES")throw Error("UPSTREAM_SYMBOL_MISMATCH");
    cached={data,at:Date.now()};return data;
  })().finally(()=>{pending=null;});
  return pending;
}
app.use((req,res,next)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type,If-None-Match");
  if(req.method==="OPTIONS")return res.status(204).end();
  next();
});
app.get("/api/health",(req,res)=>res.json({ok:true,service:"engine2b-preview-readonly",ts:new Date().toISOString()}));
app.get("/api/v1/engine2/chart-overlays/v1",async(req,res)=>{
  if(String(req.query.symbol||"ES").toUpperCase()!=="ES")
    return res.status(400).json({ok:false,error:"UNSUPPORTED_SYMBOL"});
  try{
    const snapshot=await readSnapshot();
    const payload=buildEngine2ChartOverlayV1(snapshot,"ES");
    const validity=validateEngine2ChartOverlayV1(payload);
    if(!validity.ok)return res.status(503).json({ok:false,error:"OVERLAY_CONTRACT_INVALID",reasonCodes:validity.errors});
    const body=JSON.stringify(payload);
    const tag='"'+createHash("sha256").update(body).digest("hex")+'"';
    res.setHeader("ETag",tag);
    res.setHeader("Cache-Control","no-store");
    if(req.headers["if-none-match"]===tag)return res.status(304).end();
    return res.type("json").send(body);
  }catch(error){
    return res.status(503).json({ok:false,error:"PREVIEW_SOURCE_UNAVAILABLE",message:String(error?.message||error)});
  }
});
const port=Number(process.env.PORT||10000);
app.listen(port,"0.0.0.0",()=>console.log("Engine2B read-only preview listening",port));
