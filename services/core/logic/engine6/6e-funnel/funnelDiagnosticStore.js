// Engine 6E diagnostic store. Never writes a journal or a trading-state file.
import fs from "node:fs";
import path from "node:path";

const DATE=/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
export const DEFAULT_FUNNEL_ROOT="/var/data/replay/funnel/es";
export function validFunnelDate(date) {
  if(typeof date!=="string" || !DATE.test(date)) return false;
  const t=new Date(date+"T00:00:00.000Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0,10)===date;
}
export function funnelDate(iso) {
  if(typeof iso!=="string") return null;
  const t=new Date(iso);
  if(Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Phoenix",year:"numeric",month:"2-digit",day:"2-digit"}).format(t);
}
export function funnelFile(date, root=DEFAULT_FUNNEL_ROOT) {
  if(!validFunnelDate(date)) throw new Error("INVALID_FUNNEL_DATE");
  return path.join(root,date+".jsonl");
}
export function appendFunnelCycle(record, {root=DEFAULT_FUNNEL_ROOT, date=funnelDate(record?.snapshotTime)}={}) {
  if(record?.schema!=="engine6e.noTradeFunnel.v1" || record?.readOnly!==true) throw new Error("INVALID_FUNNEL_RECORD");
  if(!validFunnelDate(date)) throw new Error("INVALID_FUNNEL_DATE");
  fs.mkdirSync(root,{recursive:true});
  const file=funnelFile(date,root);
  fs.appendFileSync(file,JSON.stringify({...record,recordedAt:new Date().toISOString()})+"\n",{encoding:"utf8",flag:"a"});
  return {date,file};
}
export function readFunnelCycles(date,{root=DEFAULT_FUNNEL_ROOT,maxRecords=100000}={}) {
  const file=funnelFile(date,root);
  if(!fs.existsSync(file)) return [];
  const raw=fs.readFileSync(file,"utf8");
  const records=[];
  for(const line of raw.split("\n")) {
    if(!line.trim()) continue;
    try {
      const parsed=JSON.parse(line);
      if(parsed?.schema==="engine6e.noTradeFunnel.v1") records.push(parsed);
    } catch { /* tolerate partial final append without changing file */ }
    if(records.length>=maxRecords) break;
  }
  return records;
}
export function summarizeFunnelCycles(records, date=null) {
  const byGate=Object.fromEntries(Array.from({length:12},(_,i)=>["G"+i,0]));
  const reasons={};const seen=new Map();const distinctByGate={};
  for(let i=0;i<12;i++) distinctByGate["G"+i]=new Set();
  for(const record of records){
    const gate=record?.firstFailedGate;
    if(Object.hasOwn(byGate,gate)) byGate[gate]++;
    const failure=(record?.gates||[]).find(g=>g.gate===gate);
    const reason=failure?.reason||"NO_STOPPING_GATE";
    reasons[reason]=(reasons[reason]||0)+1;
    const id=record?.candidateId;
    const gen=record?.candidateGeneration ?? record?.candidateLifecycleStartTime ?? "unknown-generation";
    const key=id ? gen+"|"+id+"|"+(record?.zoneId||"") : null;
    if(key){
      seen.set(key,true);
      for(const g of record.gates||[]) if(g.state==="PASS" && distinctByGate[g.gate]) distinctByGate[g.gate].add(key);
    }
  }
  return {schema:"engine6e.noTradeFunnelSummary.v1",readOnly:true,date,cycles:records.length,distinctCandidates:seen.size,
    stoppedAtGate:byGate,distinctCandidatesReachingGate:Object.fromEntries(Object.entries(distinctByGate).map(([k,v])=>[k,v.size])),
    topReasonCodes:Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([reason,count])=>({reason,count})),
    last20:records.slice(-20).reverse()};
}
