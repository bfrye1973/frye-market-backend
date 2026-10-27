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
import {assembleCanonicalOwnerMarket} from "../../core/logic/engine27/v3/marketConfirmation/assembleCanonicalOwnerMarket.js";
import {projectMarketEvidenceForDisplay} from "../../core/logic/engine27/v3/marketConfirmation/projectMarketEvidenceForDisplay.js";
import {projectEngine29Micro} from "../../core/logic/engine27/v3/marketConfirmation/projectEngine29Micro.js";
import {projectSnapshotMicroAccount} from "../../core/logic/engine27/v3/positionIntelligence/projectSnapshotMicroAccount.js";
import {projectQqqVixStatus} from "../../core/logic/engine27/v3/marketConfirmation/projectQqqVixStatus.js";
import {createSharedCrossMarketConsumer} from "./createSharedCrossMarketConsumer.js";
import {createMicroCrossMarketAlignment} from "../../core/logic/engine27/v3/marketAlignment/createMicroCrossMarketAlignment.js";
import {createMicroAlignmentAlertGate} from "../../core/logic/engine27/v3/marketAlignment/createMicroAlignmentAlertGate.js";
import {createMicroAlignmentArchiveClient} from "./createMicroAlignmentArchiveClient.js";
import {auditReplayAvailability} from "../../core/logic/engine27/v3/probability/auditReplayAvailability.js";
import {observeLiveCrossMarketZones,projectLiveCrossMarketZonesForDisplay} from "../../core/logic/engine27/v3/livePriceObserver/evaluateLiveCrossMarketZones.js";
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
const alignmentArchive=createMicroAlignmentArchiveClient({
 url:"https://frye-market-backend-1.onrender.com/api/v1/engine27/micro-alignment/history",
 token:process.env.ENGINE27_MICRO_ALIGNMENT_ARCHIVE_TOKEN
});
const alignmentAlertGate=createMicroAlignmentAlertGate();
const alignmentObserver=createMicroCrossMarketAlignment({
 onFiveMinuteEvent:row=>{alignmentArchive.enqueue(row);alignmentAlertGate.observe(row)}
});
const zonesState={QQQ:null,VIX:null};
const zonesEventCount={QQQ:0,VIX:0};
const zoneEventLastSeen={QQQ:new Map(),VIX:new Map()};
const DISTINCT_ZONE_EVENT_WINDOW_MS=60000;
const crossObserver=createSharedCrossMarketConsumer({
 baseUrl:process.env.ENGINE27_SHARED_MARKET_RELAY_URL,
 token:process.env.ENGINE27_SHARED_MARKET_READ_TOKEN,enabled,
 onTick:tick=>{
  const key=tick.symbol;
  alignmentObserver.ingest(key,tick.price,tick.sourceMs);
  const previous=zonesState[key]?.previous??null;
  const result=observeLiveCrossMarketZones({
    publication:snapshot?.engine27Strategies?.engine27CrossMarketLevels,
    key,tick,previous,nowMs:Date.now()
  });
  zonesState[key]=result;
  if(result.available){
   // Display one transition per zone+kind within a minute; raw tick
   // oscillations must not appear as dozens of independent major events.
   for(const event of result.observedEvents){
    const identity=event.zoneId+"|"+event.type;
    const at=tick.sourceMs;
    const last=zoneEventLastSeen[key].get(identity)??null;
    if(last===null||at-last>=DISTINCT_ZONE_EVENT_WINDOW_MS){
     zonesEventCount[key]++;
     zoneEventLastSeen[key].set(identity,at);
    }
   }
   // Bounded memory: each source has at most 12 zones, 3 transition kinds.
   if(zoneEventLastSeen[key].size>36)zoneEventLastSeen[key].clear();
  }
 }
});
let reportedMarketSourceStates=false;
let reportedCanonicalOwnerSources=false;
let ownerMarket={engine25:null,engine29:null,participationState:{state:"UNAVAILABLE",liveConfirmationUsable:false,contextOnly:false},reasonCodes:["CANONICAL_OWNER_CONTEXT_NOT_LOADED"]};
let displayEvidence=projectMarketEvidenceForDisplay({ownerMarket});
let engine29MicroDisplay=projectEngine29Micro();
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
  participation:{state:ownerMarket.participationState.state,contextOnly:ownerMarket.participationState.contextOnly,liveConfirmationUsable:ownerMarket.participationState.liveConfirmationUsable,reason:ownerMarket.participationState.reason??null},
  ownerSourceReasons:ownerMarket.reasonCodes.slice(0,8),
  marketEvidence:displayEvidence,
  engine29MicroDisplay,
  liveCrossMarket:crossObserver.status(),
  microCrossMarketAlignment:alignmentObserver.assess({
   microDirection:owner?.direction??null,
   neighbors:m?.modules?.neighboringAlignment?.neighbors??null,
   engine25Qualified:ownerMarket.participationState?.liveConfirmationUsable===true,
   engine29Qualified:!!ownerMarket.engine29,
   esConnected:feed?.status==="LIVE",
   qqqConnected:crossObserver.status().QQQ?.connectionState==="CONNECTED",
   vixConnected:crossObserver.status().VIX?.connectionState==="CONNECTED"
  }),
  microCrossMarketHistory:alignmentArchive.status(),
  microAlignmentAlerts:alignmentAlertGate.status(),

  liveCrossMarketZones:Object.fromEntries(["QQQ","VIX"].map(key=>{
   const feedStatus=crossObserver.status()[key];
   const safe=feedStatus?.available===true;
   return [key,safe?{
    ...projectLiveCrossMarketZonesForDisplay(zonesState[key]),
    observedEventsTotal:zonesEventCount[key]
   }:{
    available:false,state:feedStatus?.state??"SOURCE_UNAVAILABLE",
    reasonCodes:[feedStatus?.reason??"LIVE_SOURCE_NOT_QUALIFIED"],
    nearest:null,events:[],observedEventsTotal:null,noExecution:true
   }];
  })),
  engine10MicroAccount:projectSnapshotMicroAccount(snapshot),
  qqqVix:projectQqqVixStatus(m?.modules?.marketConfirmation, snapshot?.engine27Strategies?.engine27CrossMarketLevels,snapshot?.engine27Strategies?.engine27LiveCrossMarketReactions),
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
async function refreshCanonicalOwners(){
 // Dedicated read-only production endpoints; NEVER call refresh/update routes.
 if(!SNAP_URL)return;
 try{
  const root=new URL(SNAP_URL);
  if(root.origin!=="https://frye-market-backend-1.onrender.com")throw Error("OWNER_ORIGIN_NOT_ALLOWED");
  const get=async route=>{
   const response=await fetch(root.origin+route,{signal:AbortSignal.timeout(12000),
    headers:{Accept:"application/json"},cache:"no-store"});
   if(!response.ok)throw Error("CANONICAL_SOURCE_HTTP_UNAVAILABLE");
   return response.json();
  };
  const [e25,e29]=await Promise.allSettled([
    get("/api/v1/engine25/full-dashboard"),
    get("/api/v1/engine29/cross-market-stress")
  ]);
  if(!reportedCanonicalOwnerSources){
    reportedCanonicalOwnerSources=true;
    const e25Data=e25.status==="fulfilled"?e25.value:null;
    const e29Data=e29.status==="fulfilled"?e29.value:null;
    console.info("[engine27-v3-owner-source-audit] "+JSON.stringify({
      engine25Transport:e25.status,engine25Error:e25.status==="rejected"?"CANONICAL_HTTP_READ_FAILED":null,
      engine25EnvelopeKeys:e25Data&&typeof e25Data==="object"?Object.keys(e25Data).slice(0,30):[],
      participationSchema:e25Data?.participationArtifact?.schema??null,
      participationOwner:e25Data?.participationArtifact?.authority?.owner??null,
      participationFreshness:e25Data?.participationArtifact?.freshness?.state??null,
      contextAvailable:e25Data?.engine25Context?.ok??null,
      engine29Transport:e29.status,engine29Error:e29.status==="rejected"?"CANONICAL_HTTP_READ_FAILED":null,
      engine29EnvelopeKeys:e29Data&&typeof e29Data==="object"?Object.keys(e29Data).slice(0,15):[],
      engine29Version:e29Data?.data?.version??null,engine29StatePresent:typeof e29Data?.data?.overallState==="string",
      engine29TimestampPresent:typeof e29Data?.data?.timestamp==="string",
      engine29Degraded:e29Data?.data?.dataDegraded??null
    }));
  }
  ownerMarket=assembleCanonicalOwnerMarket({
   engine25Dashboard:e25.status==="fulfilled"?e25.value:null,
   engine29Response:e29.status==="fulfilled"?e29.value:null,
   now:new Date().toISOString()
  });
  if(e25.status==="rejected")ownerMarket.reasonCodes.push("ENGINE25_DIRECT_ENDPOINT_UNAVAILABLE");
  if(e29.status==="rejected")ownerMarket.reasonCodes.push("ENGINE29_DIRECT_ENDPOINT_UNAVAILABLE");
  displayEvidence=projectMarketEvidenceForDisplay({engine25Dashboard:e25.status==="fulfilled"?e25.value:null,
   engine29Response:e29.status==="fulfilled"?e29.value:null,ownerMarket});
  engine29MicroDisplay=projectEngine29Micro(e29.status==="fulfilled"?e29.value:null,!!ownerMarket.engine29);
 }catch{
  ownerMarket=assembleCanonicalOwnerMarket({now:new Date().toISOString()});
  ownerMarket.reasonCodes.push("OWNER_READ_ONLY_TRANSPORT_UNAVAILABLE");
  displayEvidence=projectMarketEvidenceForDisplay({ownerMarket});
  engine29MicroDisplay=projectEngine29Micro();
 }
}
const server=app.listen(PORT,"0.0.0.0",()=>{
 console.log("[engine27-v3-shadow] Listening, shadow="+enabled+"; no trading authority");
});
if(enabled){
 // One bounded, sanitized read-only historical availability probe per preview startup.
 void auditReplayAvailability().then(report=>console.info("[engine27-v3-probability-replay-audit] "+JSON.stringify(report)));
 crossObserver.start();
 void alignmentArchive.refresh().then(result=>{
  console.info("[engine27-v3-micro-alignment-archive-acceptance] "+JSON.stringify({reachable:result.ok,state:result.state}));
 });
 setInterval(()=>{void alignmentArchive.flush();void alignmentArchive.refresh()},30000).unref();
 // Single sanitized entitlement acceptance report: no price, broker, API key or raw event.
 setTimeout(()=>{
  const checks=crossObserver.status();
  console.info("[engine27-v3-live-cross-market-acceptance] "+JSON.stringify(
   Object.fromEntries(["QQQ","VIX"].map(k=>[k,{
    state:checks[k]?.state??"UNAVAILABLE",
    source:checks[k]?.source??null,
    available:checks[k]?.available===true,
    reason:checks[k]?.reason??null
   }]))
  ));
 },18000).unref();
 await refreshSnapshot();
 await refreshCanonicalOwners();
 setInterval(()=>{void refreshSnapshot()},15000).unref();
 setInterval(()=>{void refreshCanonicalOwners()},30000).unref();
 if(READ_TOKEN&&SNAP_URL&&TRADE_URL){
  retryRunner=createTradeIngestionRunner({
   url:TRADE_URL,
   token:READ_TOKEN,
   readInputs:()=>{
      const canonical=assembleSnapshotMarketSources(snapshot);
      // ES REGIME may be independently published in the canonical ES snapshot.
      // Never confuse that context with E25 scanner participation confirmation.
      const selectedRegime=ownerMarket.engine25??canonical.engine25;
      return {snapshot,...canonical,engine25:selectedRegime,engine29:ownerMarket.engine29};
    },
   onAcceptedTrade:event=>{
    if(event?.type==="trade"&&event?.source==="POLYGON_DIRECT_ES_TRADE"&&
      event?.symbol==="ES"&&Number.isFinite(event.price)&&event.tradeTime)
      alignmentObserver.ingest("ES",event.price,event.tradeTime);
   },
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
