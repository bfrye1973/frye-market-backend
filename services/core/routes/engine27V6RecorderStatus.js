// Engine27 V6 authenticated read-only recorder diagnostics.
// No prices, secrets, broker records, absolute paths or private Replay payloads.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const router=express.Router();
const base="/var/data/replay/engine27/wave-observations";
function count(dir,pattern){try{return fs.readdirSync(path.join(base,dir)).filter(s=>pattern.test(s)).length}catch{return 0}}
function verify(got,expected){const a=Buffer.from(String(got??"")),b=Buffer.from(String(expected??""));
 return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b)}
router.get("/",(req,res)=>{
 const token=process.env.ENGINE27_V6_STATUS_TOKEN||process.env.ENGINE_CRON_TOKEN;
 if(!token)return res.status(503).json({ok:false,error:"STATUS_AUTH_UNCONFIGURED"});
 if(!verify(req.header("X-ENGINE-CRON-TOKEN"),token))
  return res.status(401).json({ok:false,error:"UNAUTHORIZED"});
 const events=count("events",/^\d{13}-[a-f0-9]{64}\.json$/);
 const candles=count("candle-evidence",/^[a-f0-9]{64}\.json$/);
 let receipts=0;try{for(const date of fs.readdirSync(path.join(base,"replay-intake-receipts")))
  receipts+=count("replay-intake-receipts/"+date,/^\d{4}\.json$/)}catch{}
 const pending=count("events",/\.pending$/)+count("candle-evidence",/\.pending$/);
 const lease=fs.existsSync(path.join(base,".single-worker-lease"));
 res.set("Cache-Control","no-store").json({ok:true,enabled:process.env.ENGINE27_V6_RECORDER_ENABLED==="true",
  running:"UNVERIFIED_NO_HEARTBEAT",singletonLeasePresent:lease,
  eventCount:events,tenMinuteCandleEvidenceCount:candles,intakeReceiptCount:receipts,
  pendingFileCount:pending,source:"DURABLE_DISK_ONLY",workerHeartbeatAvailable:false,
  deploymentSha:process.env.RENDER_GIT_COMMIT??null});
});
export default router;
