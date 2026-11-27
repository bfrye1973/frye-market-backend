// Engine 12 Trade Investigator routes, including Issue #412 daily/latest verification.
import express from "express";
import path from "node:path";
import {createHash,timingSafeEqual} from "node:crypto";
import {performance} from "node:perf_hooks";
import {buildInvestigation} from "../logic/investigator/buildInvestigation.js";
import {buildDailyPaperVerification,buildLatestApprovedCandidateVerification} from "../logic/investigator/engine12DailyPaperVerification.js";
import {extractEngineTimeline,extractLaneIdentity} from "../logic/investigator/extractEngineTimeline.js";
import {lookupReplayWindow} from "../logic/investigator/lookupReplayWindow.js";
import {readEvidenceJson} from "../logic/investigator/readEvidenceFile.js";
import {redactInvestigationPayload} from "../logic/investigator/redactInvestigationPayload.js";
import {validateInvestigationQuery,LIMITS} from "../logic/investigator/validateInvestigationQuery.js";
import {readDailyPaperEvidence} from "../logic/trading/engine8DailyEvidenceReader.js";
import {readPrivatePaperReceipts,projectObservedPaperAttempts} from "../logic/trading/engine8PaperReceiptReader.js";

export const ACCESS_HEADER="x-trade-investigator-access";
const digest=v=>createHash("sha256").update(String(v)).digest();
const equal=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.length>0&&b.length>0&&timingSafeEqual(digest(a),digest(b));

