// Read-only evidence capture. No trading imports, no writes.
// Two bounded reads per file detect observed changes, not a transactional snapshot.
import fs from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
const names={orders:"paper-orders.json",executions:"paper-executions.json",lifecycle:"engine8-paper-execution-state.json",ledger:"paper-idempotency-ledger.json",acceptance:"engine8-paper-acceptance-state.json",journal:"trade-journal.json"};
const arrays=new Set(["orders","executions","journal"]);
function readOne(file,limit){
 let fd;
 try{
  const pre=fs.lstatSync(file);
  if(!pre.isFile()||pre.isSymbolicLink())return {status:"ERROR",reason:"UNSAFE_FILE"};
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const a=fs.fstatSync(fd);
  if(!a.isFile()||a.size>limit||a.ino!==pre.ino||a.dev!==pre.dev)return {status:"ERROR",reason:"UNSAFE_OR_CHANGED_FILE"};
  const bytes=Buffer.alloc(a.size+1);let total=0;
  while(total<bytes.length){const n=fs.readSync(fd,bytes,total,bytes.length-total,null);if(!n)break;total+=n;}
  const b=fs.fstatSync(fd),post=fs.lstatSync(file);
  if(total!==a.size||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs||post.ino!==a.ino||post.dev!==a.dev||post.mtimeMs!==a.mtimeMs||post.ctimeMs!==a.ctimeMs)return {status:"ERROR",reason:"STORE_CHANGED_DURING_READ"};
  const raw=bytes.subarray(0,total),sha256=createHash("sha256").update(raw).digest("hex");
  try{return {status:"OK",sha256,value:JSON.parse(raw.toString("utf8"))};}catch{return {status:"ERROR",reason:"JSON_PARSE_FAILED",sha256};}
 }catch(e){return {status:"UNAVAILABLE",reason:e?.code==="ENOENT"?"FILE_NOT_FOUND":"READ_FAILED"};}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function readDailyPaperEvidence({paperDir,journalDir,maxBytes=16*1024*1024,read=readOne,now=()=>new Date().toISOString()}={}){
 if(typeof paperDir!=="string"||!path.isAbsolute(paperDir)||typeof journalDir!=="string"||!path.isAbsolute(journalDir)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw Error("INVALID_EVIDENCE_CONFIGURATION");
 const readAt=now(),files=Object.entries(names).map(([k,n])=>[k,path.join(k==="journal"?journalDir:paperDir,n)]);
 const capture=()=>Object.fromEntries(files.map(([k,f])=>[k,read(f,maxBytes)]));
 const first=capture(),second=capture(),values={},stores={};
 let unstable=false;
 for(const [k] of files){
  const a=first[k],b=second[k];
  if(a.status!==b.status||a.reason!==b.reason||a.sha256!==b.sha256){unstable=true;stores[k]={status:"ERROR",reason:"STORE_CHANGED_DURING_READ"};values[k]=null;continue;}
  const shape=arrays.has(k)?Array.isArray(b.value):b.value!==null&&typeof b.value==="object"&&!Array.isArray(b.value);
  stores[k]={status:b.status==="OK"&&!shape?"ERROR":b.status,reason:b.status==="OK"&&!shape?"INVALID_STORE_SHAPE":b.reason??null,sha256:b.sha256??null};
  values[k]=stores[k].status==="OK"?b.value:null;
 }
 return {readAt,finishedAt:now(),stability:unstable?"CHANGED":"NO_CHANGE_OBSERVED",coverage:"UNPROVEN",stores,values:unstable?Object.fromEntries(files.map(([k])=>[k,null])):values};
}
