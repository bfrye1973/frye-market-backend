import { buildWaveOpportunity } from "../logic/engine22/opportunity/buildWaveOpportunity.js";
const contexts = [
 ["W2_TO_W3", {activeSetup:"W2_TO_W3",activeTradingDegree:"minute"}],
 ["W4_TO_W5", {activeSetup:"W4_TO_W5",activeTradingDegree:"minute"}],
 ["W5_EXTENSION", {activeSetup:"W5_EXTENSION",activeTradingDegree:"minute"}],
];
for(const [label,partial] of contexts){
 const opts={symbol:"ES",strategyId:"intraday_scalp@10m",currentPrice:7840,
 engine22WaveStrategy:{...partial,activeTradingDegree:"minute",chaseRisk:"LOW",
 waveFibState:{activeSetup:partial.activeSetup,activeTradingDegree:"minute",
 degrees:{minute:{direction:"UP",phase:"IN_W2",timing:"EARLY",w4Levels:{w4Low:7770,w3High:7860},fibPressure:{chaseRisk:"LOW"}}}}},
 engine25Context:{ok:true,freshnessStatus:"FRESH",score:82,regime:"CONSTRUCTIVE"},
 marketRegime:{directionBias:"LONG",strictness:"MEDIUM"}};
 const runs=[["ready",{readiness:"READY"}],["missing",null],["not_ready",{readiness:"WAIT"}]];
 for(const [condition,e16] of runs){
  try{const o=buildWaveOpportunity({...opts,engine16:e16});console.log("E22_OPPORTUNITY_ISOLATION="+JSON.stringify({label,condition,setup:o.setupType,readiness:o.readiness,timing:o.timing,reasonCodes:o.armingReasonCodes,supportive:o.supportiveContext,blocked:o.reclaimContext?.reclaimBlockedReasonCodes}));}
  catch(e){console.log("E22_OPPORTUNITY_ISOLATION_ERROR="+JSON.stringify({label,condition,error:String(e.message)}));process.exitCode=2;}
 }
}
