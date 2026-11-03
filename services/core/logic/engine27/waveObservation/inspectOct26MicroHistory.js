// Engine27 V6: read-only point-in-time Micro replay inventory.
// Never infer historical approval from today's Engine22 selection.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const iso = value => typeof value==="string"&&Number.isFinite(Date.parse(value))?value:null;
const DAY=/^2026-10-(26|27|28)$/;
const NAME=/^\d{4}\.json$/;
const physical = value => typeof value==="string" && /^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(value) ? value:null;

export function inspectMicroReplayFile(raw,{date,file}={}) {
  let replay;
  try {replay=JSON.parse(raw)} catch {return {file,date,available:false,reason:"INVALID_JSON"};}
  const canonical=replay?.schema==="engine12.multiStrategyReplay.v1"&&
    replay?.replayContract==="CANONICAL_MULTI_STRATEGY_REPLAY";
  const source=replay?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy??null;
  const authorized=source?.authorizedWorkingStructure??null;
  const micro=authorized?.degrees?.micro??null;
  const snapshotTime=iso(replay?.snapshotTime);
  const resolvedContract=physical(replay?.resolvedEsContract)??physical(replay?.resolvedContract);
  return {
    file,date,available:true,canonical,recordSha256:digest(raw),
    snapshotTime,originalTimeVerified:Boolean(snapshotTime),exactPhysicalContract:resolvedContract??null,
    exactContractVerified:Boolean(resolvedContract),
    hasEngine22:Boolean(source),hasAuthorizedPacket:Boolean(authorized),
    authorizedPacketStatus:authorized?.status??null,
    originalMicroPublished:Boolean(micro?.available===true && micro?.activeWave && micro?.modelVersion),
    originalMicro:micro?.available===true ? {
      activeWave:micro.activeWave??null,direction:micro.direction??null,
      modelVersion:micro.modelVersion??null,parentWave:micro.parentWave??null,
      publishedAt:iso(authorized?.publishedAt),
      publicationId:authorized?.publicationId??null,
      selectionRevision:authorized?.publicationRevision??null
    }:null,
    // Legacy fields are evidence of what snapshot contained, not approval of today's model.
    hasLegacyMicroState:Boolean(source?.currentWavelength?.degrees?.micro),
    historicalInterpretation:"AS_RECORDED_ONLY",
    retrospectiveW3Applied:false
  };
}
export function inspectOct26MicroReplayHistory({root="/var/data/replay/es",dates=["2026-10-26","2026-10-27","2026-10-28"],maxFilesPerDay=500}={}) {
 if(!Array.isArray(dates)||!dates.length||dates.some(d=>!DAY.test(d))||
    !Number.isInteger(maxFilesPerDay)||maxFilesPerDay<1||maxFilesPerDay>500)
   return {ok:false,reason:"INVALID_RESEARCH_WINDOW"};
 const days=[];
 for(const date of dates){
   const dir=path.join(root,date);
   if(!fs.existsSync(dir)){days.push({date,available:false,reason:"REPLAY_DATE_NOT_FOUND",records:[]});continue;}
   const names=fs.readdirSync(dir).filter(n=>NAME.test(n)).sort();
   if(names.length>maxFilesPerDay){days.push({date,available:false,reason:"DAY_EXCEEDS_SCAN_LIMIT",fileCount:names.length,records:[]});continue;}
   const records=names.map(file=>{
     try{return inspectMicroReplayFile(fs.readFileSync(path.join(dir,file),"utf8"),{date,file})}
     catch{return {date,file,available:false,reason:"READ_FAILED"}}
   });
   days.push({date,available:true,fileCount:names.length,records});
 }
 return {schema:"engine27.v6.microHistoricalReplayInventory.v1",ok:true,days,
  readOnly:true,noBackfill:true,noWaveAuthority:true,noTradeAuthority:true};
}
