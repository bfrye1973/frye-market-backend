import {verifyEngine22HistoryMount} from "../logic/engine22/history/verifyHistoryMountV1.js";
import express from "express";
import {createHash,timingSafeEqual} from "node:crypto";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {pageWaveHistory} from "../logic/engine22/history/waveHistoryJournalV1.js";

const router=express.Router();
const journalDirectory=()=>process.env.ENGINE22_WAVE_HISTORY_DURABLE_DIR || "/var/data/replay/engine22-wave-history";
const hash=x=>createHash("sha256").update(x).digest();
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
 if(!authorized(req))return res.status(401).json({available:false,reason:"ENGINE22_HISTORY_UNAUTHORIZED"});
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
router.get("/workbook",(req,res)=>{
 const path=join(journalDirectory(),"Frye_Elliott_Wave_History.xlsx");
 if(!existsSync(path))return res.status(404).json({available:false,reason:"WORKBOOK_NOT_YET_GENERATED"});
 res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
 res.set("Content-Disposition",'attachment; filename="Frye_Elliott_Wave_History.xlsx"');
 res.sendFile(path,error=>{if(error&&!res.headersSent)res.status(503).json({available:false,reason:"WORKBOOK_READ_FAILED"});});
});
export default router;
