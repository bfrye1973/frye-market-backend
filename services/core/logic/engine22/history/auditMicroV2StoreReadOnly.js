// Engine22E T1.4 — strictly read-only Micro V2 durable-store integrity audit.
// Never invokes mutating canonicalMicroStore APIs. Never writes a manifest to disk.
// Failure is explicit: no silent JSONL fallback, missing count, orphan link or
// corrupt record can be interpreted as trustworthy historical evidence.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {validateCanonicalMicroState} from "../microV2/canonicalMicroState.js";
import {rehearseEngine22MicroV2Migration} from "./rehearseMicroV2Migration.js";

export const ENGINE22_E_STORE_AUDIT_SCHEMA="engine22.microV2StoreAudit.v1";
const fail=(reason,extra={})=>({ok:false,safeToMigrate:false,reasonCodes:[reason],...extra,
  readOnly:true,productionModified:false,noExecution:true,shadowOnly:true});
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
const isName=s=>typeof s==="string"&&/^[A-Za-z0-9._-]+\.json$/.test(s)&&s!=="."&&s!=="..";
function readRegular(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error("UNSAFE_FILE_TYPE");
 const bytes=fs.readFileSync(file);
 return {value:JSON.parse(bytes.toString("utf8")),hash:sha256(bytes),bytes:bytes.length};
}
function readJsonl(file){
 if(!fs.existsSync(file))return {records:[],sha256:null,bytes:0,missing:true};
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error("UNSAFE_LEDGER_TYPE");
 const bytes=fs.readFileSync(file);
 const content=bytes.toString("utf8");
 if(content && !content.endsWith("\n"))throw Error("PARTIAL_JSONL_LAST_RECORD");
 const lines=content.split("\n").filter(Boolean);
 return {records:lines.map(s=>JSON.parse(s)),sha256:sha256(bytes),bytes:bytes.length,missing:false};
}
export function auditEngine22MicroV2StoreReadOnly({rootDir=null}={}){
 if(typeof rootDir!=="string"||!path.isAbsolute(rootDir))return fail("ABSOLUTE_STORE_ROOT_REQUIRED");
 let rootStat;
 try{rootStat=fs.lstatSync(rootDir);}catch{return fail("STORE_ROOT_UNAVAILABLE");}
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())return fail("UNSAFE_STORE_ROOT");
 const countDir=path.join(rootDir,"counts");
 let filenames;
 try{
  const s=fs.lstatSync(countDir);
  if(!s.isDirectory()||s.isSymbolicLink())return fail("UNSAFE_COUNT_DIRECTORY");
  const entries=fs.readdirSync(countDir,{withFileTypes:true});
  if(entries.some(x=>!x.isFile()||!isName(x.name)))return fail("UNEXPECTED_COUNT_DIR_ENTRY");
  filenames=entries.map(x=>x.name).sort();
 }catch{return fail("COUNT_DIRECTORY_UNAVAILABLE");}
 if(!filenames.length)return fail("NO_CANONICAL_COUNT_FILES");
 const counts=[],files=[],ids=new Set();
 try{
  for(const name of filenames){
   const file=path.join(countDir,name),record=readRegular(file);
   if(!validateCanonicalMicroState(record.value).ok)throw Error("INVALID_CANONICAL_COUNT_FILE");
   const countId=record.value.countId;
   if(ids.has(countId))throw Error("DUPLICATE_ORIGINAL_COUNT_ID");
   ids.add(countId);
   // Filename is a legacy sanitized ID; ambiguities are always refused.
   const expected=String(countId).trim().replace(/[^A-Za-z0-9._-]+/g,"_")+".json";
   if(name!==expected)throw Error("COUNT_FILE_IDENTITY_MISMATCH");
   files.push({relativePath:"counts/"+name,bytes:record.bytes,sha256:record.hash,countId});
   counts.push(record.value);
  }
  const transitions=readJsonl(path.join(rootDir,"transitions.jsonl"));
  const recounts=readJsonl(path.join(rootDir,"recounts.jsonl"));
  let activeCount=null,activeChecksum=null;
  const activeFile=path.join(rootDir,"active-count.json");
  if(fs.existsSync(activeFile)){
    const active=readRegular(activeFile);
    activeCount=active.value;
    activeChecksum={relativePath:"active-count.json",sha256:active.hash,bytes:active.bytes};
  }
  const rehearsal=rehearseEngine22MicroV2Migration({
   counts,transitions:transitions.records,recounts:recounts.records,activeCount
  });
  const uncertainties=[...(rehearsal.uncertainties??[])];
  if(transitions.missing)uncertainties.push({code:"TRANSITION_LEDGER_ABSENT"});
  if(recounts.missing)uncertainties.push({code:"RECOUNT_LEDGER_ABSENT"});
  if(!activeCount)uncertainties.push({code:"ACTIVE_COUNT_POINTER_ABSENT"});
  return {
    schema:ENGINE22_E_STORE_AUDIT_SCHEMA,
    ok:rehearsal.ok,
    safeToMigrate:rehearsal.ok && rehearsal.safeToMigrate && uncertainties.length===0,
    reasonCodes:rehearsal.ok?uncertainties.length?
      ["STORE_EVIDENCE_INCOMPLETE_REVIEW_REQUIRED"]:["STORE_CONSISTENCY_VERIFIED_NOT_AUTHENTICATED"]:
      [...(rehearsal.reasonCodes??["MIGRATION_REHEARSAL_FAILED"])],
    countFiles:files,transitionLedger:{relativePath:"transitions.jsonl",
      sha256:transitions.sha256,bytes:transitions.bytes,recordCount:transitions.records.length},
    recountLedger:{relativePath:"recounts.jsonl",
      sha256:recounts.sha256,bytes:recounts.bytes,recordCount:recounts.records.length},
    activeCountFile:activeChecksum,activeCountId:activeCount?.countId??null,
    originalCountIds:counts.map(c=>c.countId),uncertainties,
    checksumScheme:"SHA256_OVER_EXACT_ORIGINAL_BYTES",
    independentlyAuthenticated:false,readOnly:true,productionModified:false,
    activePointerChangeAuthorized:false,noExecution:true,noPermissionCreated:true,shadowOnly:true,
  };
 }catch(error){
  return fail("INTEGRITY_AUDIT_FAILED",{detail:String(error?.message??error)});
 }
}
