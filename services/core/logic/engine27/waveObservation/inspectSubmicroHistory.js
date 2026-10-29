// Original-time Submicro replay inventory. Does not infer current W5 into Oct26 history.
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const sha=x=>createHash("sha256").update(x).digest("hex");
const validTime=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
export function inspectSubmicroReplay(raw,{date=null,file=null}={}){
 let s;try{s=JSON.parse(raw)}catch{return {available:false,date,file,reason:"INVALID_JSON"}}
 const e=s?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
 const p=e?.authorizedWorkingStructure;
 const m=p?.degrees?.submicro;
 const valid=s?.schema==="engine12.multiStrategyReplay.v1"&&s?.replayContract==="CANONICAL_MULTI_STRATEGY_REPLAY";
 return {available:true,date,file,sourceHash:sha(raw),canonical:valid,
  snapshotTime:validTime(s?.snapshotTime)?s.snapshotTime:null,
  originalWorkingPublication:m?.available===true&&typeof m.activeWave==="string"&&typeof m.modelVersion==="string"
   ?{activeWave:m.activeWave,direction:m.direction??null,modelVersion:m.modelVersion,
     parentDegree:m.parentDegree??null,parentWave:m.parentWave??null,
     publishedAt:validTime(p?.publishedAt)?p.publishedAt:null,publicationId:p?.publicationId??null}:null,
  legacySubmicroPresent:!!e?.currentWavelength?.degrees?.submicro,
  originalTimeSourceOnly:true,retrospectiveW5Applied:false};
}
export function inventorySubmicroOct26({root="/var/data/replay/es",dates=["2026-10-26","2026-10-27","2026-10-28"],maxPerDay=500}={}){
 if(!Array.isArray(dates)||dates.length===0||dates.some(d=>!/^2026-10-(26|27|28)$/.test(d))||
    !Number.isInteger(maxPerDay)||maxPerDay<1||maxPerDay>500)return {ok:false,reason:"INVALID_WINDOW"};
 const days=dates.map(date=>{
  const dir=path.join(root,date);
  if(!fs.existsSync(dir))return {date,available:false,reason:"DATE_NOT_FOUND",records:[]};
  const filenames=fs.readdirSync(dir).filter(n=>/^\d{4}\.json$/.test(n)).sort();
  if(filenames.length>maxPerDay)return {date,available:false,reason:"SCAN_LIMIT",records:[]};
  return {date,available:true,records:filenames.map(file=>{
    try{return inspectSubmicroReplay(fs.readFileSync(path.join(dir,file),"utf8"),{date,file})}
    catch{return {available:false,date,file,reason:"READ_ERROR"}}
  })};
 });
 return {schema:"engine27.v6.submicroReplayInventory.v1",ok:true,days,readOnly:true,noHistoricalBackfill:true,noExecution:true};
}
