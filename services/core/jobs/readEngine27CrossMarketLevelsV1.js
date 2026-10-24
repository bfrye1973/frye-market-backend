import fs from "node:fs";
import path from "node:path";
export function readEngine27CrossMarketLevelsV1({filePath=null,now=new Date()}={}){
 const unavailable={schema:"engine27.crossMarketSource.v1",available:false,instruments:{},reasonCodes:["PUBLISHED_SOURCE_UNAVAILABLE"]};
 if(typeof filePath!=="string"||!path.isAbsolute(filePath))return unavailable;
 try {
  const data=JSON.parse(fs.readFileSync(filePath,"utf8"));
  if(data?.schema!=="engine27.crossMarketSource.v1"||!data?.instruments)return unavailable;
  const out={};
  for(const [key,symbol,schema] of [["QQQ","QQQ","engine27.qqqKeyLevels.v1"],["VIX","I:VIX","engine27.vixKeyLevels.v1"]]){
   const read=data.instruments[key];
   const stale=!read?.lastCandleTime||!Number.isFinite(Date.parse(read.lastCandleTime))||
    now.getTime()-Date.parse(read.lastCandleTime)>4*86400000;
   const valid=read?.available===true&&read.symbol===symbol&&read.schema===schema&&
    Array.isArray(read.levels)&&!stale;
   out[key]=valid?read:{available:false,symbol,reasonCodes:[stale?"STALE_DAILY_HISTORY":"INVALID_PUBLISHED_SOURCE"]};
  }
  return {schema:"engine27.crossMarketSource.v1",available:true,asOf:data.asOf??null,instruments:out,reasonCodes:[]};
 }catch{
  return unavailable;
 }
}