export function resolveInvestigatorConfig(s=process.env){
 const key=s.TRADE_INVESTIGATOR_ACCESS_KEY;
 return {enabled:s.TRADE_INVESTIGATOR_ENABLED==="true"&&typeof key==="string"&&key.length>=32,key,
  allowedOrigins:String(s.TRADE_INVESTIGATOR_ALLOWED_ORIGINS||"https://frye-dashboard.onrender.com").split(",").map(x=>x.trim()).filter(Boolean),
  replayRoot:s.TRADE_INVESTIGATOR_REPLAY_ROOT||"/var/data/replay/es",engine8PaperDir:s.ENGINE8_PAPER_DATA_DIR||"/var/data/replay/engine8-paper",
  journalDir:s.TRADE_JOURNAL_DIR||"/var/data/replay/journal",receiptDir:s.ENGINE8_PAPER_VERIFICATION_DIR||null};
}
function limiter({limit,windowMs,now}){const h=new Map();return k=>{const t=now(),e=h.get(k);if(!e||t-e.start>=windowMs){h.set(k,{start:t,count:1});if(h.size>10000)h.clear();return true;}return ++e.count<=limit;};}
function headers(req,res,origins){res.removeHeader("Access-Control-Allow-Credentials");const o=req.get("origin");if(o&&origins.includes(o)){res.setHeader("Access-Control-Allow-Origin",o);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Headers","Accept, X-Trade-Investigator-Access");res.setHeader("Access-Control-Allow-Methods","GET");}else res.removeHeader("Access-Control-Allow-Origin");res.setHeader("Cache-Control","no-store");res.setHeader("Pragma","no-cache");res.setHeader("X-Content-Type-Options","nosniff");}
function dateOnly(q){const k=Object.keys(q||{});if(k.length!==1||k[0]!=="date"||Array.isArray(q.date))return null;const d=String(q.date||"");const t=Date.parse(d+"T00:00:00Z");return /^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===d?d:null;}
function azParts(iso){const t=Date.parse(iso);if(!Number.isFinite(t))return null;const s=new Date(t-7*3600000).toISOString();return {date:s.slice(0,10),time:s.slice(11,16).replace(":","")};}

function verifyApprovalAgainstReplay(receipt,config){
 if(!receipt?.approvalSnapshotTime||!receipt?.strategyId||!receipt?.candidateId||!receipt?.planId)return {status:"UNKNOWN",reason:"APPROVAL_RECEIPT_IDENTITY_INCOMPLETE"};
 const p=azParts(receipt.approvalSnapshotTime);if(!p)return {status:"UNKNOWN",reason:"APPROVAL_TIME_INVALID"};
 const lookup=lookupReplayWindow({root:config.replayRoot,date:p.date,time:p.time,windowMinutes:5});
 if(!lookup.ok)return {status:"UNKNOWN",reason:"REPLAY_NOT_FOUND",detail:lookup.error??lookup.reason??null};
 const strategy=lookup.replay?.strategies?.[receipt.strategyId];if(!strategy)return {status:"UNKNOWN",reason:"STRATEGY_NOT_IN_REPLAY"};
 const timeline=extractEngineTimeline({strategy,dateYmd:p.date,includeRecords:false});
 const identity=extractLaneIdentity({strategy,canonical:timeline.canonical,strategyId:receipt.strategyId});
 const candidate=identity.candidateId?.value??null,plan=identity.planId?.value??null,e6=timeline.canonical.engine6;
 if(candidate!==receipt.candidateId||plan!==receipt.planId)return {status:"CONFLICT",reason:"REPLAY_APPROVAL_IDENTITY_CONFLICT",candidateId:candidate,planId:plan};
 if(e6?.gate!=="PASSED")return {status:"CONFLICT",reason:"REPLAY_ENGINE6_PERMISSION_NOT_PASSED",engine6Gate:e6?.gate??"UNKNOWN"};
 return {status:"VERIFIED",reason:null,replaySha256:lookup.provenance?.sha256??null,selectedArchiveTime:lookup.selection?.selectedTime??null,engine6Gate:e6.gate,candidateId:candidate,planId:plan,note:"Receipt snapshot hash covers live frozen strategy-snapshot bytes and is not compared to Replay-file SHA."};
}

export function makeTradeInvestigatorRouter({settings=process.env,now=()=>Date.now(),rateLimit={limit:60,windowMs:60000},log=x=>console.log(JSON.stringify(x))}={}){
 const config=resolveInvestigatorConfig(settings),allow=limiter({...rateLimit,now}),router=express.Router();
 const pre=(req,res,name)=>{const started=performance.now();headers(req,res,config.allowedOrigins);const send=(status,body,meta={})=>{const durationMs=Math.round((performance.now()-started)*10)/10;res.setHeader("Server-Timing","investigate;dur="+durationMs);log({route:name,status,durationMs,...meta});return res.status(status).json(body);};
  if(req.method!=="GET"){res.setHeader("Allow","GET");return {done:true,response:send(405,{ok:false,error:"METHOD_NOT_ALLOWED"})};}
  if(!config.enabled)return {done:true,response:send(503,{ok:false,error:"TRADE_INVESTIGATOR_NOT_CONFIGURED"})};
  const k=req.get(ACCESS_HEADER);if(!k)return {done:true,response:send(401,{ok:false,error:"CREDENTIAL_REQUIRED"})};if(!equal(k,config.key))return {done:true,response:send(403,{ok:false,error:"CREDENTIAL_REJECTED"})};if(!allow(req.ip||"unknown"))return {done:true,response:send(429,{ok:false,error:"RATE_LIMITED"})};return {done:false,send,started};};

 router.all("/trade-investigator",(req,res)=>{const p=pre(req,res,"trade-investigator");if(p.done)return p.response;const v=validateInvestigationQuery(req.query);if(!v.ok)return p.send(400,{ok:false,error:"INVALID_QUERY",errors:v.errors});let result;try{result=buildInvestigation({query:v.value,config});}catch{return p.send(500,{ok:false,error:"INVESTIGATION_FAILED"});}
  const body=redactInvestigationPayload({...result.body,timing:{durationMs:Math.round((performance.now()-p.started)*10)/10}}),cap=v.value.detail==="full"?LIMITS.maxResponseBytesFull:LIMITS.maxResponseBytesSummary,size=Buffer.byteLength(JSON.stringify(body));if(size>cap)return p.send(413,{ok:false,error:"RESPONSE_TOO_LARGE",bytes:size,limit:cap});return p.send(result.httpStatus,body,{date:v.value.date,time:v.value.time,strategyId:v.value.strategyId,bytes:size});});

 const handler=kind=>async(req,res)=>{const p=pre(req,res,"trade-investigator-"+kind);if(p.done)return p.response;const date=dateOnly(req.query);if(!date)return p.send(400,{ok:false,error:"INVALID_QUERY",errors:["Exactly one valid date=YYYY-MM-DD parameter is required."]});
  let evidence;try{evidence=readDailyPaperEvidence({paperDir:config.engine8PaperDir,journalDir:config.journalDir});}catch{return p.send(503,{ok:false,error:"DAILY_EVIDENCE_READ_FAILED"},{date});}
  const covPath=path.join(config.engine8PaperDir,"paper-verification-coverage-"+date+".json"),covRead=readEvidenceJson(covPath,{maxBytes:2*1024*1024}),coverage=covRead.status==="OK"?covRead.value:null;
  let receipts={date,receipts:[],issues:["RECEIPT_ARCHIVE_NOT_CONFIGURED"],coverage:"UNPROVEN"};
  if(config.receiptDir){try{receipts=await readPrivatePaperReceipts({root:config.receiptDir,date,now:new Date(now()).toISOString()});}catch{receipts={date,receipts:[],issues:["RECEIPT_READ_FAILED"],coverage:"UNPROVEN"};}}
  const attempts=projectObservedPaperAttempts({date,receipts:receipts.receipts,now:new Date(now()).toISOString()});
  let daily;try{daily=buildDailyPaperVerification({date,evidence,coverageAttestation:coverage});}catch{return p.send(500,{ok:false,error:"DAILY_VERIFICATION_FAILED"},{date});}
  let result;if(kind==="daily")result={...daily,reportedAttempts:{reportedApprovedCandidates:attempts.reportedApprovedCandidates,reportedAttempts:attempts.reportedAttempts,latestObservedApprovedCandidate:attempts.latestObservedApprovedCandidate,issues:[...new Set([...(receipts.issues||[]),...(attempts.issues||[])])]}};else{const latest=attempts.latestObservedApprovedCandidate,approval=latest?.latestReceipt?verifyApprovalAgainstReplay(latest.latestReceipt,config):{status:"UNKNOWN",reason:"NO_REPORTED_APPROVED_CANDIDATE"};result=buildLatestApprovedCandidateVerification({daily,attempts,approvalReplay:approval});}
  const body=redactInvestigationPayload({ok:true,...result,coverageSource:{status:covRead.status,reason:covRead.reason??null,sha256:covRead.sha256??null,readAt:covRead.readAt??null},receiptSource:{configured:!!config.receiptDir,readAt:receipts.readAt??null,issues:receipts.issues??[],coverage:receipts.coverage??"UNPROVEN"}}),size=Buffer.byteLength(JSON.stringify(body));if(size>LIMITS.maxResponseBytesSummary)return p.send(413,{ok:false,error:"RESPONSE_TOO_LARGE",bytes:size,limit:LIMITS.maxResponseBytesSummary},{date});return p.send(200,body,{date,verdict:daily.verdict,bytes:size});};
 router.all("/trade-investigator/daily",handler("daily"));router.all("/trade-investigator/latest",handler("latest"));return router;
}
export default makeTradeInvestigatorRouter;
