// Read-only price basis sanity check. Candidate contract matches are NOT source identity.
const key=process.env.POLYGON_API_KEY||process.env.POLY_KEY||"";
if(!key){console.log("ANCHOR_CONTRACT_SANITY_SKIPPED");process.exit(0);}
const examples=[
 {degree:"minor",wave:"W1",price:6948.75,time:"2026-04-10T15:00:00Z",contract:"ESM6"},
 {degree:"minor",wave:"W3",price:7694.25,time:"2026-06-03T02:00:00Z",contract:"ESM6"},
 {degree:"minor",wave:"W4",price:7398,time:"2026-07-29T20:30:00Z",contract:"ESU6"},
 {degree:"minute",wave:"A",price:7707.25,time:"2026-09-24T21:30:00Z",contract:"ESZ6"},
 {degree:"minute",wave:"B",price:7810.75,time:"2026-09-25T17:00:00Z",contract:"ESZ6"}
];
const memo=new Map();
async function getBars(contract,date){
 const k=contract+":"+date;if(memo.has(k))return memo.get(k);
 const u=new URL("https://api.polygon.io/futures/v1/aggs/"+contract);
 const nextDay=new Date(Date.parse(date+"T00:00:00Z")+86400000).toISOString().slice(0,10);
 for(const [k,v] of Object.entries({resolution:"10min","window_start.gte":date,"window_start.lte":nextDay,sort:"asc",limit:"50000",apiKey:key}))u.searchParams.set(k,v);
 const r=await fetch(u,{signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(contract+" HTTP "+r.status);
 const d=await r.json();const bars=(d.results||[]).map(b=>({time:Number(b.window_start)/1e9,low:Number(b.low),high:Number(b.high)}));
 memo.set(k,bars);return bars;
}
for(const x of examples){
 const date=x.time.slice(0,10),bars=await getBars(x.contract,date),t=Date.parse(x.time)/1000;
 const near=bars.filter(b=>Math.abs(b.time-t)<=3600);
 const direct=bars.filter(b=>Math.abs(b.time-t)<=600);
 const contains=direct.some(b=>b.low<=x.price&&x.price<=b.high);
 const nearest=near.reduce((best,b)=>best==null||Math.abs(b.time-t)<Math.abs(best.time-t)?b:best,null);
 console.log("ANCHOR_CONTRACT_SANITY",JSON.stringify({degree:x.degree,wave:x.wave,contract:x.contract,date,
  bars:bars.length,minutePrecisionTimestamp:x.time,exactNearbyBarCount:direct.length,
  containedInNearbyHighLow:contains,
  nearestOffsetSeconds:nearest?Math.abs(nearest.time-t):null,
  nearestCandleRange:nearest?{low:nearest.low,high:nearest.high}:null,
  approvedSourceCandleIdentityVerified:false}));
}
