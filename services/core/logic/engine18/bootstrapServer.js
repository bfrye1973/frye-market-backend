import {startEngine18IronbeamLevel2Monitor} from "./ironbeamV2Level2Monitor.js";
import {probeIronbeamV2DemoStream} from "./ironbeamV2DemoStreamProbe.js";
import { probeIronbeamV2Demo } from "./ironbeamV2DemoProbe.js";
// Engine 18 isolated Render bootstrap. No external data connections or execution.
// The API key is injected only through Render's protected Environment settings.
// No secret values are ever returned or logged here.
import http from "node:http";
const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("ENGINE18_INVALID_PORT");
let ironbeamLevel2Monitor=null;
let ironbeamLevel2Status={state:"DISABLED",mode:"DEMO_RESEARCH",tradingEnabled:false};
if(process.env.ENGINE18_IRONBEAM_LEVEL2_MONITOR==="1"){
 try{
   ironbeamLevel2Monitor=startEngine18IronbeamLevel2Monitor({
     username:process.env.IRONBEAM_DEMO_USERNAME,
     password:process.env.IRONBEAM_DEMO_PASSWORD,
     apikey:process.env.IRONBEAM_DEMO_API_KEY,
     onStatus:s=>{ironbeamLevel2Status=s;}
   });
   console.log("Engine 18 isolated demo Level 2 monitor started; no trading");
 }catch{
   ironbeamLevel2Status={state:"START_FAILED",mode:"DEMO_RESEARCH",tradingEnabled:false};
 }
}
let ironbeamDemoStreamTest={status:"NOT_STARTED",readOnly:true};
if(process.env.ENGINE18_IRONBEAM_DEMO_PROBE==="1" && process.env.ENGINE18_IRONBEAM_LEVEL2_MONITOR!=="1"){
 ironbeamDemoStreamTest={status:"IN_PROGRESS",readOnly:true};
 probeIronbeamV2DemoStream({username:process.env.IRONBEAM_DEMO_USERNAME,password:process.env.IRONBEAM_DEMO_PASSWORD,apikey:process.env.IRONBEAM_DEMO_API_KEY})
 .then(result=>{
  ironbeamDemoStreamTest={...result,status:result.marketDataObserved?"MARKET_DATA_OBSERVED":result.websocketOpened?"STREAM_OPEN_NO_MARKET_DATA":"FAILED"};
  console.log("Engine 18 Ironbeam streaming probe:",JSON.stringify(ironbeamDemoStreamTest));
 }).catch(()=>{ironbeamDemoStreamTest={status:"FAILED",reason:"PROBE_EXCEPTION",readOnly:true};console.log("Engine 18 Ironbeam streaming probe: PROBE_EXCEPTION");});
}
let ironbeamDemoTest={status:"NOT_STARTED",readOnly:true};
if(process.env.ENGINE18_IRONBEAM_DEMO_PROBE==="1") {
  ironbeamDemoTest={status:"IN_PROGRESS",readOnly:true};
  probeIronbeamV2Demo({
    username:process.env.IRONBEAM_DEMO_USERNAME,
    password:process.env.IRONBEAM_DEMO_PASSWORD,
    apikey:process.env.IRONBEAM_DEMO_API_KEY
  }).then(result=>{
    ironbeamDemoTest={
      status:result.connected?"AUTHENTICATED":"FAILED",
      phase:result.phase,checks:result.checks||{},
      liveEntitlementConfirmed:false,mboConfirmed:false,readOnly:true
    };
    console.log("Engine 18 Ironbeam demo probe completed:",JSON.stringify(ironbeamDemoTest));
  }).catch(()=>{ironbeamDemoTest={status:"FAILED",phase:"INTERNAL",readOnly:true};});
}
const service = http.createServer((req,res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET" || !["/health","/"].includes(pathname)) {
    res.writeHead(404);
    res.end(JSON.stringify({ok:false,error:"NOT_FOUND"}));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({
    ok:true,
    service:"engine18-liquidity-intelligence",
    mode:ironbeamLevel2Status.state==="DISABLED"?"ISOLATED_BOOTSTRAP":"DEMO_LEVEL2_RESEARCH",
    tradingEnabled:false,
    liveMarketDataConnected:Boolean(ironbeamLevel2Status.connected),
    ironbeamDemoTest,
    // Public health never redistributes actual prices, sizes, or raw market packets.
    ironbeamDemoStreamTest: {status:ironbeamDemoStreamTest.status,readOnly:true},
    ironbeamLevel2Status,
    apiKeyConfigured:typeof process.env.DATABENTO_API_KEY==="string" &&
      process.env.DATABENTO_API_KEY.trim().length>0
  }));
});
service.listen(port,"0.0.0.0",()=>console.log("Engine 18 isolated bootstrap listening; no market-data collection or trading enabled"));
