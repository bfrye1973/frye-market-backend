// Engine 22-only read of completed 5m candles. This does NOT depend on
// Engine 3 reaction decisions; the shared source is raw ES 5m OHLC.
// Engine 22 independently classifies five-minute candle completion.
function completedFiveMinuteBars(bars, evaluationTimeMs) {
  const now = Number(evaluationTimeMs);
  if (!Number.isFinite(now) || now <= 0 || !Array.isArray(bars)) return [];
  return bars.filter(bar => {
    const start = tSec(bar);
    return start != null && start * 1000 + 300000 <= now;
  });
}
const positive = x => x == null || x === "" || !Number.isFinite(Number(x)) || Number(x) <= 0 ? null : Number(x);
const tSec = b => positive(b?.time ?? b?.t ?? b?.tSec);
function normalized(bar) {
  const time = tSec(bar), open = positive(bar?.open ?? bar?.o);
  const high = positive(bar?.high ?? bar?.h), low = positive(bar?.low ?? bar?.l);
  const close = positive(bar?.close ?? bar?.c);
  return [time,open,high,low,close].every(v=>v!=null) && high >= Math.max(open,close) &&
    low <= Math.min(open,close) ? {time,open,high,low,close} : null;
}
export function buildMicroFiveMinuteEvidence({bars = [], evaluationTimeMs = null,
  side = "HIGH", origin = 7782.75, prior = null} = {}) {
  const completed=completedFiveMinuteBars(bars,evaluationTimeMs)
    .map(normalized).filter(Boolean).sort((a,b)=>a.time-b.time);
  const unique=completed.filter((bar,i)=>i===0 || bar.time>completed[i-1].time);
  const previousTime=positive(prior?.lastObservedBarTime);
  // For an initial W1 observation, require the actual initiating low to be
  // present in the completed 5m series. Never borrow an older wave's highs.
  const anchorIndex=side==="HIGH" && previousTime == null
    ? unique.findLastIndex(b=>Math.abs(b.low-origin)<=0.25) : -1;
  if(side==="HIGH" && previousTime==null && anchorIndex<0)
    return {evidence:null,candidateAnchor:null,lastObservedBarTime:null,
      reasonCodes:["MICRO_START_LOW_NOT_IN_COMPLETED_FIVE_MIN_HISTORY"]};
  const startAfter=positive(prior?.startAfterTimestamp);
  const relevant=startAfter!=null ? unique.filter(b=>b.time>startAfter) :
    anchorIndex>=0 ? unique.slice(anchorIndex) : unique;
  const last=relevant.at(-1);
  if(relevant.length<5 || !last || previousTime != null && last.time<=previousTime)
    return {evidence:null, candidateAnchor:positive(prior?.candidateAnchor), lastObservedBarTime:last?.time ?? previousTime,
      reasonCodes:["AWAIT_NEW_COMPLETED_5M_CANDLES"]};
  const past=relevant.slice(0,-1);
  const selected=side==="HIGH" ? Math.max(...past.map(b=>b.high)) : Math.min(...past.map(b=>b.low));
  const priorAnchor=positive(prior?.candidateAnchor);
  const candidateAnchor=side==="HIGH" ? Math.max(origin,selected,priorAnchor||origin) :
    priorAnchor!=null ? Math.min(selected,priorAnchor) : selected;
  // A two-close shelf must be defined BEFORE either confirmation close.
  const priorThree=relevant.slice(0,-2).slice(-3);
  const pivot=side==="HIGH" ? Math.min(...priorThree.map(b=>b.low)) :
    Math.max(...priorThree.map(b=>b.high));
  const directionBreak=side==="HIGH" ? last.close<pivot : last.close>pivot;
  const rejected=side==="HIGH" ? last.high<candidateAnchor && last.close<last.open :
    last.low>candidateAnchor && last.close>last.open;
  const length=last.high-last.low;
  const bodyRatio=length>0 ? Math.abs(last.close-last.open)/length : 0;
  const two=relevant.slice(-2).every(b=>side==="HIGH" ? b.close<pivot : b.close>pivot);
  const reZone=side==="HIGH" ? true : positive(prior?.confirmedW1High) != null &&
    candidateAnchor>origin && candidateAnchor<prior.confirmedW1High &&
    ((prior.confirmedW1High-candidateAnchor)/(prior.confirmedW1High-origin))>=0.236;
  return {candidateAnchor,lastObservedBarTime:last.time,
    evidence: {timeframe:"5m",closed:true,sourceTimestamp:last.time,
      close:last.close,localPivot:pivot,anchorRejection:rejected,
      swingBreak:directionBreak,displacement:directionBreak && bodyRatio>=0.65,
      displacementQuality:bodyRatio>=0.65?"HIGH":"LOW",
      bodyToRange:bodyRatio,consecutiveClosesBeyondPivot:two?2:0,
      validRetracementReaction:reZone},
    reasonCodes:["COMPLETED_FIVE_MIN_CANDLE_OBSERVED"]};
}
