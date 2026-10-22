// Engine22C simple owner-model touch memory. READ_ONLY with respect to wave
// structure and execution. This records observations, not canonical approval.
import fs from "node:fs";
import path from "node:path";

const DEGREES = ["submicro", "micro", "subminute"];
const finite = x => typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null;
const validKey = x => typeof x === "string" && /^[a-z0-9]+$/i.test(x);
const originMs = {
  micro: Date.parse("2026-10-15T13:30:00.000Z"),
  subminute: Date.parse("2026-10-01T14:00:00.000Z"),
  // Submicro W1 high timestamp has not been specified. No historical
  // candle backfill for this degree; use current/previous price observations.
  submicro: null,
};
function modelFor(degree, packet) {
  if (degree === "submicro" && packet?.ownerSubmicroADown?.version === "engine22.submicroADownOwnerWatch.v1") return packet.ownerSubmicroADown;
  if (degree === "micro" && packet?.ownerMicroBDown?.version === "engine22.microBDownOwnerWatch.v1") return packet.ownerMicroBDown;
  if (degree === "submicro") return packet?.ownerSubmicroAbc?.version === "engine22.submicroAbcMicroC.v1" ? packet.ownerSubmicroAbc : packet?.ownerSubmicroW2;
  if (degree === "micro") return packet?.ownerMicroAbc?.version === "engine22.microAbcMinuteD.v1" ? packet.ownerMicroAbc : packet?.ownerMicroW3;
  return packet;
}
function modelId(degree, model) {
  if (degree === "submicro" && !["engine22.submicroW2OwnerProjection.v1","engine22.submicroAbcMicroC.v1","engine22.submicroADownOwnerWatch.v1"].includes(model?.version)) return null;
  if (degree === "micro" && !["engine22.microW3OwnerProjection.v1","engine22.microAbcMinuteD.v1","engine22.microBDownOwnerWatch.v1"].includes(model?.version)) return null;
  if (degree === "subminute" && !Array.isArray(model?.levels)) return null;
  const anchors = model?.anchors || (model?.version === "engine22.microBDownOwnerWatch.v1" ? model.waveA : null) || (model?.version === "engine22.submicroADownOwnerWatch.v1" ? {referenceLow:model.referenceLow,originHigh:model.originHigh} : null) || (degree === "submicro" && model?.version === "engine22.submicroAbcMicroC.v1" ? {waveA:model.waveA,waveB:model.waveB} : null) || (degree === "micro" && model?.version === "engine22.microAbcMinuteD.v1" ? {waveA:model.waveA,waveB:model.waveB} : null) || (degree === "subminute" ?
    {w1Low:7616.25,w1High:7847,w2Low:7673.25} : {});
  const levels = model?.levels;
  if (!Array.isArray(levels) || !levels.length ||
      !levels.every(l=>validKey(l.key)&&finite(l.price))) return null;
  return JSON.stringify([degree,anchors,levels.map(l=>[l.key,l.price])]);
}
function observations({degree,modelVersion,price,previousPrice,bars=[],evaluationTimeMs}) {
  const items=[];
  const now=Number.isFinite(evaluationTimeMs)?evaluationTimeMs:Date.now();
  const current=finite(price),old=finite(previousPrice);
  const minMicroCOrigin=Date.parse("2026-10-20T12:00:00Z");
  const minSubmicroCOrigin=Date.parse("2026-10-21T14:00:00Z");
  const eligibleQuote=(degree!=="micro" || modelVersion!=="engine22.microBDownOwnerWatch.v1" || now>=Date.parse("2026-10-21T18:00:00Z")) && (degree!=="submicro" || modelVersion!=="engine22.submicroADownOwnerWatch.v1" || now>=Date.parse("2026-10-21T18:00:00Z")) && (degree!=="micro" || modelVersion!=="engine22.microAbcMinuteD.v1" || now>=minMicroCOrigin) &&
    (degree!=="submicro" || modelVersion!=="engine22.submicroAbcMicroC.v1" || now>=minSubmicroCOrigin);
  if (current!==null && eligibleQuote) {
    items.push({low:old===null?current:Math.min(old,current),
      high:old===null?current:Math.max(old,current),
      time:new Date(now).toISOString(),source:"ES_CURRENT_PRICE"});
  }
  if (degree !== "submicro" || ["engine22.submicroAbcMicroC.v1","engine22.submicroADownOwnerWatch.v1"].includes(modelVersion)) for (const b of Array.isArray(bars)?bars:[]) {
    const t=Number(b?.time),high=finite(b?.high),low=finite(b?.low);
    if(!Number.isSafeInteger(t)||t<=0||high===null||low===null||low>high)continue;
    const barStart=t*1000;
    const modelOrigin=["engine22.microBDownOwnerWatch.v1","engine22.submicroADownOwnerWatch.v1"].includes(modelVersion) ? Date.parse("2026-10-21T18:00:00Z") : degree==="submicro" && modelVersion==="engine22.submicroAbcMicroC.v1" ? Date.parse("2026-10-21T14:00:00Z") : (degree==="micro" && modelVersion==="engine22.microAbcMinuteD.v1" ? Date.parse("2026-10-20T12:00:00Z") : originMs[degree]);
    if(barStart<modelOrigin||barStart+600000>now)continue;
    items.push({low,high,time:new Date(barStart).toISOString(),source:"ES_10M_COMPLETED_OHLC"});
  }
  return items;
}
function readStore(filePath){
  try {
    const content=JSON.parse(fs.readFileSync(filePath,"utf8"));
    return content?.schema==="engine22.ownerPriceTouches.v1" && content?.models &&
      typeof content.models==="object" ? content.models : {};
  } catch {return {};}
}
function store(filePath,models){
  try {
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
    const temp=filePath+".tmp";
    fs.writeFileSync(temp,JSON.stringify({schema:"engine22.ownerPriceTouches.v1",models}));
    fs.renameSync(temp,filePath);
    return true;
  } catch {return false;}
}
export function applyOwnerPriceTouchesV1({
  currentWavelength=null, previousWavelength=null, currentPrice=null,
  bars10m=[], evaluationTimeMs=null, storePath=null,
}={}){
  if(!currentWavelength?.degrees)return currentWavelength;
  const root=structuredClone(currentWavelength);
  const disk=typeof storePath==="string"&&path.isAbsolute(storePath) ? readStore(storePath):{};
  for(const degree of DEGREES){
    const node=root.degrees?.[degree],model=modelFor(degree,node);
    const id=modelId(degree,model);
    if(!id)continue;
    const oldNode=previousWavelength?.degrees?.[degree];
    const oldModel=modelFor(degree,oldNode);
    const oldId=modelId(degree,oldModel);
    const previousLevels=oldId===id?oldModel.levels:[];
    const past=disk[id]&&typeof disk[id]==="object"?disk[id]:{};
    const source=observations({degree,modelVersion:model.version,price:currentPrice,
      previousPrice:oldId===id?previousWavelength?.currentPrice:null,
      bars:bars10m,evaluationTimeMs});
    const touched=model.levels.map(level=>{
      const prior=past[level.key] || previousLevels?.find(x=>x.key===level.key&&x.price===level.price);
      let result=prior?.status==="TOUCHED" && prior?.price===level.price ?
        {source:prior.touchEvidenceType||"PREVIOUS_SNAPSHOT",time:prior.touchedAt||null} : null;
      if(!result && level.status==="OWNER_OBSERVED_TOUCH" &&
        level.touchEvidenceType==="OWNER_CHART_OBSERVATION")
        result={source:"OWNER_CHART_OBSERVATION",time:null};
      if(!result) for(const bar of source){
        const isDown=["engine22.microBDownOwnerWatch.v1","engine22.submicroADownOwnerWatch.v1","engine22.submicroW2OwnerProjection.v1"].includes(model.version);
        const hit=isDown ? bar.low<=level.price : bar.high>=level.price;
        if(hit){result={source:bar.source,time:bar.time};break;}
      }
      return {...level,price:level.price,
        status:result?"TOUCHED":"WATCH",
        provisional:true,
        touchEvidenceAvailable:Boolean(result),
        touchEvidenceType:result?.source||null,
        touchedAt:result?.time||null};
    });
    model.levels=touched;
    if(degree==="subminute") node.levels=touched; // preserve historical Submicro W2 and Micro W3 ladders
    node.lastTouchedLevel=[...touched].reverse().find(x=>x.status==="TOUCHED")||null;
    disk[id]=Object.fromEntries(touched.filter(x=>x.status==="TOUCHED")
      .map(x=>[x.key,{key:x.key,price:x.price,status:"TOUCHED",
        touchEvidenceType:x.touchEvidenceType,touchedAt:x.touchedAt}]));
  }
  if(typeof storePath==="string"&&path.isAbsolute(storePath))store(storePath,disk);
  return root;
}
