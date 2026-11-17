// Preparation only: deterministic bounded raw-bar archive packet; NO disk writes.
// Engine12 owns canonical Replay and Engine12/18 own eventual recorder activation.
import {createHash} from "node:crypto";
import {deriveCandleCompletionTruth} from "../candleCompletionTruth.js";
const finite=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const iso=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?x:null;
function barsAsOf(bars,timeframe,evalMs,limit){
 const truth=deriveCandleCompletionTruth({bars,timeframe,evaluationTimeMs:evalMs});
 const dur=timeframe==="1m"?60000:timeframe==="5m"?300000:600000;
 const list=(truth.completedBars||[]).slice(-limit).map(b=>{
  const t=finite(Number(b?.time??b?.t??b?.tSec));
  const [open,high,low,close]=[b?.open,b?.high,b?.low,b?.close].map(v=>finite(Number(v)));
  return {startMs:t===null?null:t*1000,endMs:t===null?null:t*1000+dur,
   open,high,low,close};
 }).filter(b=>b.startMs!==null&&b.endMs<=evalMs&&
   [b.open,b.high,b.low,b.close].every(v=>v!==null)&&
   b.low<=b.open&&b.open<=b.high&&b.low<=b.close&&b.close<=b.high);
 return list;
}
export function buildEngine3RawBarArchivePacket({
 evaluationTimeMs=null,symbol="ES",strategyId="intraday_scalp@10m",
 bars1m=[],bars5m=[],bars10m=[],engine26=null,engine22=null,
 activation=null,maxBarsPerTf=200,maxBytes=500000,
}={}){
 const t=finite(evaluationTimeMs);
 const limit=Math.max(1,Math.min(2000,Math.floor(maxBarsPerTf)));
 if(t===null||symbol!=="ES"||strategyId!=="intraday_scalp@10m")
  return {ok:false,recordingActivated:false,reasonCode:"INVALID_ARCHIVE_CONTEXT"};
 const publication=engine22?.authorizedWorkingStructure??null;
 const publishedAt=iso(publication?.publishedAt);
 // A current publication must not be silently substituted into past Replay.
 const validPublication=publishedAt!==null&&Date.parse(publishedAt)<=t;
 const body={schema:"engine3.v6.rawBarPacket.preparation.v1",mode:"NOT_RECORDING",
  symbol,strategyId,evaluationTimeMs:t,
  engine26:{candidateId:engine26?.candidateId??null,zoneId:engine26?.zoneId??null,
   zone:engine26?.entryZone??null,
   engine3AuthorizationStartedAt:engine26?.engine3AuthorizationStartedAt??null,
   observedActivationStartedAtMs:activation?.activationStartedAtMs??null,
   activationSource:activation?.activationSource??"UNAVAILABLE"},
  engine22:validPublication?{schema:publication.schema,
   publishedAt,publicationRevision:publication.publicationRevision??null,
   modelFingerprint:publication.modelFingerprint??null,
   submicro:publication.degrees?.submicro??null,
   micro:publication.degrees?.micro??null}:null,
  engine22PublicationAsOfValid:validPublication,
  completedBars:{
   "1m":barsAsOf(bars1m,"1m",t,limit),
   "5m":barsAsOf(bars5m,"5m",t,limit),
   "10m":barsAsOf(bars10m,"10m",t,limit),
  }};
 const json=JSON.stringify(body);
 const byteSize=Buffer.byteLength(json,"utf8");
 const max=finite(maxBytes)??500000;
 if(byteSize>max)return {ok:false,recordingActivated:false,
  reasonCode:"ARCHIVE_PACKET_SIZE_LIMIT",byteSize,maxBytes:max};
 return {ok:true,recordingActivated:false,packet:body,
  sha256:createHash("sha256").update(json).digest("hex"),
  byteSize,dedupeKey:[symbol,strategyId,t].join("|"),
  reasonCode:"ARCHIVE_PACKET_PREPARED_NOT_RECORDED"};
}
export default buildEngine3RawBarArchivePacket;
