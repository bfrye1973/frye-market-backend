// Read-only historical availability probe. Prints counts and provenance status only.
// Never logs Replay payloads, prices, contracts, broker identifiers or secrets.
import {inspectMicroReplayFile} from "../logic/engine27/waveObservation/inspectOct26MicroHistory.js";
const origin="https://frye-market-backend-1.onrender.com";
const dates=["2026-10-26","2026-10-27","2026-10-28"];
async function get(url){
  const res=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw new Error("HTTP_"+res.status);
  return res.json();
}
for(const date of dates){
  try {
    const listing=await get(origin+"/api/v1/replay/es/times?date="+date);
    if(!Array.isArray(listing?.times))throw new Error("UNRECOGNIZED_LISTING");
    const times=listing.times.filter(t=>typeof t==="string" && /^\d{4}$/.test(t));
    const sampleTimes=[...new Set([times[0],times[Math.floor(times.length/2)],times.at(-1)].filter(Boolean))];
    const summary={date,availableFiles:times.length,sampled:0,canonical:0,
      originalMicroPublished:0,legacyMicroPresent:0,originalTimestampPresent:0,
      exactContractPresent:0,errors:[]};
    for(const time of sampleTimes){
      try {
        const result=await get(origin+"/api/v1/replay/es/snapshot?date="+date+"&time="+time);
        const value=result?.snapshot??result?.data??result;
        const record=inspectMicroReplayFile(JSON.stringify(value),{date,file:time+".json"});
        summary.sampled++;
        if(record.canonical)summary.canonical++;
        if(record.originalMicroPublished)summary.originalMicroPublished++;
        if(record.hasLegacyMicroState)summary.legacyMicroPresent++;
        if(record.originalTimeVerified)summary.originalTimestampPresent++;
        if(record.exactContractVerified)summary.exactContractPresent++;
      }catch(error){summary.errors.push("SAMPLE_"+String(error.message).slice(0,40))}
    }
    process.stdout.write(JSON.stringify(summary)+"\n");
  }catch(error){
    process.stdout.write(JSON.stringify({date,readOnly:true,status:"UNAVAILABLE",reason:String(error.message).slice(0,60)})+"\n");
  }
}
