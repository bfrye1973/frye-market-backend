import assert from "node:assert/strict";
import {buildEngine2ChartOverlayV1} from "../logic/engine2/buildEngine2ChartOverlayV1.js";
const base="https://frye-market-backend-1.onrender.com";
async function read(path){
 const res=await fetch(base+path,{signal:AbortSignal.timeout(45000),headers:{Accept:"application/json"}});
 assert.ok(res.ok,path+" HTTP "+res.status);return res.json();
}
const snapshot=await read("/api/v1/dashboard-snapshot?symbol=ES");
const barsByTf={};
for(const tf of ["10m","1h"]){
 const raw=await read("/api/v1/futures/ohlc?symbol=ES&timeframe="+tf+"&limit=3000");
 barsByTf[tf]=Array.isArray(raw)?raw:Array.isArray(raw?.bars)?raw.bars:[];
}
const out=buildEngine2ChartOverlayV1(snapshot,"ES");
const source=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.degreeStates;
const summary={timestamp:snapshot?.generatedAt||null,rows:[],barCounts:{}};
for(const tf of ["10m","1h"])summary.barCounts[tf]=barsByTf[tf].length;
for(const degree of ["minor","minute"]){
 const marks=source?.[degree]?.marks||{};
 const kept=out.degrees[degree].marks||[];
 for(const [key,node] of Object.entries(marks)){
  if(!node)continue;
  const rows=kept.filter(x=>x.id===key||x.id.startsWith(key+"_"));
  const item={degree,wave:key,sourceStatus:node.status||null,sourcePrice:node.price||null,
   sourceTime:node.time||null,apiMarks:rows.map(x=>({id:x.id,price:x.price,time:x.time,status:x.status}))};
  item.timeframes={};
  for(const tf of ["10m","1h"]){
   const bars=barsByTf[tf],list=[];
   for(const mark of rows){
    const nearest=bars.reduce((best,b)=>{
      const rawTime=b.time??b.t??b.ts??b.timestamp;
      const n=typeof rawTime==="number"?(rawTime>1e12?Math.floor(rawTime/1000):rawTime):
        Number.isFinite(Date.parse(rawTime))?Math.floor(Date.parse(rawTime)/1000):null;
      if(n==null||!Number.isFinite(n))return best;
      return best==null||Math.abs(n-mark.time)<Math.abs(best-mark.time)?n:best;
    },null);
    list.push({id:mark.id,nearestCandleTime:nearest,secondsDifference:nearest==null?null:Math.abs(nearest-mark.time),
      passesExistingEightHourGuard:nearest!=null&&Math.abs(nearest-mark.time)<=8*3600});
   }
   item.timeframes[tf]=list;
  }
  summary.rows.push(item);
 }
}
assert.ok(summary.rows.length,"No canonical wave marks available");
console.log("ENGINE2B_FROZEN_ANCHOR_RECONCILIATION",JSON.stringify(summary));
