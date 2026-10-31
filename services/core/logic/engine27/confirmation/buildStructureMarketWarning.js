// Advisory-only Engine22/Engine25 comparison. No trade or wave authority.
export const WARNING_SCHEMA="engine27.structureMarketWarning.v1";
const degrees=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const validTime=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const bias=s=>["BULLISH","BULLISH_SELECTIVE"].includes(s)?"BULLISH":
 ["BEARISH","BEARISH_WARNING","STRONGLY_BEARISH"].includes(s)?"BEARISH":
 s==="MIXED"?"MIXED":null;
export function buildStructureMarketWarning({wavePublication,packet,degree="subminute",asOfUtc,mode="LIVE",maxAgeMs=15*60*1000}={}){
 const insufficient=(reason)=>({schema:WARNING_SCHEMA,advisoryOnly:true,state:"INSUFFICIENT_CONFIRMATION",
  headline:"MARKET CONFIRMATION UNAVAILABLE",reason,degree,provisional:true,tradeApproved:false});
 if(!degrees.includes(degree)||!validTime(asOfUtc))return insufficient("INVALID_CONTEXT");
 if(wavePublication?.schema!=="engine22.authorizedWorkingStructure.v1"||
    wavePublication?.status!=="COMPLETE_WORKING_SELECTION"||
    wavePublication?.mode!=="READ_ONLY"||wavePublication?.noExecution!==true||
    wavePublication?.noWaveTransition!==true)return insufficient("ENGINE22_PUBLICATION_UNVERIFIED");
 const wave=wavePublication.degrees?.[degree];
 if(!wave?.available||!["UP","DOWN","NEUTRAL"].includes(wave.direction))return insufficient("ENGINE22_DEGREE_UNAVAILABLE");
 if(packet?.schema!=="engine25.confirmationPacket.v1"||packet?.ok!==true||
    packet?.tradePermissionShadow?.score==null)return insufficient("ENGINE25_PACKET_UNAVAILABLE");
 const cutoff=Date.parse(asOfUtc),packetTime=packet.asOfUtc;
 if(!validTime(packetTime)||Date.parse(packetTime)>cutoff)return insufficient("ENGINE25_FUTURE_OR_UNKNOWN_TIMESTAMP");
 if(mode==="LIVE"&&(cutoff-Date.parse(packetTime)>maxAgeMs||packet.mode!=="LIVE"))return insufficient("ENGINE25_STALE_OR_NONLIVE");
 if(packet.sources?.fourHour?.completedBar?.completed!==true)return insufficient("ENGINE25_4H_INCOMPLETE");
 if(packet.tradePermissionShadow?.state==="INSUFFICIENT_DATA")return insufficient("ENGINE25_INSUFFICIENT_DATA");
 const sources=[packet.sources?.esMaster,packet.sources?.fourHour,packet.sources?.reconstructedEod];
 if(sources.some(s=>!validTime(s?.sourceTimestamp)||Date.parse(s.sourceTimestamp)>cutoff))return insufficient("ENGINE25_SOURCE_TIME_UNVERIFIED");
 if(mode==="LIVE"&&sources.some(s=>cutoff-Date.parse(s.sourceTimestamp)>maxAgeMs&&s!==packet.sources.reconstructedEod))return insufficient("ENGINE25_SOURCE_STALE");
 const reconstructed=mode!=="LIVE"||packet.mode==="HISTORICAL_REPLAY"||
    sources.some(s=>s?.provenance?.reconstructed===true);
 const market=bias(packet.tradePermissionShadow.directionalBias);
 if(!market)return insufficient("ENGINE25_BIAS_UNKNOWN");
 const direction=wave.direction;
 let state=market==="MIXED"||direction==="NEUTRAL"?"BULLISH_UNCONFIRMED":
  direction==="UP"?(market==="BULLISH"?"MARKET_SUPPORTS_UPSIDE_CANDIDATE":"STRUCTURE_MARKET_CONFLICT"):
  market==="BEARISH"?"MARKET_SUPPORTS_DOWNSIDE_CANDIDATE":"STRUCTURE_MARKET_CONFLICT";
 if(direction==="DOWN"&&market==="MIXED")state="DOWNSIDE_UNCONFIRMED";
 const lower=degrees.slice(0,degrees.indexOf(degree)).filter(d=>{
  const w=wavePublication.degrees?.[d];return w?.available===true&&
    ((direction==="UP"&&w.direction==="DOWN")||(direction==="DOWN"&&w.direction==="UP"));
 });
 const conflict=state==="STRUCTURE_MARKET_CONFLICT";
 return {schema:WARNING_SCHEMA,advisoryOnly:true,tradeApproved:false,degree,
  wave:{activeWave:wave.activeWave,direction,selectionStatus:wave.selectionStatus,
    stage:wave.stage??null,completionConfirmed:wave.completionConfirmed===true},
  market:{bias,score:packet.tradePermissionShadow.score},
  state,lowerDegreeConflicts:lower,
  headline:conflict?(lower.length?"BULLISH ELLIOTT WAVE — MARKET AND LOWER-DEGREE CONFLICT":
    direction==="UP"?"WARNING: HIGH-RISK LONG SETUP":"WARNING: STRUCTURE/MARKET CONFLICT"):
    state==="BULLISH_UNCONFIRMED"?"BULLISH ELLIOTT WAVE NOT CONFIRMED BY MARKET":state,
  explanation:conflict?"Developing Elliott Wave direction conflicts with independent market conditions.":
   "Market agreement does not confirm wave completion.",
  provenance:reconstructed?"RETROSPECTIVE_RESEARCH_NOT_ORIGINAL_WARNING":"CONTEMPORANEOUS_PACKET",
  asOfUtc,packetAsOfUtc:packetTime,provisional:true};
}
