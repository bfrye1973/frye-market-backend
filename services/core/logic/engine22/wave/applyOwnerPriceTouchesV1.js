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
  if (degree === "submicro" && packet?.ownerSubmicroCDown?.version === "engine22.submicroCDownOwnerWatch.v1") return packet.ownerSubmicroCDown;
  if (degree === "submicro" && packet?.ownerSubmicroADown?.version === "engine22.submicroADownOwnerWatch.v1") return packet.ownerSubmicroADown;
  if (degree === "micro" && packet?.ownerMicroCDown?.version === "engine22.microCDownOwnerWatch.v1") return packet.ownerMicroCDown;
  if (degree === "micro" && packet?.ownerMicroBDown?.version === "engine22.microBDownOwnerWatch.v1") return packet.ownerMicroBDown;
  if (degree === "submicro") return packet?.ownerSubmicroAbc?.version === "engine22.submicroAbcMicroC.v1" ? packet.ownerSubmicroAbc : packet?.ownerSubmicroW2;
  if (degree === "micro") return packet?.ownerMicroAbc?.version === "engine22.microAbcMinuteD.v1" ? packet.ownerMicroAbc : packet?.ownerMicroW3;
  return packet;
}
function modelId(degree, model) {
  if (degree === "submicro" && !["engine22.submicroW2OwnerProjection.v1","engine22.submicroAbcMicroC.v1","engine22.submicroADownOwnerWatch.v1","engine22.submicroCDownOwnerWatch.v1"].includes(model?.version)) return null;
  if (degree === "micro" && !["engine22.microW3OwnerProjection.v1","engine22.microAbcMinuteD.v1","engine22.microBDownOwnerWatch.v1","engine22.microCDownOwnerWatch.v1"].includes(model?.version)) return null;
  if (degree === "subminute" && !Array.isArray(model?.levels)) return null;
  const anchors = model?.anchors || (model?.version==="engine22.submicroCDownOwnerWatch.v1"?{waveA:model.waveA,waveB:model.waveB}:null) || (model?.version==="engine22.microCDownOwnerWatch.v1"?{waveA:model.waveA,waveB:model.waveB}:null) || (model?.version === "engine22.microBDownOwnerWatch.v1" ? model.waveA : null) || (model?.version === "engine22.submicroADownOwnerWatch.v1" ? {referenceLow:model.referenceLow,originHigh:model.originHigh} : null) || (degree === "submicro" && model?.version === "engine22.submicroAbcMicroC.v1" ? {waveA:model.waveA,waveB:model.waveB} : null) || (degree === "micro" && model?.version === "engine22.microAbcMinuteD.v1" ? {waveA:model.waveA,waveB:model.waveB} : null) || (degree === "subminute" ?
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
  const eligibleQuote=(degree!=="submicro"||modelVersion!=="engine22.submicroCDownOwnerWatch.v1"||now>=Date.parse("2026-10-23T01:50:00Z")) && (degree!=="micro"||modelVersion!=="engine22.microCDownOwnerWatch.v1"||now>=Date.parse("2026-10-21T16:00:00Z")) && (degree!=="micro" || modelVersion!=="engine22.microBDownOwnerWatch.v1" || now>=Date.parse("2026-10-21T18:00:00Z")) && (degree!=="submicro" || modelVersion!=="engine22.submicroADownOwnerWatch.v1" || now>=Date.parse("2026-10-21T18:00:00Z")) && (degree!=="micro" || modelVersion!=="engine22.microAbcMinuteD.v1" || now>=minMicroCOrigin) &&
    (degree!=="submicro" || modelVersion!=="engine22.submicroAbcMicroC.v1" || now>=minSubmicroCOrigin);
  if (current!==null && eligibleQuote) {
    items.push({low:old===null?current:Math.min(old,current),
      high:old===null?current:Math.max(old,current),
      time:new Date(now).toISOString(),source:"ES_CURRENT_PRICE"});
  }
  if (degree !== "submicro" || ["engine22.submicroAbcMicroC.v1","engine22.submicroADownOwnerWatch.v1","engine22.submicroCDownOwnerWatch.v1"].includes(modelVersion)) for (const b of Array.isArray(bars)?bars:[]) {
    const t=Number(b?.time),high=finite(b?.high),low=finite(b?.low);
    if(!Number.isSafeInteger(t)||t<=0||high===null||low===null||low>high)continue;
    const barStart=t*1000;
    const modelOrigin=modelVersion==="engine22.submicroCDownOwnerWatch.v1"?Date.parse("2026-10-23T01:50:00Z"):modelVersion==="engine22.microCDownOwnerWatch.v1"?Date.parse("2026-10-21T16:00:00Z"):["engine22.microBDownOwnerWatch.v1","engine22.submicroADownOwnerWatch.v1"].includes(modelVersion) ? Date.parse("2026-10-21T18:00:00Z") : degree==="submicro" && modelVersion==="engine22.submicroAbcMicroC.v1" ? Date.parse("2026-10-21T14:00:00Z") : (degree==="micro" && modelVersion==="engine22.microAbcMinuteD.v1" ? Date.parse("2026-10-20T12:00:00Z") : originMs[degree]);
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
        const isDown=["engine22.microBDownOwnerWatch.v1","engine22.submicroADownOwnerWatch.v1","engine22.submicroW2OwnerProjection.v1","engine22.microCDownOwnerWatch.v1","engine22.submicroCDownOwnerWatch.v1"].includes(model.version);
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
  // Separate price-only touch history for the larger corrective C scenario.
  // Never copy these levels into the canonical Minute W3 or D-UP models.
  const cModel=root.degrees?.minute?.ownerLargerCDownScenario;
  if(cModel?.version==="engine22.largerCorrectionCDownWatch.v1" && Array.isArray(cModel.levels)){
    const id=JSON.stringify(["minute","largerCorrectionCDown",cModel.version,cModel.anchors,
      cModel.levels.map(x=>[x.key,x.price])]);
    const past=disk[id]||{};
    const previous=previousWavelength?.degrees?.minute?.ownerLargerCDownScenario;
    const same=previous?.version===cModel.version &&
      JSON.stringify(previous.anchors)===JSON.stringify(cModel.anchors);
    const now=Number.isFinite(evaluationTimeMs)?evaluationTimeMs:Date.now();
    const quote=finite(currentPrice);
    const oldQuote=same?finite(previousWavelength?.currentPrice):null;
    const observations=[];
    if(quote!==null)observations.push({
      low:oldQuote===null?quote:Math.min(quote,oldQuote),
      time:new Date(now).toISOString(),source:"ES_CURRENT_PRICE",
    });
    for(const b of Array.isArray(bars10m)?bars10m:[]){
      const time=Number(b?.time),low=finite(b?.low);
      if(!Number.isSafeInteger(time)||time<=0||low===null)continue;
      if(time*1000<Date.parse("2026-10-06T00:00:00Z")||time*1000+600000>now)continue;
      observations.push({low,time:new Date(time*1000).toISOString(),source:"ES_10M_COMPLETED_OHLC"});
    }
    cModel.levels=cModel.levels.map(level=>{
      const historical=past[level.key]||(same?previous?.levels?.find(x=>x.key===level.key&&x.price===level.price):null);
      const hit=observations.find(x=>x.low<=level.price);
      const prior=historical?.status==="TOUCHED"&&historical?.price===level.price;
      return {...level,status:prior||hit?"TOUCHED":"WATCH",
        touchEvidenceAvailable:Boolean(prior||hit),
        touchEvidenceType:prior?(historical.touchEvidenceType||"PREVIOUS_SNAPSHOT"):(hit?.source||null),
        touchedAt:prior?(historical.touchedAt||null):(hit?.time||null)};
    });
    disk[id]=Object.fromEntries(cModel.levels.filter(x=>x.status==="TOUCHED")
      .map(x=>[x.key,{key:x.key,price:x.price,status:x.status,
        touchEvidenceType:x.touchEvidenceType,touchedAt:x.touchedAt}]));
  }
  // Minute owner W2: record downward retracement touches separately from
  // historical Minute W3 and the larger C-down scenario.
  const minute=root.degrees?.minute?.ownerMinuteW2Retracement;
  if(minute?.version==="engine22.minuteW2RetracementOwner.v1" &&
     minute.activeWave==="W2" && Array.isArray(minute.levels)) {
    const id=JSON.stringify(["minute","ownerMinuteW2Retracement",minute.version,
      minute.anchors?.w1Low,minute.anchors?.w1High,
      minute.levels.map(level=>[level.key,level.price])]);
    const previous=previousWavelength?.degrees?.minute?.ownerMinuteW2Retracement;
    const same=previous?.version===minute.version &&
      previous.anchors?.w1Low===minute.anchors?.w1Low &&
      previous.anchors?.w1High===minute.anchors?.w1High;
    const past=disk[id]||{};
    const now=Number.isFinite(evaluationTimeMs)?evaluationTimeMs:Date.now();
    const start=Date.parse("2026-08-13T16:00:00Z"); // owner's 09:00 Arizona W1 high
    const quote=finite(currentPrice);
    const oldQuote=same?finite(previousWavelength?.currentPrice):null;
    const observed=[];
    if(now>=start && quote!==null)observed.push({
      low:oldQuote===null?quote:Math.min(oldQuote,quote),
      time:new Date(now).toISOString(),source:"ES_CURRENT_PRICE"});
    for(const bar of Array.isArray(bars10m)?bars10m:[]) {
      const seconds=Number(bar?.time),low=finite(bar?.low);
      if(!Number.isSafeInteger(seconds)||seconds<=0||low===null)continue;
      const timestamp=seconds*1000;
      if(timestamp<start||timestamp+600000>now)continue;
      observed.push({low,time:new Date(timestamp).toISOString(),
        source:"ES_10M_COMPLETED_OHLC"});
    }
    minute.levels=minute.levels.map(level=>{
      const prior=past[level.key]||(same?previous?.levels?.find(x=>
        x.key===level.key&&x.price===level.price):null);
      const retained=prior?.status==="TOUCHED"&&prior?.price===level.price;
      const hit=retained?null:observed.find(x=>x.low<=level.price);
      return {...level,status:retained||hit?"TOUCHED":"WATCH",
        touchEvidenceAvailable:Boolean(retained||hit),
        touchEvidenceType:retained
          ?prior.touchEvidenceType||"PREVIOUS_SNAPSHOT":hit?.source||null,
        touchedAt:retained?prior.touchedAt||null:hit?.time||null,
        touchEvidence:retained||hit?{
          verified:hit?.source==="ES_10M_COMPLETED_OHLC" ||
            prior?.touchEvidence?.verified===true,
          evidenceClass:hit?.source==="ES_10M_COMPLETED_OHLC"
            ?"COMPLETED_CANDLE":retained?"RETAINED_OBSERVATION":"SNAPSHOT_PRICE",
          historicBarTouchUnverified:hit?.source!=="ES_10M_COMPLETED_OHLC"
            && prior?.touchEvidence?.verified!==true,
        }:null};
    });
    disk[id]=Object.fromEntries(minute.levels.filter(x=>x.status==="TOUCHED")
      .map(x=>[x.key,{key:x.key,price:x.price,status:x.status,
        touchEvidenceType:x.touchEvidenceType,touchedAt:x.touchedAt,
        touchEvidence:x.touchEvidence}]));
  }
  // Subminute D UP retracements use an independent memory key from the
  // earlier Subminute C-down and Minute W2 levels. No old touch history reset.
  const subminuteD=root.degrees?.subminute?.ownerCurrentDUp;
  if(subminuteD?.version==="engine22.subminuteDUpOwnerWorking.v1" &&
     subminuteD.activeWave==="D" && Array.isArray(subminuteD.levels)){
    const id=JSON.stringify(["subminute","ownerCurrentDUp",subminuteD.version,
      subminuteD.anchors?.bHigh,subminuteD.anchors?.cLow,
      subminuteD.levels.map(l=>[l.key,l.price])]);
    const priorModel=previousWavelength?.degrees?.subminute?.ownerCurrentDUp;
    const same=priorModel?.version===subminuteD.version &&
      priorModel.anchors?.bHigh===subminuteD.anchors?.bHigh &&
      priorModel.anchors?.cLow===subminuteD.anchors?.cLow;
    const historical=disk[id]||{};
    const now=Number.isFinite(evaluationTimeMs)?evaluationTimeMs:Date.now();
    const from=Date.parse("2026-10-23T14:00:00.000Z");
    const quote=finite(currentPrice);
    const previousQuote=same?finite(previousWavelength?.currentPrice):null;
    const observed=[];
    if(now>=from && quote!==null)
      observed.push({high:previousQuote===null?quote:Math.max(quote,previousQuote),
        time:new Date(now).toISOString(),source:"ES_CURRENT_PRICE"});
    for(const bar of Array.isArray(bars10m)?bars10m:[]){
      const t=Number(bar?.time),high=finite(bar?.high);
      if(!Number.isSafeInteger(t)||t<=0||high===null)continue;
      if(t*1000<from||t*1000+600000>now)continue;
      observed.push({high,time:new Date(t*1000).toISOString(),
        source:"ES_10M_COMPLETED_OHLC"});
    }
    subminuteD.levels=subminuteD.levels.map(level=>{
      const prior=historical[level.key] || (same?priorModel.levels?.find(l=>
        l.key===level.key&&l.price===level.price):null);
      const retained=prior?.status==="TOUCHED"&&prior?.price===level.price;
      const hit=retained?null:observed.find(o=>o.high>=level.price);
      return {...level,status:retained||hit?"TOUCHED":"WATCH",
        provisional:true,touchEvidenceAvailable:Boolean(retained||hit),
        touchEvidenceType:retained?prior.touchEvidenceType||"PREVIOUS_SNAPSHOT":hit?.source||null,
        touchedAt:retained?prior.touchedAt||null:hit?.time||null,
        touchEvidence:retained||hit?{
          verified:hit?.source==="ES_10M_COMPLETED_OHLC"||
            prior?.touchEvidence?.verified===true,
          evidenceClass:hit?.source==="ES_10M_COMPLETED_OHLC"?
            "COMPLETED_CANDLE":retained?"RETAINED_OBSERVATION":"SNAPSHOT_PRICE",
        }:null};
    });
    disk[id]=Object.fromEntries(subminuteD.levels.filter(l=>l.status==="TOUCHED")
      .map(l=>[l.key,{key:l.key,price:l.price,status:l.status,
        touchEvidenceType:l.touchEvidenceType,touchedAt:l.touchedAt,
        touchEvidence:l.touchEvidence}]));
  }
  // Independent Micro W3-up Fib touch memory. The historical Micro C-down
  // model remains the legacy degree model; never overwrite its touch ledger.
  const microW3=root.degrees?.micro?.ownerMicroW3Up;
  if(microW3?.version==="engine22.microW3UpOct27Owner.v1" &&
     microW3.activeWave==="W3" &&
     Array.isArray(microW3.levels) && microW3.wave1?.high===7739.50){
    const key=JSON.stringify(["micro","ownerMicroW3Up",microW3.version,
      microW3.wave1.low,microW3.wave1.high,microW3.wave2?.low,
      microW3.levels.map(l=>[l.key,l.price])]);
    const previous=previousWavelength?.degrees?.micro?.ownerMicroW3Up;
    const matching=previous?.version===microW3.version &&
      previous.wave1?.low===microW3.wave1.low &&
      previous.wave1?.high===microW3.wave1.high &&
      previous.wave2?.low===microW3.wave2?.low;
    const priorTouches=disk[key]||{};
    const now=Number.isFinite(evaluationTimeMs)?evaluationTimeMs:Date.now();
    const start=Date.parse("2026-10-27T08:00:00.000Z");
    const price=finite(currentPrice);
    const previousQuote=matching?finite(previousWavelength?.currentPrice):null;
    const observations=[];
    if(now>=start && price!==null)
      observations.push({high:previousQuote===null?price:Math.max(price,previousQuote),
        time:new Date(now).toISOString(),source:"ES_CURRENT_PRICE"});
    for(const bar of Array.isArray(bars10m)?bars10m:[]){
      const time=Number(bar?.time),high=finite(bar?.high);
      if(!Number.isSafeInteger(time)||time<=0||high===null)continue;
      if(time*1000<start||time*1000+600000>now)continue;
      observations.push({high,time:new Date(time*1000).toISOString(),
        source:"ES_10M_COMPLETED_OHLC"});
    }
    microW3.levels=microW3.levels.map(level=>{
      const old=priorTouches[level.key]||
        (matching?previous.levels?.find(l=>l.key===level.key&&l.price===level.price):null);
      const retained=old?.status==="TOUCHED"&&old?.price===level.price;
      const fresh=retained?null:observations.find(o=>o.high>=level.price);
      return {...level,status:retained||fresh?"TOUCHED":"WATCH",
        provisional:true,touchEvidenceAvailable:Boolean(retained||fresh),
        touchEvidenceType:retained?old.touchEvidenceType||"PREVIOUS_SNAPSHOT":fresh?.source||null,
        touchedAt:retained?old.touchedAt||null:fresh?.time||null,
        touchEvidence:retained||fresh?{
          verified:fresh?.source==="ES_10M_COMPLETED_OHLC"||
            old?.touchEvidence?.verified===true,
          evidenceClass:fresh?.source==="ES_10M_COMPLETED_OHLC"?
            "COMPLETED_CANDLE":retained?"RETAINED_OBSERVATION":"SNAPSHOT_PRICE",
        }:null};
    });
    disk[key]=Object.fromEntries(microW3.levels.filter(l=>l.status==="TOUCHED")
      .map(l=>[l.key,{key:l.key,price:l.price,status:l.status,
        touchEvidenceType:l.touchEvidenceType,touchedAt:l.touchedAt,
        touchEvidence:l.touchEvidence}]));
  }
  // Owner Submicro W5-up projections: independent per-model touch memory.
  // Never overwrite historical C-down Fib status or its disk identity.
  const submicroW5=root.degrees?.submicro?.ownerSubmicroFiveUp;
  if(submicroW5?.version==="engine22.submicroFiveUpOct27OwnerWatch.v1" &&
     submicroW5.wave4?.low===7750.50 && Array.isArray(submicroW5.levels)){
    const id=JSON.stringify(["submicro","ownerSubmicroFiveUp",submicroW5.version,
      submicroW5.wave1?.low,submicroW5.wave1?.high,submicroW5.wave4?.low,
      submicroW5.levels.map(x=>[x.key,x.price])]);
    const previous=previousWavelength?.degrees?.submicro?.ownerSubmicroFiveUp;
    const same=previous?.version===submicroW5.version &&
      previous.wave1?.low===submicroW5.wave1.low &&
      previous.wave1?.high===submicroW5.wave1.high &&
      previous.wave4?.low===submicroW5.wave4.low;
    const retained=disk[id]||{};
    const now=Number.isFinite(evaluationTimeMs)?evaluationTimeMs:Date.now();
    const start=Date.parse("2026-10-27T18:30:00.000Z"); // owner W4 low 11:30 AZ
    const price=finite(currentPrice);
    const previousPrice=same?finite(previousWavelength?.currentPrice):null;
    const seen=[];
    if(now>=start && price!==null)
      seen.push({high:previousPrice===null?price:Math.max(price,previousPrice),
        time:new Date(now).toISOString(),source:"ES_CURRENT_PRICE"});
    for(const b of Array.isArray(bars10m)?bars10m:[]){
      const t=Number(b?.time),high=finite(b?.high);
      if(!Number.isSafeInteger(t)||t<=0||high===null)continue;
      if(t*1000<start||t*1000+600000>now)continue;
      seen.push({high,time:new Date(t*1000).toISOString(),
        source:"ES_10M_COMPLETED_OHLC"});
    }
    submicroW5.levels=submicroW5.levels.map(l=>{
      const prior=retained[l.key]||(same?previous.levels?.find(x=>
        x.key===l.key&&x.price===l.price):null);
      const persist=prior?.status==="TOUCHED"&&prior?.price===l.price;
      const hit=persist?null:seen.find(x=>x.high>=l.price);
      return {...l,status:persist||hit?"TOUCHED":"WATCH",
        touchEvidenceAvailable:Boolean(persist||hit),
        touchEvidenceType:persist?prior.touchEvidenceType||"PREVIOUS_SNAPSHOT":hit?.source||null,
        touchedAt:persist?prior.touchedAt||null:hit?.time||null,
        touchEvidence:persist||hit?{
          verified:hit?.source==="ES_10M_COMPLETED_OHLC"||
            prior?.touchEvidence?.verified===true,
          evidenceClass:hit?.source==="ES_10M_COMPLETED_OHLC"?
            "COMPLETED_CANDLE":persist?"RETAINED_OBSERVATION":"SNAPSHOT_PRICE",
        }:null};
    });
    disk[id]=Object.fromEntries(submicroW5.levels.filter(x=>x.status==="TOUCHED")
      .map(x=>[x.key,{key:x.key,price:x.price,status:x.status,
        touchEvidenceType:x.touchEvidenceType,touchedAt:x.touchedAt,
        touchEvidence:x.touchEvidence}]));
  }
  // Oct28 descending correction: independent durable touched evidence for W4 and A.
  // A downside level is contacted when the observed LOW <= its price.
  for(const [degree,modelKey,version] of [
    ["micro","ownerMicroW4Down","engine22.microW4DownOct28OwnerWorking.v1"],
    ["submicro","ownerSubmicroADownInsideMicroW4","engine22.submicroADownMicroW4Oct28OwnerWorking.v1"],
  ]){
    const model=root.degrees?.[degree]?.[modelKey];
    if(model?.version!==version||!Array.isArray(model.levels))continue;
    const beginning=Date.parse("2026-10-28T20:00:00Z");
    const now=Number.isFinite(evaluationTimeMs)?evaluationTimeMs:Date.now();
    const id=JSON.stringify([degree,modelKey,version,7820.00,
      model.levels.map(l=>[l.key,l.price])]);
    const old=previousWavelength?.degrees?.[degree]?.[modelKey];
    const same=old?.version===version;
    const retained=disk[id]||{};
    const observed=[];
    const current=finite(currentPrice);
    const prior=same?finite(previousWavelength?.currentPrice):null;
    if(now>=beginning&&current!==null)
      observed.push({low:prior===null?current:Math.min(current,prior),
        time:new Date(now).toISOString(),source:"ES_CURRENT_PRICE"});
    for(const bar of Array.isArray(bars10m)?bars10m:[]){
      const t=Number(bar?.time),low=finite(bar?.low);
      if(!Number.isSafeInteger(t)||t<=0||low===null)continue;
      if(t*1000<beginning||t*1000+600000>now)continue;
      observed.push({low,time:new Date(t*1000).toISOString(),
        source:"ES_10M_COMPLETED_OHLC"});
    }
    model.levels=model.levels.map(l=>{
      const priorTouch=retained[l.key]||(same?old.levels?.find(x=>
        x.key===l.key&&x.price===l.price):null);
      const keep=priorTouch?.status==="TOUCHED"&&priorTouch.price===l.price;
      const hit=keep?null:observed.find(o=>o.low<=l.price);
      return {...l,status:keep||hit?"TOUCHED":"WATCH",
        touchEvidenceAvailable:Boolean(keep||hit),
        touchEvidenceType:keep?priorTouch.touchEvidenceType||"PREVIOUS_SNAPSHOT":hit?.source||null,
        touchedAt:keep?priorTouch.touchedAt||null:hit?.time||null,
        touchEvidence:keep||hit?{
          verified:hit?.source==="ES_10M_COMPLETED_OHLC"||
            priorTouch?.touchEvidence?.verified===true,
          evidenceClass:hit?.source==="ES_10M_COMPLETED_OHLC"?
            "COMPLETED_CANDLE":keep?"RETAINED_OBSERVATION":"SNAPSHOT_PRICE",
        }:null};
    });
    disk[id]=Object.fromEntries(model.levels.filter(x=>x.status==="TOUCHED")
      .map(x=>[x.key,{key:x.key,price:x.price,status:x.status,
        touchEvidenceType:x.touchEvidenceType,touchedAt:x.touchedAt,
        touchEvidence:x.touchEvidence}]));
  }
  if(typeof storePath==="string"&&path.isAbsolute(storePath))store(storePath,disk);
  return root;
}
