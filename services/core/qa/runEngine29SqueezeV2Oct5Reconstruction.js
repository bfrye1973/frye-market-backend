// services/core/qa/runEngine29SqueezeV2Oct5Reconstruction.js
//
// Oct 5, 2026 reconstructed acceptance case.
// ES = real 10m bars.
// Internals = real retained Engine25 1H snapshots, held until the next 1H snapshot.
// This is NOT a claim that 10m Engine25 internals existed historically.

import {
  scoreESAbnormalityHorizon,
  scoreESAbnormalityQuality,
  scoreSqueezePressure,
  scoreSqueezeV2Internals,
} from "../logic/engine29/tacticalCharacter/squeezeV2Scoring.js";

const BACKEND =
  process.env.ENGINE29_REPLAY_BACKEND ||
  "https://frye-market-backend-1.onrender.com";

const checkpoints = [
  { ts:"2026-10-05T13:05:01Z", advancingBreadthPct:48.522458628841605, strongSectorCount:3, neutralSectorCount:8, weakSectorCount:0, newHighs:440, newLows:313, advancingVolumeShare:75.42703151168874 },
  { ts:"2026-10-05T14:09:00Z", advancingBreadthPct:33.351322180248246, strongSectorCount:0, neutralSectorCount:4, weakSectorCount:7, newHighs:1021, newLows:1758, advancingVolumeShare:58.398598034683104 },
  { ts:"2026-10-05T15:08:17Z", advancingBreadthPct:51.781737193763924, strongSectorCount:6, neutralSectorCount:3, weakSectorCount:2, newHighs:950, newLows:809, advancingVolumeShare:62.46694220455581 },
  { ts:"2026-10-05T16:05:35Z", advancingBreadthPct:77.99063431247339, strongSectorCount:6, neutralSectorCount:5, weakSectorCount:0, newHighs:676, newLows:424, advancingVolumeShare:75.27844554610475 },
  { ts:"2026-10-05T17:04:38Z", advancingBreadthPct:72.80033840947546, strongSectorCount:8, neutralSectorCount:3, weakSectorCount:0, newHighs:869, newLows:253, advancingVolumeShare:65.61028557870709 },
  { ts:"2026-10-05T18:04:10Z", advancingBreadthPct:60.22179363548699, strongSectorCount:7, neutralSectorCount:2, weakSectorCount:2, newHighs:687, newLows:331, advancingVolumeShare:59.48199307476183 },
  { ts:"2026-10-05T19:09:10Z", advancingBreadthPct:54.62624150548876, strongSectorCount:5, neutralSectorCount:5, weakSectorCount:1, newHighs:815, newLows:290, advancingVolumeShare:68.05040048656747 },
  { ts:"2026-10-05T20:29:45Z", advancingBreadthPct:42.311276794035415, strongSectorCount:2, neutralSectorCount:8, weakSectorCount:1, newHighs:838, newLows:537, advancingVolumeShare:48.07763442772098 },
].map((x)=>({
  ...x,
  decliningBreadthPct:100-x.advancingBreadthPct,
  decliningVolumeShare:100-x.advancingVolumeShare,
  sourceTimestamp:x.ts,
}));

