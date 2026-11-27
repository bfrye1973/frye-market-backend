// #412: read only private receipt archive and project observed approval attempts.
// No approval certification or absence-of-trade claim is made by this module.
import fs from "node:fs/promises";
import path from "node:path";
import {RECEIPT_DAY_CAP} from "./engine8PaperReceiptObserver.js";
import {constants} from "node:fs";
import {createHash} from "node:crypto";
import {validatePrivatePaperReceipt} from "./engine8PrivatePaperReceipt.js";
import {projectObservedPaperCoverage} from "./engine8PaperCoverage.js";
const digest=v=>createHash("sha256").update(v).digest("hex");
export async function readPrivatePaperReceipts({root,date,now=new Date().toISOString()}={}){
 const bounds=projectObservedPaperCoverage({date,receipts:[],now});
 const receipts=[],issues=[],seen=new Set();
 try{
  if(typeof root!=="string"||!path.isAbsolute(root)||path.resolve(root)!==root||await fs.realpath(root)!==root)throw Error("ROOT");
  const st=await fs.stat(root);
  if(!st.isDirectory()||(st.mode&0o077)!==0)throw Error("ROOT");
  // #412 (F-3): receipts live in root/<date>/; older receipts may be flat in root.
  const scan=async(dir,limit)=>{const directory=await fs.opendir(dir);let count=0;
  for await(const entry of directory){
   if(++count>limit){issues.push("RECEIPT_SCAN_LIMIT");break;}
   if(!entry.name.startsWith(date+"-"))continue;
   if(!entry.isFile()||!/^[0-9-]{10}-[a-f0-9]{64}\.json$/.test(entry.name)){issues.push("UNSAFE_RECEIPT_FILE");continue;}
   let fd;
   try{
    fd=await fs.open(path.join(dir,entry.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const before=await fd.stat();
    if(!before.isFile()||(before.mode&0o077)!==0||before.size>8192)throw Error("UNSAFE");
    const bytes=Buffer.alloc(before.size+1);
    let n=0;while(n<bytes.length){const x=await fd.read(bytes,n,bytes.length-n,null);if(!x.bytesRead)break;n+=x.bytesRead;}
    const after=await fd.stat();
    if(n!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error("CHANGED");
    const receipt=JSON.parse(bytes.subarray(0,n).toString("utf8"));
    const v=validatePrivatePaperReceipt(receipt,{start:bounds.intervalStart,end:bounds.intervalEnd,now});
    if(!v.valid){issues.push(...v.issues);continue;}
    if(entry.name!==date+"-"+digest(receipt.cycleId)+".json"){issues.push("RECEIPT_FILENAME_CONFLICT");continue;}
    if(seen.has(receipt.cycleId)){issues.push("DUPLICATE_CYCLE_ID");continue;}
    seen.add(receipt.cycleId);receipts.push(receipt);
   }catch{issues.push("RECEIPT_READ_FAILED");}finally{if(fd)await fd.close().catch(()=>{});}
  }
  };
  await scan(root,50000);
  const dayDir=path.join(root,date);
  const ds=await fs.lstat(dayDir).catch(()=>null);
  if(ds){if(ds.isSymbolicLink()||!ds.isDirectory()||(ds.mode&0o077)!==0)issues.push("UNSAFE_RECEIPT_DAY_DIR");else await scan(dayDir,RECEIPT_DAY_CAP+1);}
 }catch{issues.push("RECEIPT_ARCHIVE_UNAVAILABLE");}
 return {date,readAt:now,receipts,issues:[...new Set(issues)],coverage:"UNPROVEN"};
}
export function projectObservedPaperAttempts({date,receipts,now}={}){
 const bounds=projectObservedPaperCoverage({date,receipts,now});
 const groups=new Map(), seen=new Set(), issues=[...bounds.errors,...bounds.duplicates];
 for(const r of Array.isArray(receipts)?receipts:[]){
  if(!validatePrivatePaperReceipt(r,{start:bounds.intervalStart,end:bounds.intervalEnd,now}).valid||seen.has(r.cycleId))continue;
  seen.add(r.cycleId);
  if(r.engine6Permission!==true)continue;
  const key=JSON.stringify([r.strategyId,r.candidateId,r.planId]);
  const group=groups.get(key)??[];group.push(r);groups.set(key,group);
 }
 const candidates=[...groups.values()].map(attempts=>{
  attempts.sort((a,b)=>a.cycleTime.localeCompare(b.cycleTime)||a.cycleId.localeCompare(b.cycleId));
  const first=attempts[0],last=attempts.at(-1);
  const orders=[...new Set(attempts.filter(r=>r.orderCreated===true).map(r=>r.orderId).filter(Boolean))];
  const outcome=orders.length?"ORDER_REPORTED_NOT_INDEPENDENTLY_VERIFIED":last.skipReason?"APPROVAL_REPORTED_SKIPPED":last.rejectReason?"APPROVAL_REPORTED_REJECTED":"UNKNOWN";
  return {strategyId:first.strategyId,candidateId:first.candidateId,planId:first.planId,firstObservedApprovalTime:first.approvalSnapshotTime,lastObservedCycleTime:last.cycleTime,attemptCount:attempts.length,reportedOrderIds:orders,latestReceipt:last,outcome,independentVerification:"UNKNOWN"};
 }).sort((a,b)=>b.lastObservedCycleTime.localeCompare(a.lastObservedCycleTime));
 return {schemaVersion:"engine8.observedPaperAttempts.v1",date,coverage:"UNPROVEN",reportedApprovedCandidates:candidates.length,reportedAttempts:candidates.reduce((n,c)=>n+c.attemptCount,0),latestObservedApprovedCandidate:candidates[0]??null,candidates,issues:[...new Set(issues)]};
}
