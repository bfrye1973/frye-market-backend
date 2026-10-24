// Read-only, on-demand source acceptance. Does not persist or modify snapshots.
// Run from services/core: node jobs/auditEngine27CrossMarketLiveSourcesV1.js
import {buildEngine27CrossMarketSourceV1} from "./buildEngine27CrossMarketSourceV1.js";
const result=await buildEngine27CrossMarketSourceV1({
 apiKey:process.env.POLYGON_API_KEY??process.env.MASSIVE_API_KEY??null,
 now:new Date(),
});
const summary=Object.fromEntries(Object.entries(result.instruments??{}).map(([key,v])=>[key,{
 symbol:v.sourceSymbol??v.symbol??key,
 available:v.available===true,
 lastCandleTime:v.lastCandleTime??null,
 bars:v.sourceBars??0,
 zones:Array.isArray(v.levels)?v.levels.length:0,
 close:v.close??null,
 nearestZones:Array.isArray(v.levels)&&Number.isFinite(v.close)?v.levels.slice().sort((a,b)=>Math.abs(a.center-v.close)-Math.abs(b.center-v.close)).slice(0,5).map(l=>({low:l.low,high:l.high,type:l.type,observations:l.observationCount})):[],
 reasonCodes:v.reasonCodes??[],
 errorClass:v.errorClass??null,
}]));
console.log(JSON.stringify({schema:result.schema,asOf:result.asOf,reasonCodes:result.reasonCodes??[],instruments:summary},null,2));
if(Object.values(summary).some(x=>x.available!==true)||Object.keys(summary).length!==2)process.exitCode=1;
