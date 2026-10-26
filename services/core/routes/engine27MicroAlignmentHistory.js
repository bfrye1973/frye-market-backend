// Protected durable Micro alignment event archive on Backend1's existing disk.
// No journal, market-data redistribution, brokerage or order endpoints.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const router=express.Router();
const LOCATION="/var/data/replay/engine27/micro-cross-market-alignment.ndjson";
const allowed=()=>process.env.ENGINE27_MICRO_ALIGNMENT_ARCHIVE_TOKEN||"";
function authorize(req,res,next){
 const expected=allowed(),provided=(req.get("authorization")||"").replace(/^Bearer /,"");
 const a=Buffer.from(expected),b=Buffer.from(provided);
 if(!expected||!provided||a.length!==b.length||!crypto.timingSafeEqual(a,b))
  return res.status(401).end();
 next();
}
function qualified(row){
 if(row?.schema!=="engine27.v3.microFiveMinuteAlignmentEvent.v1"||
    typeof row.closedAt!=="string"||!Number.isFinite(Date.parse(row.closedAt))||
    row.id!=="MICRO-"+row.closedAt||
    !["UP","DOWN","FLAT"].includes(row?.ES?.state)||
    !["UP","DOWN","FLAT"].includes(row?.QQQ?.state)||
    !["UP","DOWN","FLAT"].includes(row?.VIX?.state)||
    typeof row.marketAligned!=="boolean"||row.noExecution!==true)return false;
 const now=Date.now(),at=Date.parse(row.closedAt);
 return at<=now+60000&&now-at<=86400000;
}
function read(){
 try{return fs.readFileSync(LOCATION,"utf8").split("\n").filter(Boolean).slice(-20000).map(x=>{
  try{return JSON.parse(x)}catch{return null}
 }).filter(Boolean)}catch(e){if(e.code==="ENOENT")return [];throw e}
}
router.post("/engine27/micro-alignment/history",authorize,express.json({limit:"12kb"}),(req,res)=>{
 const row=req.body;
 if(!qualified(row))return res.status(400).json({ok:false,reason:"INVALID_ALIGNMENT_EVIDENCE"});
 try{
  const existing=read();
  if(existing.some(x=>x.id===row.id))return res.json({ok:true,stored:false,duplicate:true});
  fs.mkdirSync(path.dirname(LOCATION),{recursive:true});
  // Store a strict allowlisted event shape, never accept any user-provided paths/secrets.
  const clean={schema:row.schema,id:row.id,closedAt:row.closedAt,marketAligned:row.marketAligned,
   earlyWarning:row.earlyWarning===true,state:String(row.state??"UNAVAILABLE").slice(0,90),
   ES:row.ES,QQQ:row.QQQ,VIX:row.VIX,microDirection:row.microDirection??null,
   engine25Qualified:row.engine25Qualified===true,engine29Qualified:row.engine29Qualified===true,
   fullQualified:row.fullQualified===true,noExecution:true};
  fs.appendFileSync(LOCATION,JSON.stringify(clean)+"\n",{encoding:"utf8",mode:0o600});
  return res.json({ok:true,stored:true,id:clean.id});
 }catch{return res.status(503).json({ok:false,reason:"DURABLE_ARCHIVE_UNAVAILABLE"})}
});
router.get("/engine27/micro-alignment/history",authorize,(req,res)=>{
 try{
  const limit=Math.max(1,Math.min(100,Number(req.query.limit)||25));
  const rows=read();
  res.set("Cache-Control","no-store").json({ok:true,schema:"engine27.v3.microAlignmentHistory.v1",
   persistence:"BACKEND1_RENDER_DISK",count:rows.length,events:rows.slice(-limit).reverse(),noExecution:true});
 }catch{return res.status(503).json({ok:false,reason:"DURABLE_ARCHIVE_UNAVAILABLE"})}
});
export default router;
