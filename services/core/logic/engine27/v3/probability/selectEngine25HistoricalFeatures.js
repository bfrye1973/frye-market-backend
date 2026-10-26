// Point-in-time Engine25 archive selector. Original archived 10m/30m observations only.
// Do not reconstruct canonical historical blended participation.
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const ms=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const VALID_INTERVALS=new Map([[10,15*60000],[30,45*60000]]);
export function selectEngine25HistoricalFeatures({predictionTimestamp,tenMinute=[],thirtyMinute=[],minCoveragePct=70}={}){
 const at=ms(predictionTimestamp);
 if(at===null)return {available:false,reason:"INVALID_PREDICTION_TIME",features:{},noExecution:true};
 const features={};
 for(const [minutes,rows] of [[10,tenMinute],[30,thirtyMinute]]){
  const name=minutes===10?"tenMinute":"thirtyMinute";
  const records=Array.isArray(rows)?rows:[];
  const eligible=records.filter(x=>{
   const source=ms(x?.sourceTimestamp),generated=ms(x?.generatedAt),archived=ms(x?.archivedAt);
   return source!==null&&generated!==null&&archived!==null&&source<=at&&generated<=at&&archived<=at;
  }).sort((a,b)=>Date.parse(b.sourceTimestamp)-Date.parse(a.sourceTimestamp));
  const row=eligible[0];
  if(!row){features[name]={available:false,reason:"NO_ARCHIVED_OBSERVATION_KNOWN_AS_OF"};continue}
  const age=at-Date.parse(row.sourceTimestamp);
  if(age>VALID_INTERVALS.get(minutes)){features[name]={available:false,reason:"STALE_ARCHIVE",sourceTimestamp:row.sourceTimestamp};continue}
  if(row.completeCanonicalSet!==true||!finite(row.coveragePct)||row.coveragePct<minCoveragePct||
    !finite(row.stocksWithVolume)||row.stocksWithVolume<=0){
   features[name]={available:false,reason:"INSUFFICIENT_PARTICIPATION_COVERAGE",sourceTimestamp:row.sourceTimestamp};continue
  }
  if(!finite(row.advancingBreadthPct)||!finite(row.decliningBreadthPct)||
    !finite(row.volumeImbalance)||!finite(row.strongSectorCount)||!finite(row.weakSectorCount)){
   features[name]={available:false,reason:"REQUIRED_RAW_FEATURES_MISSING",sourceTimestamp:row.sourceTimestamp};continue
  }
  features[name]={available:true,sourceTimestamp:row.sourceTimestamp,
   generatedAt:row.generatedAt,archivedAt:row.archivedAt,coveragePct:row.coveragePct,
   breadthImbalance:row.advancingBreadthPct-row.decliningBreadthPct,
   volumeImbalance:row.volumeImbalance,
   sectorImbalance:row.strongSectorCount-row.weakSectorCount,
   provenance:"ORIGINAL_ENGINE25_IMMUTABLE_ARCHIVE"};
 }
 return {schema:"engine27.v3.engine25HistoricalFeatures.v1",available:Object.values(features).some(x=>x.available),
  predictionTimestamp,features,fullHistoricalBlendAvailable:false,noExecution:true};
}
