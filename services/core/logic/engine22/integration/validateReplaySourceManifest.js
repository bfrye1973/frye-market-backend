// Engine 22 ES replay provenance gate.
// Pure validation of supplied metadata; does NOT independently authenticate vendor data.
// No network, account data, brokerage calls, file IO, historical promotion or count activation.
export const ENGINE22_REPLAY_MANIFEST_SCHEMA="engine22.esReplayManifest.v1";
const knownTF=Object.freeze({"5m":300000,"10m":600000,"1h":3600000,"4h":14400000,"1d":86400000});
const str=x=>typeof x==="string"&&x.trim().length>0;
const utc=x=>str(x)&&/(?:Z|[+-]\d{2}:\d{2})$/i.test(x)&&Number.isFinite(Date.parse(x));
const contract=/^ES[FGHJKMNQUVXZ]\d{1,2}$/;
function reject(reason){return {accepted:false,reasonCodes:[reason],barCount:0,sourceDataVerified:false,
  independentlyAuthenticated:false,shadowOnly:true,noExecution:true,noPermissionCreated:true};}
export function validateEngine22EsReplayManifest({manifest=null,bars=[]}={}){
 if(!manifest||manifest.schema!==ENGINE22_REPLAY_MANIFEST_SCHEMA||manifest.symbol!=="ES")
   return reject("ES_MANIFEST_SCHEMA_REQUIRED");
 const tf=manifest.timeframe,ms=knownTF[tf];
 if(!ms||!str(manifest.sourceVendor)||!str(manifest.datasetId)||!str(manifest.datasetVersion)||
   !str(manifest.sourceSeriesId)||!str(manifest.sourceContract)||
   !contract.test(manifest.sourceContract)||!str(manifest.priceBasis)||
   !str(manifest.sessionCalendar)||!str(manifest.receiptId))
   return reject("CONTRACT_SOURCE_LINEAGE_REQUIRED");
 if(!Array.isArray(bars)||bars.length<5)
   return reject("FIVE_COMPLETED_SOURCE_BARS_REQUIRED");
 const seen=new Set();
 let previous=null;
 for(const b of bars){
   if(!b||b.closed!==true||b.timeframe!==tf||!str(b.sourceBarId)||seen.has(b.sourceBarId)||
     !utc(b.sourceTimestamp)||b.sourceVendor!==manifest.sourceVendor||
     b.sourceSeriesId!==manifest.sourceSeriesId||b.sourceContract!==manifest.sourceContract||
     ![b.open,b.high,b.low,b.close].every(x=>typeof x==="number"&&Number.isFinite(x))||
     b.low<=0||b.high<b.low||b.open<b.low||b.open>b.high||b.close<b.low||b.close>b.high)
     return reject("INVALID_SOURCE_BAR_OR_LINEAGE");
   const t=Date.parse(b.sourceTimestamp);
   if(previous!==null && t-previous!==ms)
     return reject("GAP_DUPLICATE_OR_NONCONTIGUOUS_BAR");
   if(![b.open,b.high,b.low,b.close].every(x=>Math.abs(x*4-Math.round(x*4))<1e-8))
     return reject("ES_QUARTER_POINT_TICK_REQUIRED");
   seen.add(b.sourceBarId);previous=t;
 }
 if(!utc(manifest.capturedAtUTC)||Date.parse(manifest.capturedAtUTC)<previous)
   return reject("CAPTURE_TIME_PRECEDES_SOURCE");
 return {
   accepted:true,schema:ENGINE22_REPLAY_MANIFEST_SCHEMA,barCount:bars.length,
   sourceVendor:manifest.sourceVendor,datasetId:manifest.datasetId,datasetVersion:manifest.datasetVersion,
   sourceContract:manifest.sourceContract,priceBasis:manifest.priceBasis,sessionCalendar:manifest.sessionCalendar,
   firstBarId:bars[0].sourceBarId,lastBarId:bars.at(-1).sourceBarId,
   firstBarTime:bars[0].sourceTimestamp,lastBarTime:bars.at(-1).sourceTimestamp,
   reasonCodes:["METADATA_INTERNALLY_CONSISTENT_EXTERNAL_AUTHENTICATION_REQUIRED"],
   sourceDataVerified:false,independentlyAuthenticated:false,shadowOnly:true,
   noExecution:true,noPermissionCreated:true,
 };
}
