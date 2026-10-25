// Engine 22: owner-approved higher-degree bearish early-warning observation.
// Read-only: these levels are NOT Elliott structural invalidations or trade stops.
const THRESHOLD = 7200;
const DEEP_WARNING = 6800;
const timeMs = value => {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
function completedCloses(bars, periodMs, evaluationMs) {
  if (!Array.isArray(bars) || !Number.isFinite(evaluationMs)) return [];
  const observed = new Map();
  for (const bar of bars) {
    const t = timeMs(bar?.time ?? bar?.timestamp ?? bar?.t);
    const close = Number(bar?.close ?? bar?.c);
    if (t === null || t > evaluationMs || !Number.isFinite(close) || close <= 0) continue;
    if (!(bar?.completed === true || bar?.isComplete === true || t + periodMs <= evaluationMs)) continue;
    observed.set(t, {time:t,close});
  }
  return [...observed.values()].sort((a,b)=>a.time-b.time);
}
function assess({degree,timeframe,periodMs,bars,evaluationMs,structuralReference}) {
  const closed = completedCloses(bars,periodMs,evaluationMs);
  const latest = closed.at(-1) ?? null;
  const previous = closed.at(-2) ?? null;
  // Never infer healthy conditions from a missing or stale source.
  const maxAge = periodMs * (timeframe === "1d" ? 5 : 3); // weekends permitted for daily, not indefinite staleness
  const fresh = Boolean(latest && evaluationMs - latest.time <= maxAge);
  const hasTwo = Boolean(previous && latest);
  let status = "UNCONFIRMED";
  if (fresh && latest) {
    if (latest.close < DEEP_WARNING) status = "HIGH_BEARISH_RISK";
    else if (latest.close < THRESHOLD && hasTwo && previous.close < THRESHOLD)
      status = degree === "primary" ? "MAJOR_BEARISH_RISK" : "BEARISH_RISK_CONFIRMED";
    else if (latest.close < THRESHOLD) status = "WARNING";
    else status = "BULLISH_STRUCTURE_ABOVE_WARNING";
  }
  return {
    degree,timeframe,warningLevel:THRESHOLD,deepRiskLevel:DEEP_WARNING,
    structuralReference,structuralReferenceStatus:"OWNER_AGREED_REVIEW_ONLY_PIVOT_QUALIFICATION_PENDING",
    status,latestCompletedClose:latest?.close ?? null,previousCompletedClose:previous?.close ?? null,
    latestCompletedBarTime:latest?new Date(latest.time).toISOString():null,
    completedBarsAvailable:closed.length,sourceFresh:fresh,
    evidence:!latest?"NO_COMPLETED_BAR":!fresh?"STALE_COMPLETED_BAR":!hasTwo?"ONE_COMPLETED_BAR_ONLY":"COMPLETED_CANDLE_CLOSES",
    rule:degree==="primary"?"DAILY_CLOSE_BELOW_7200_THEN_TWO_CONSECUTIVE_DAILY_CLOSES":
      "4H_CLOSE_BELOW_7200_THEN_TWO_CONSECUTIVE_4H_CLOSES",
    warningOnly:true,structuralInvalidated:false,noExecution:true,noPermissionCreated:true,
  };
}
export function buildHigherDegreeBearishProtectionV1({symbol="ES",barsByTf={},evaluationTimeMs=null}={}) {
  const evaluationMs = timeMs(evaluationTimeMs);
  const available = String(symbol).toUpperCase()==="ES" && Number.isFinite(evaluationMs);
  const observations = available ? {
    intermediate:assess({degree:"intermediate",timeframe:"4h",periodMs:14400000,bars:barsByTf?.["4h"],evaluationMs,structuralReference:6407}),
    primary:assess({degree:"primary",timeframe:"1d",periodMs:86400000,bars:barsByTf?.["1d"],evaluationMs,structuralReference:5182}),
  } : null;
  return {
    schema:"engine22.higherDegreeBearishProtection.v1",mode:"READ_ONLY",
    symbol:String(symbol).toUpperCase(),available,
    status:available?"OBSERVATION_ONLY":"UNAVAILABLE",
    threshold:THRESHOLD,deepRiskThreshold:DEEP_WARNING,
    degrees:observations,
    noWaveCountMutation:true,noStructuralInvalidation:true,
    noExecution:true,noPermissionCreated:true,noSizingCreated:true,noJournalWrite:true,
  };
}
export default buildHigherDegreeBearishProtectionV1;
