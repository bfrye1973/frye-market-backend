// Isolated preview runtime for Engine27 V3 Micro only.
// No production jobs, no order APIs, no Engine22/Engine10 writes.
// Required: ENGINE27_V3_SHADOW_USERNAME, ENGINE27_V3_SHADOW_PASSWORD,
// ENGINE27_V3_TRADE_READ_TOKEN, ENGINE27_V3_SNAPSHOT_URL, POLYGON_API_KEY.
import express from "express";
import crypto from "node:crypto";
import {microShadowHtml} from "./microShadowView.js";
import tradeRouter,{getEngine27V3TradeDiagnostics} from "../routes/engine27V3TradeStream.js";
import {createTradeIngestionRunner} from "../../core/logic/engine27/v3/livePriceObserver/createTradeIngestionRunner.js";
import {assembleSnapshotMarketSources} from "../../core/logic/engine27/v3/marketConfirmation/assembleSnapshotMarketSources.js";
const app=express();app.disable("x-powered-by");app.set("etag",false);
const PORT=Number(process.env.PORT)||10000;
const USER=process.env.ENGINE27_V3_SHADOW_USERNAME||"";
const PASS=process.env.ENGINE27_V3_SHADOW_PASSWORD||"";
const READ_TOKEN=process.env.ENGINE27_V3_TRADE_READ_TOKEN||"";
const SNAP_URL=process.env.ENGINE27_V3_SNAPSHOT_URL||"";
const TRADE_URL=process.env.ENGINE27_V3_TRADE_URL||"";
const enabled=process.env.ENGINE27_V3_SHADOW_ENABLED==="true";
let snapshot=null,snapshotAt=null,latest=null,sourceStatus="UNAVAILABLE",lastError=null;
let retryRunner=null;
let reportedMarketSourceStates=false;
const equal=(a,b)=>{const A=Buffer.from(a),B=Buffer.from(b);return A.length===B.length&&crypto.timingSafeEqual(A,B)};
const auth=(req,res,next)=>{
 if(!USER||!PASS)return res.status(503).send("Shadow authentication not configured");
 const auth=req.get("authorization")||"";
 if(!auth.startsWith("Basic "))return challenge(res);
 let pair;try{pair=Buffer.from(auth.slice(6),"base64").toString("utf8")}catch{return challenge(res)}
 const pos=pair.indexOf(":");
 if(pos<0||!equal(pair.slice(0,pos),USER)||!equal(pair.slice(pos+1),PASS))return challenge(res);
 next();
};
function challenge(res){res.set("WWW-Authenticate",'Basic realm="Engine27 Micro V3 Shadow"');res.set("Cache-Control","no-store");return res.status(401).send("Authorization required")}
app.get("/healthz",(_req,res)=>res.json({ok:true,service:"engine27-v3-micro-shadow",enabled}));
app.get("/",auth,(_req,res)=>{res.set("Cache-Control","no-store");res.type("html").send(microShadowHtml)});
app.get("/shadow/state",auth,(_req,res)=>{
 res.set("Cache-Control","no-store");
 const owner=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.currentWavelength?.degrees?.micro?.ownerMicroCDown??null;
 const feed=retryRunner?.status()??null;
 const observation=feed?.status==="LIVE"&&feed.previousObservation?.available?feed.previousObservation:null;
 // Avoid exposing snapshots, journal records, broker identifiers or provider secrets.
 const m=latest;
 res.json({schema:"engine27.v3.microShadowDisplay.v1",mode:"SHADOW_NOT_TRADING",
  updatedAt:new Date().toISOString(),feed:{status:feed?.status??"UNAVAILABLE",contract:feed?.contract??null,diagnostics:getEngine27V3TradeDiagnostics(),consumerReasonCodes:feed?.reasonCodes??[]},
  observation:observation?{available:true,currentPrice:observation.currentPrice,lastTradeAt:observation.lastTradeAt,
    provisionalTouches:observation.provisionalTouches,nextProvisionalReference:observation.nextProvisionalReference}:null,
  owner:owner?{activeWave:owner.activeWave,direction:owner.direction,confirmationStatus:owner.confirmationStatus,stage:owner.stage}:null,
  snapshotStatus:snapshot&&snapshotAt&&Date.now()-Date.parse(snapshotAt)<60000?"FRESH":"UNAVAILABLE",
  micro:m?{modules:{
    marketConfirmation:{sources:Object.fromEntries(["engine25","engine29","qqq","vix"].map(k=>[k,{state:m.modules?.marketConfirmation?.sources?.[k]?.state??"UNAVAILABLE"}]))},
    neighboringAlignment:{state:m.modules?.neighboringAlignment?.state,neighbors:{
      submicro:{direction:m.modules?.neighboringAlignment?.neighbors?.submicro?.direction??null},
      subminute:{direction:m.modules?.neighboringAlignment?.neighbors?.subminute?.direction??null}}},
    positionIntelligence:{available:m.modules?.positionIntelligence?.available===true},
    entryThesisMemory:{positions:(m.modules?.entryThesisMemory?.positions??[]).map(x=>({state:x.state??"ENTRY_STRUCTURE_UNAVAILABLE"}))}
   },positionAssessment:{openContractCount:m.positionAssessment?.openContractCount??null}}:null,
  noExecution:true});
});
app.use("/stream/futures/trades-v3",tradeRouter);
async function refreshSnapshot(){
 if(!SNAP_URL)return;
 try{
  const url=new URL(SNAP_URL);
  if(url.protocol!=="https:"||!url.pathname.includes("dashboard-snapshot"))throw Error("SNAPSHOT_ENDPOINT_UNVERIFIED");
  const r=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{Accept:"application/json"}});
  if(!r.ok)throw Error("SNAPSHOT_HTTP_UNAVAILABLE");
  const j=await r.json();
  if(j?.symbol!=="ES")throw Error("NOT_ES_SNAPSHOT");
  snapshot=j;snapshotAt=new Date().toISOString();sourceStatus="AVAILABLE";lastError=null;
 }catch{sourceStatus="UNAVAILABLE";lastError="CANONICAL_ES_SNAPSHOT_UNAVAILABLE"}
}
const server=app.listen(PORT,"0.0.0.0",()=>{
 console.log("[engine27-v3-shadow] Listening, shadow="+enabled+"; no trading authority");
});
if(enabled){
 await refreshSnapshot();
 setInterval(()=>{void refreshSnapshot()},15000).unref();
 if(READ_TOKEN&&SNAP_URL&&TRADE_URL){
  retryRunner=createTradeIngestionRunner({
   url:TRADE_URL,
   token:READ_TOKEN,
   readInputs:()=>({snapshot,...assembleSnapshotMarketSources(snapshot)}),
   onObservation:m=>{latest=m;
    if(!reportedMarketSourceStates){
      reportedMarketSourceStates=true;
      const states=m?.modules?.marketConfirmation?.sources??{};
      console.info("[engine27-v3-market-source-acceptance] "+JSON.stringify({
        engine25:{state:states.engine25?.state??"UNAVAILABLE",availability:states.engine25?.availability??"UNAVAILABLE",reasonCodes:states.engine25?.reasonCodes??[]},
        engine29:{state:states.engine29?.state??"UNAVAILABLE",availability:states.engine29?.availability??"UNAVAILABLE",reasonCodes:states.engine29?.reasonCodes??[]},
        qqq:{state:states.qqq?.state??"UNAVAILABLE",availability:states.qqq?.availability??"UNAVAILABLE",reasonCodes:states.qqq?.reasonCodes??[]},
        vix:{state:states.vix?.state??"UNAVAILABLE",availability:states.vix?.availability??"UNAVAILABLE",reasonCodes:states.vix?.reasonCodes??[]},
        esZones:{state:states.esZones?.state??"UNAVAILABLE",availability:states.esZones?.availability??"UNAVAILABLE"}
      }));
    }
  }
  });
  void retryRunner.run();
 }
}
export {app,server};
