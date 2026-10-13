// Read-only exact overlap comparison; prices are unadjusted, no stitching.
const key=process.env.POLYGON_API_KEY||process.env.POLY_KEY||"";
if(!key){console.log("ROLLOVER_PARITY_SKIPPED credentials unavailable");process.exit(0);}
async function bars(ticker,from,to){
 const u=new URL("https://api.polygon.io/futures/v1/aggs/"+ticker);
 for(const [k,v] of Object.entries({resolution:"10min","window_start.gte":from,"window_start.lte":to,sort:"asc",limit:"50000",apiKey:key}))u.searchParams.set(k,v);
 const r=await fetch(u,{signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(ticker+" HTTP "+r.status);
 const d=await r.json();return (d.results||[]).map(x=>({t:String(x.window_start),close:Number(x.close)}));
}
const from="2026-09-10",to="2026-09-14";
const [u,z]=await Promise.all([bars("ESU6",from,to),bars("ESZ6",from,to)]);
const um=new Map(u.map(x=>[x.t,x.close]));
const common=z.filter(x=>um.has(x.t)).map(x=>({timestamp:x.t,older:um.get(x.t),newer:x.close,difference:x.close-um.get(x.t)}));
const nonzero=common.filter(x=>Math.abs(x.difference)>0.01);
const differences=common.map(x=>x.difference).sort((a,b)=>a-b);
console.log("ROLLOVER_PRICE_PARITY",JSON.stringify({older:"ESU6",newer:"ESZ6",from,to,olderBars:u.length,newerBars:z.length,
 identicalTimestampCount:common.length,nonzeroDifferenceCount:nonzero.length,
 minimumDifference:differences[0]??null,maximumDifference:differences.at(-1)??null,
 medianDifference:differences[Math.floor(differences.length/2)]??null,
 examples:common.slice(0,5)}));
if(!common.length)process.exitCode=1;
