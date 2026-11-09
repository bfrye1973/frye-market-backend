import {verifyEngine22HistoryMount} from "../logic/engine22/history/verifyHistoryMountV1.js";
import express from "express";
import {createHash,timingSafeEqual} from "node:crypto";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {pageWaveHistory} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {pageEngine22NodeHistory,latestEngine22NodeHistory} from "../logic/engine22/history/chartNodeHistoryFeedV1.js";

const router=express.Router();
const journalDirectory=()=>process.env.ENGINE22_WAVE_HISTORY_DURABLE_DIR || "/var/data/replay/engine22-wave-history";
const hash=x=>createHash("sha256").update(x).digest();
const CHART_ORIGIN="https://frye-dashboard.onrender.com";
const restrictedNodePaths=new Set(["/nodes","/nodes/current"]);
// Production frontend is STATIC on Render. Reuse the existing Engine2C
// licensed owner credential for READ ONLY node endpoints, never expose
// ENGINE22_WAVE_HISTORY_READ_TOKEN in browser JavaScript.
export function authorizedOwnerNodeRead(req, settings=process.env){
 if(req.method!=="GET"||!restrictedNodePaths.has(req.path)||
    settings.ENGINE2C_HISTORY_ENABLED!=="true"||
    settings.ENGINE2C_HISTORY_LICENSED!=="true")return false;
 const origin=req.get("origin");
 if(origin&&origin!==CHART_ORIGIN)return false;
 const expected=settings.ENGINE2C_HISTORY_OWNER_KEY;
 const provided=req.get("x-engine2c-access");
 if(typeof expected!=="string"||expected.length<32||
    typeof provided!=="string"||provided.length<16||provided.length>2048)return false;
 return timingSafeEqual(hash(provided),hash(expected));
}
function setRestrictedNodeCors(req,res){
 const origin=req.get("origin");
 res.set("Vary","Origin, Access-Control-Request-Headers");
 res.removeHeader("Access-Control-Allow-Credentials");
 if(origin===CHART_ORIGIN){
  res.set("Access-Control-Allow-Origin",CHART_ORIGIN);
  res.set("Access-Control-Allow-Headers","Accept, X-Engine2C-Access");
  res.set("Access-Control-Allow-Methods","GET, OPTIONS");
 }else{
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Headers");
  res.removeHeader("Access-Control-Allow-Methods");
 }
}
// The caller mounts OPTIONS before the preexisting broad server CORS handler.
export function nodeHistoryPreflight(req,res){
 setRestrictedNodeCors(req,res);
 res.set("Cache-Control","no-store");
 return res.status(204).end();
}

function authorized(req){
 const secret=process.env.ENGINE22_WAVE_HISTORY_READ_TOKEN;
 if(typeof secret!=="string"||secret.length<32)return false;
 const value=req.get("authorization")??"";
 if(!value.startsWith("Bearer "))return false;
 const token=value.slice(7);
 if(!token||token.length>2048)return false;
 return timingSafeEqual(hash(token),hash(secret));
}
router.use((req,res,next)=>{
 res.set("Cache-Control","no-store");
 // Override generic application CORS on ONLY the private node routes.
 if(restrictedNodePaths.has(req.path))setRestrictedNodeCors(req,res);
 if(!authorized(req)&&!authorizedOwnerNodeRead(req))
  return res.status(401).json({available:false,reason:"ENGINE22_HISTORY_UNAUTHORIZED"});
 if(!verifyEngine22HistoryMount({directory:journalDirectory()}).ok)return res.status(503).json({available:false,reason:"ENGINE22_HISTORY_PERSISTENT_MOUNT_UNVERIFIED"});
 next();
});
router.get("/",(req,res)=>{
 const afterRevision=Number(req.query.afterRevision??0),limit=Number(req.query.limit??50);
 try{
  const data=pageWaveHistory({directory:journalDirectory(),afterRevision,limit});
  res.json(data);
 }catch(error){
  if(String(error.message)==="INVALID_HISTORY_PAGINATION")return res.status(400).json({available:false,reason:"INVALID_HISTORY_PAGINATION"});
  console.error("[ENGINE22 HISTORY READ FAILED]",String(error.message));
  return res.status(503).json({available:false,reason:"ENGINE22_HISTORY_UNAVAILABLE_OR_CORRUPT"});
 }
});
router.get("/nodes",(req,res)=>{
 const afterRevision=Number(req.query.afterRevision??0),limit=Number(req.query.limit??50);
 try{return res.json(pageEngine22NodeHistory({directory:journalDirectory(),afterRevision,limit}));}
 catch(error){
  if(String(error.message)==="INVALID_HISTORY_PAGINATION")return res.status(400).json({available:false,reason:"INVALID_HISTORY_PAGINATION"});
  console.error("[ENGINE22 NODE HISTORY READ FAILED]",String(error.message));
  return res.status(503).json({available:false,reason:"ENGINE22_NODE_HISTORY_UNAVAILABLE_OR_CORRUPT"});
 }
});
router.get("/nodes/current",(req,res)=>{
 try{return res.json(latestEngine22NodeHistory({directory:journalDirectory()}));}
 catch(error){
  console.error("[ENGINE22 CURRENT NODES READ FAILED]",String(error.message));
  return res.status(503).json({available:false,reason:"ENGINE22_NODE_HISTORY_UNAVAILABLE_OR_CORRUPT"});
 }
});
router.get("/workbook",(req,res)=>{
 const path=join(journalDirectory(),"Frye_Elliott_Wave_History.xlsx");
 if(!existsSync(path))return res.status(404).json({available:false,reason:"WORKBOOK_NOT_YET_GENERATED"});
 res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
 res.set("Content-Disposition",'attachment; filename="Frye_Elliott_Wave_History.xlsx"');
 res.sendFile(path,error=>{if(error&&!res.headersSent)res.status(503).json({available:false,reason:"WORKBOOK_READ_FAILED"});});
});
export default router;
