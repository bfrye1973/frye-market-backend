// Read-only provider coverage probe, no trades or data mutations; never logs API keys.
const key=process.env.POLYGON_API_KEY||process.env.POLY_KEY||"";
if(!key){console.log("HISTORICAL_COVERAGE_SKIPPED: provider credential unavailable");process.exit(0);}
const base="https://api.polygon.io";
const cases=[
 {ticker:"ESM6",from:"2026-04-09",to:"2026-04-13"},
 {ticker:"ESM6",from:"2026-06-01",to:"2026-06-04"},
 {ticker:"ESU6",from:"2026-07-27",to:"2026-07-30"},
 {ticker:"ESU6",from:"2026-09-22",to:"2026-09-26"},
 {ticker:"ESZ6",from:"2026-09-22",to:"2026-09-26"},
 {ticker:"ESU6",from:"2026-09-10",to:"2026-09-14"},
 {ticker:"ESZ6",from:"2026-09-10",to:"2026-09-14"},
 {ticker:"ESZ6",from:"2026-10-01",to:"2026-10-05"}
];
let failed=0;
for(const item of cases){
 const url=new URL(base+"/futures/v1/aggs/"+item.ticker);
 url.searchParams.set("resolution","10min");
 url.searchParams.set("window_start.gte",item.from);
 url.searchParams.set("window_start.lte",item.to);
 url.searchParams.set("sort","asc");url.searchParams.set("limit","50000");url.searchParams.set("apiKey",key);
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{Accept:"application/json"}});
  if(!r.ok){failed++;console.log("HISTORICAL_COVERAGE",JSON.stringify({...item,status:r.status,available:false}));continue;}
  const data=await r.json();
  const rows=Array.isArray(data?.results)?data.results:[];
  const stamp=v=>Number(v)>1e17?new Date(Number(v)/1e6).toISOString():null;
  console.log("HISTORICAL_COVERAGE",JSON.stringify({...item,status:r.status,count:rows.length,
   first:rows[0]?stamp(rows[0].window_start):null,
   last:rows.length?stamp(rows.at(-1).window_start):null,
   hasNextPage:!!data.next_url}));
 }catch(e){failed++;console.log("HISTORICAL_COVERAGE",JSON.stringify({...item,error:e.name||"request_failed"}));}
}
if(failed)process.exitCode=1;
