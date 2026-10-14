// Research-only deterministic replay of Engine22 Fibonacci touch memory.
// No file I/O, runtime import, permissions, or structural model creation.
import { reduceFibTouchObservationV1 } from "./reduceFibTouchesV1.js";

export function replayFibTouchHistoryV1({level, observations=[]}={}) {
  if (!Array.isArray(observations)) return {status:"UNAVAILABLE",reason:"OBSERVATIONS_NOT_ARRAY"};
  const ordered=[...observations].sort((a,b)=>{
    const ta=Date.parse(a?.sourceTimestamp||"");
    const tb=Date.parse(b?.sourceTimestamp||"");
    return (Number.isFinite(ta)?ta:Infinity)-(Number.isFinite(tb)?tb:Infinity) ||
      String(a?.sourceBarId||"").localeCompare(String(b?.sourceBarId||""));
  });
  let result=reduceFibTouchObservationV1({level});
  const seen=new Set();
  for(const bar of ordered){
    const dedupe=[bar?.seriesId,bar?.priceBasis,bar?.sourceBarId].join("|");
    if(seen.has(dedupe))continue;
    seen.add(dedupe);
    result=reduceFibTouchObservationV1({level,candle:bar,previous:result});
  }
  return {...result,evaluatedBars:seen.size};
}
