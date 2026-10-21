// Engine 10: isolated identity preservation; NEVER touches active Journal.
import fs from "node:fs";
import crypto from "node:crypto";
const dir="/var/data/replay/journal-recovery-sandbox/20261021-engine10-pre-reconstruction";
const originalPath=dir+"/trade-journal.json";
const candidatePath=dir+"/long-replay-v1/trade-journal.json";
const outputPath=dir+"/long-replay-v1/identity-preserved.json";
const digest=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
if(digest(originalPath)!=="ff4240448d4f9f775f0161fc54bd379eaa2c199b2f7ca580c367feea222415b1")throw Error("ORIGINAL_HASH_CHANGED");
if(digest(candidatePath)!=="5ca124ed180e5dc817a514bf1b44ac51e0344cefe5ac75df55d8402be5ad09de")throw Error("CANDIDATE_HASH_CHANGED");
if(fs.existsSync(outputPath))throw Error("OUTPUT_EXISTS");
const original=JSON.parse(fs.readFileSync(originalPath,"utf8"));
const candidate=JSON.parse(fs.readFileSync(candidatePath,"utf8"));
const affected=t=>t.accountMode==="REAL"&&t.direction==="LONG"&&(t.futuresContractCode||t.realBroker?.futuresContractCode)==="MESZ26"&&Date.parse(t.entry?.time)>=Date.parse("2026-10-14T00:00:00Z");
const old=original.filter(affected);
const current=candidate.filter(affected);
if(old.length!==2||current.length!==3)throw Error("UNEXPECTED_CAMPAIGNS");
const firstId=t=>String((t.events||[]).find(e=>e.eventType==="REAL_ENTRY_FILL")?.brokerTransactionId||"");
const oldByOpening=new Map(old.map(t=>[firstId(t),t]));
const replacements=new Map();
for(const t of current){
 const prior=oldByOpening.get(firstId(t));
 if(!prior)continue;
 if(prior.journalAccount!==t.journalAccount)throw Error("ACCOUNT_MISMATCH");
 replacements.set(t.tradeId,prior.tradeId);
 const priorContracts=prior.realBroker?.contracts||[];
 const newContracts=t.realBroker?.contracts||[];
 for(const c of newContracts){
  const match=priorContracts.find(p=>String(p.openingBrokerTransactionId)===String(c.openingBrokerTransactionId)&&Number(p.entryPrice)===Number(c.entryPrice));
  if(match)replacements.set(c.contractId,match.contractId);
 }
}
if([...replacements.keys()].filter(k=>k.startsWith("TRD-")&&!k.includes("|CTR|")).length!==2)throw Error("MISSING_CAMPAIGN_MAPPING");
function replace(value){
 if(typeof value==="string"){
  if(replacements.has(value))return replacements.get(value);
  for(const [from,to] of replacements)if(value.startsWith(from+"|"))return to+value.slice(from.length);
  return value;
 }
 if(Array.isArray(value))return value.map(replace);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));
 return value;
}
const fixed=candidate.map(replace);
const unique=a=>new Set(a).size===a.length;
if(!unique(fixed.map(t=>t.tradeId)))throw Error("DUPLICATE_TRADE_IDS");
const originalIds=new Set(original.map(t=>t.tradeId));
if([...originalIds].some(id=>!fixed.some(t=>t.tradeId===id)))throw Error("ORIGINAL_TRADE_ID_LOST");
const oldContractIds=old.flatMap(t=>(t.realBroker?.contracts||[]).map(c=>c.contractId));
const newContractIds=new Set(fixed.filter(affected).flatMap(t=>(t.realBroker?.contracts||[]).map(c=>c.contractId)));
if(oldContractIds.some(id=>!newContractIds.has(id)))throw Error("ORIGINAL_CONTRACT_ID_LOST");
const paper=a=>a.filter(t=>t.accountMode==="PAPER");
if(JSON.stringify(paper(original))!==JSON.stringify(paper(fixed)))throw Error("PAPER_CHANGED");
const open=fixed.filter(affected).reduce((n,t)=>n+Number(t.qty?.remainingQty||0),0);
if(open!==0)throw Error("LONG_NOT_FLAT");
fs.writeFileSync(outputPath,JSON.stringify(fixed,null,2),{flag:"wx",mode:0o600});
console.log(JSON.stringify({ok:true,outputPath,sha256:digest(outputPath),originalCampaignsPreserved:2,originalContractIdsPreserved:oldContractIds.length,paperUnchanged:true,remainingLong:open,productionModified:false,accepted:false},null,2));
