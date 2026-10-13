// Engine 2B historical chart candles: isolated read-only, explicit futures contract only.
// No root ES contract stitching, back-adjustment, trading actions, or changes to existing route.
import { Router } from "express";
const router=Router();
const TF={ "1m":"1min","5m":"5min","10m":"10min","15m":"15min","30m":"30min","1h":"1hour","4h":"4hour","1d":"1day" };
const KEY=process.env.POLYGON_API||process.env.POLYGON_API_KEY||process.env.POLY_API_KEY||"";
const BASE=process.env.POLYGON_REST_BASE||process.env.POLYGON_BASE_URL||"https://api.polygon.io";
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const CONTRACT=/^(?:ES|MES)[FGHJKMNQUVXZ]\d{1,2}$/;
function normal(b) {
 const raw=Number(b?.window_start);
 const time=raw>1e17?Math.floor(raw/1e9):raw>1e14?Math.floor(raw/1e6):raw>1e12?Math.floor(raw/1000):raw;
 const open=Number(b?.open),high=Number(b?.high),low=Number(b?.low),close=Number(b?.close);
 if(![time,open,high,low,close].every(Number.isFinite))return null;
 return {time,open,high,low,close,volume:Number(b?.volume)||0};
}
export function validateHistoryQuery(q) {
 const symbol=String(q.symbol||"").toUpperCase(),tf=String(q.timeframe||"").toLowerCase();
 const from=String(q.from||""),to=String(q.to||"");
 const limit=Number(q.limit||2500);
 if(!CONTRACT.test(symbol))return {error:"EXPLICIT_CONTRACT_REQUIRED"};
 if(!TF[tf])return {error:"UNSUPPORTED_TIMEFRAME"};
 if(!ISO.test(from)||!ISO.test(to)||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||from>to)return {error:"INVALID_DATE_RANGE"};
 if((Date.parse(to)-Date.parse(from))/86400000>31)return {error:"MAX_31_DAYS_PER_REQUEST"};
 if(!Number.isInteger(limit)||limit<1||limit>5000)return {error:"LIMIT_OUT_OF_RANGE"};
 return {symbol,tf,from,to,limit};
}
router.get("/",async(req,res)=>{
 const p=validateHistoryQuery(req.query);
 if(p.error)return res.status(400).json({ok:false,error:p.error});
 if(!KEY)return res.status(503).json({ok:false,error:"FUTURES_PROVIDER_NOT_CONFIGURED"});
 const ticker=p.symbol.replace(/(\d)(\d)$/,(m,a,b)=>b);
 const url=new URL(String(BASE).replace(/\/+$/,"")+"/futures/v1/aggs/"+encodeURIComponent(ticker));
 url.searchParams.set("resolution",TF[p.tf]);
 url.searchParams.set("window_start.gte",p.from);
 url.searchParams.set("window_start.lte",p.to);
 url.searchParams.set("sort","asc");url.searchParams.set("limit","50000");url.searchParams.set("apiKey",KEY);
 try{
  const upstream=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:"application/json"}});
  if(!upstream.ok)return res.status(502).json({ok:false,error:"PROVIDER_ERROR",status:upstream.status});
  const data=await upstream.json();
  const raw=Array.isArray(data?.results)?data.results:[];
  const bars=raw.map(normal).filter(Boolean).sort((a,b)=>a.time-b.time);
  const filtered=bars.slice(0,p.limit);
  // No silent truncation: clients must page via explicit calendar dates or smaller windows.
  res.setHeader("Cache-Control","private, max-age=60");
  return res.json({ok:true,schemaVersion:"engine2b.futuresHistory.v1",requestedContract:p.symbol,providerContract:ticker,
   priceBasis:"UNADJUSTED_CONTRACT",timeframe:p.tf,from:p.from,to:p.to,
   truncated:bars.length>p.limit||raw.length>=50000,count:filtered.length,bars:filtered});
 }catch(e){return res.status(503).json({ok:false,error:"HISTORY_SOURCE_UNAVAILABLE"});}
});
export default router;