function finite(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function ms(v){ return Date.parse(v); }
function pct(a,b){ a=finite(a); b=finite(b); return Number.isFinite(a)&&Number.isFinite(b)&&a!==0?((b-a)/Math.abs(a))*100:null; }
function round(v,d=1){ return Number.isFinite(v)?Number(v.toFixed(d)):null; }

async function getJson(url){
  const r=await fetch(url,{cache:"no-store",headers:{accept:"application/json","cache-control":"no-store"}});
  const text=await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,300)}`);
  return JSON.parse(text);
}

function bars(payload){
  const xs=Array.isArray(payload)?payload:Array.isArray(payload?.bars)?payload.bars:[];
  return xs.map(b=>({
    time:(Number(b.time??b.t)<1e12?Number(b.time??b.t)*1000:Number(b.time??b.t)),
    close:Number(b.close??b.c),
  })).filter(b=>Number.isFinite(b.time)&&Number.isFinite(b.close)).sort((a,b)=>a.time-b.time);
}

function sameWindowReturns(xs,endIndex,barsBack,baseline=40){
  const out=[];
  const start=Math.max(barsBack,endIndex-baseline);
  for(let end=start;end<endIndex;end++){
    const r=pct(xs[end-barsBack]?.close,xs[end]?.close);
    if(Number.isFinite(r)) out.push(r);
  }
  return out;
}

function checkpointAt(t){
  return checkpoints.filter(c=>ms(c.ts)<=t).at(-1)||null;
}

function azTime(t){
  const d=new Date(t-7*60*60*1000);
  return d.toISOString().slice(11,16);
}

async function main(){
  const url=new URL("/api/v1/futures/ohlc",BACKEND);
  url.searchParams.set("symbol","ES");
  url.searchParams.set("timeframe","10m");
  url.searchParams.set("limit","5000");
  const xs=bars(await getJson(url));

  const start=Date.parse("2026-10-05T13:30:00Z");
  const end=Date.parse("2026-10-05T20:30:00Z");

  const rows=[];
  for(let i=2;i<xs.length;i++){
    const bar=xs[i];
    if(bar.time<start||bar.time>end) continue;

    const c=checkpointAt(bar.time);
    if(!c) continue;

    const r10=pct(xs[i-1].close,xs[i].close);
    const r20=pct(xs[i-2].close,xs[i].close);
    const direction=(r10+r20)>0?"UP":(r10+r20)<0?"DOWN":null;
    if(!direction) continue;

    const a10=scoreESAbnormalityHorizon({
      currentReturnPct:r10,
      historicalSameWindowReturnsPct:sameWindowReturns(xs,i,1),
    });
    const a20=scoreESAbnormalityHorizon({
      currentReturnPct:r20,
      historicalSameWindowReturnsPct:sameWindowReturns(xs,i,2),
    });
    const es=scoreESAbnormalityQuality({quality10:a10.quality,quality20:a20.quality});
    const internals=scoreSqueezeV2Internals(c,direction);
    const pressure=scoreSqueezePressure({
      esAbnormalityQuality:es.score,
      internalDivergence:internals.internalDivergence.score,
    });

    rows.push({
      az:azTime(bar.time),
      barTime:new Date(bar.time).toISOString(),
      internalsSource:c.ts,
      direction,
      r10:round(r10,4),
      r20:round(r20,4),
      esQuality:round(es.score,1),
      divergence:round(internals.internalDivergence.score,1),
      participation:round(internals.participationConfirmation.score,1),
      pressure:round(pressure.score,1),
    });
  }

  const strongest=[...rows].sort((a,b)=>b.pressure-a.pressure).slice(0,15);
  const watch=rows.filter(r=>r.esQuality>=45&&r.divergence>=45&&r.pressure>=25);
  const active=rows.filter(r=>r.esQuality>=50&&r.divergence>=55&&r.pressure>=40);
  const broad=rows.filter(r=>r.esQuality>=50&&r.participation>=70&&r.pressure<30);

  console.log("OCT5_RECON_ROWS "+JSON.stringify(rows));
  console.log("OCT5_RECON_SUMMARY "+JSON.stringify({
    window:"06:30-13:30 America/Phoenix",
    evidence:"REAL_ES_10M_PLUS_RETAINED_ENGINE25_1H_STEP_PROXY",
    rows:rows.length,
    watchCount:watch.length,
    activeCount:active.length,
    watchTimes:watch.map(r=>r.az),
    activeTimes:active.map(r=>r.az),
    broadMoveTimes:broad.map(r=>r.az),
    strongest,
  }));
}
main().catch(e=>{console.error("OCT5_RECON_FAIL",e?.stack||e);process.exit(1);});
