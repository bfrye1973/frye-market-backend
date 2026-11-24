// Engine 4 Phase B: PURE, INDEPENDENT, TWO-SIDED RESEARCH OBSERVER.
// No consumer wiring, permission, direction authority, orders, or side effects.
// All causal signals require an Engine26-owned authorization clock AND as-of bars.
export const PARALLEL_VERSION = "engine4.parallelResearch.v1";
export const RESEARCH_POLICY = Object.freeze({
  baselineBars: 20, minRelVol: 1.5, wickFraction: 0.5,
  maxBarsWithoutRetest: 24,
});
const number = v => typeof v === "number" && Number.isFinite(v) ? v : null;
const millis = v => typeof v === "string" ? Date.parse(v) :
  number(v) == null ? NaN : v < 1e12 ? v * 1000 : v;
const median = xs => {
  const a = [...xs].sort((x,y) => x-y);
  return a.length ? (a[Math.floor((a.length-1)/2)] + a[Math.floor(a.length/2)])/2 : null;
};
const identity = x => typeof x === "string" && x.trim() ? x : null;
const unknown = (reason, extra = {}) => ({
  version: PARALLEL_VERSION, mode: "RESEARCH_SHADOW_ONLY",
  shadowOnly: true, gate: false, createsDirection: false, createsPermission: false,
  evidenceCompleteness: "INCOMPLETE", confirmationState: "UNKNOWN",
  side: "PARTICIPATION_NEUTRAL", buyers: "NOT_CONFIRMED", sellers: "NOT_CONFIRMED",
  signals: [], reasonCodes: [reason], ...extra,
});

export function buildParallelParticipationShadow({
  bars5m = [], evaluationTimeMs, authorizationStartedAtMs = null,
  candidateId, zoneId, authorizeEngine3Evaluation = false,
  zone = null, invalidated = false, nextZoneReached = false,
  contractId = null, provenance = null, engine29 = null, policy = {},
} = {}) {
  const evalMs = millis(evaluationTimeMs), authMs = millis(authorizationStartedAtMs);
  const cid = identity(candidateId), zid = identity(zoneId);
  const lo = number(zone?.low), hi = number(zone?.high);
  const mid = number(zone?.midline) ?? (lo != null && hi != null ? (lo+hi)/2 : null);
  const setup = { candidateId: cid, zoneId: zid, contractId: identity(contractId),
    authorizationStartedAtMs: Number.isFinite(authMs) ? authMs : null,
    evaluationTimeMs: Number.isFinite(evalMs) ? evalMs : null,
    sourceProvenance: provenance ?? null };
  const P = { ...RESEARCH_POLICY, ...policy };
  if (!cid || !zid || lo == null || hi == null || hi <= lo || mid == null ||
      mid < lo || mid > hi || !Number.isFinite(evalMs))
    return unknown("IDENTITY_ZONE_OR_EVALUATION_INVALID", setup);
  if (authorizeEngine3Evaluation !== true || invalidated === true || nextZoneReached === true)
    return unknown("UPSTREAM_NOT_AUTHORIZED_OR_TERMINATED", setup);
  if (!Number.isFinite(authMs) || authMs <= 0 || authMs > evalMs)
    return unknown("ENGINE26_AUTHORIZATION_CLOCK_MISSING_OR_INVALID", setup);
  // Attribution to an as-of source is separate from candle timestamp validity.
  // Never treat retrospective REST bars as causal source evidence.
  if (provenance?.sourceVerified !== true || provenance?.contractVerified !== true ||
      provenance?.finalityVerified !== true || !identity(contractId))
    return unknown("AS_OF_SOURCE_PROVENANCE_UNVERIFIED", setup);
  const valid = [];
  const rejected = [];
  const seen = new Set();
  for (const b of Array.isArray(bars5m) ? bars5m : []) {
    const t = millis(b?.time), o = number(b?.open), h = number(b?.high),
      l = number(b?.low), c = number(b?.close), v = number(b?.volume);
    const arrival = millis(b?.availableAtMs);
    if (![t,o,h,l,c,v,arrival].every(Number.isFinite) || v < 0 || h < l ||
        o < l || o > h || c < l || c > h || t + 300000 > evalMs ||
        arrival < t + 300000 || arrival > evalMs || b?.finalityVerified !== true ||
        b?.contractId !== contractId || seen.has(t)) {
      rejected.push(b?.time ?? null); continue;
    }
    seen.add(t);
    valid.push({t,o,h,l,c,v,arrival});
  }
  valid.sort((a,b) => a.t-b.t);
  const outputBase = { ...setup, evidenceCompleteness: "VERIFIED_AS_OF",
    completedBarsAdmissible: valid.length, rejectedBars: rejected.length,
    sourceTimestampMs: valid.at(-1)?.t ?? null,
    sourceAvailableAtMs: valid.at(-1)?.arrival ?? null,
    engine29Context: engine29 == null ? "UNAVAILABLE" : "CONTEXT_ONLY",
    version: PARALLEL_VERSION, mode: "RESEARCH_SHADOW_ONLY",
    shadowOnly: true, gate: false, createsDirection: false, createsPermission: false,
    policy: P };
  if (valid.length < P.baselineBars + 1)
    return unknown("INSUFFICIENT_VERIFIED_COMPLETED_BARS", { ...outputBase, evidenceCompleteness: "INCOMPLETE" });
  const afterAuth = valid.filter(b => b.t + 300000 > authMs && b.t >= authMs);
  // A completed bar must have STARTED after authorization: no mixed-authorization bar.
  if (!afterAuth.length) return unknown("NO_POST_AUTHORIZATION_COMPLETED_BARS", { ...outputBase, evidenceCompleteness: "INCOMPLETE" });

  let episode = null, signals = [], trace = [];
  let buyerEvidence = false, sellerEvidence = false;
  const episodeKey = cid + "|" + zid + "|" + authMs + "|" + contractId;
  for (let i=0; i<valid.length; i++) {
    const b = valid[i];
    if (b.t < authMs) continue;
    const intersects = b.l <= hi && b.h >= lo;
    const fullFailure = buyerEvidence && !sellerEvidence
      ? b.o < lo && b.c < lo
      : sellerEvidence && !buyerEvidence
      ? b.o > hi && b.c > hi
      : (b.o < lo && b.c < lo) || (b.o > hi && b.c > hi);
    if (episode && (fullFailure || (i - episode.lastTouchIndex >= P.maxBarsWithoutRetest))) {
      trace.push({ event:"EPISODE_END", barTimeMs:b.t, reason:fullFailure?"FULL_ZONE_FAILURE":"NO_RETEST_24_BARS" });
      episode = null; buyerEvidence = false; sellerEvidence = false; signals = [];
    }
    if (!episode) {
      if (!intersects || fullFailure) continue;
      episode = { key:episodeKey + "|" + b.t, startedAtBarMs:b.t,
        lastTouchIndex:i, lastTouchTimeMs:b.t, phase:"TOUCH_DEFENSE" };
    }
    const phase = intersects
      ? (episode.lastTouchIndex === i ? "TOUCH_DEFENSE" : episode.phase === "FOLLOW_THROUGH" ? "RETEST" : "TOUCH_DEFENSE")
      : "FOLLOW_THROUGH";
    if (intersects) {
      episode.lastTouchIndex = i; episode.lastTouchTimeMs = b.t;
    }
    episode.phase = phase;
    // Historical completed bars are permitted as a *baseline*, not as setup signals.
    const baseline = i >= P.baselineBars ? median(valid.slice(i-P.baselineBars,i).map(x=>x.v)) : null;
    const relVol = baseline > 0 ? b.v / baseline : null;
    const range = b.h - b.l;
    const lowerWick = range > 0 ? (Math.min(b.o,b.c)-b.l)/range : 0;
    const upperWick = range > 0 ? (b.h-Math.max(b.o,b.c))/range : 0;
    const closeUpper = range > 0 && b.c >= b.l + range/2;
    const closeLower = range > 0 && b.c <= b.l + range/2;
    const effort = i > 0 && range > 0 && Math.abs(b.c-valid[i-1].c) <= range*0.25;
    const highVol = relVol != null && relVol >= P.minRelVol;
    const buyers = phase === "TOUCH_DEFENSE" && highVol && b.l <= mid &&
      b.c >= mid && closeUpper && b.c >= lo && (lowerWick >= P.wickFraction || effort);
    const sellers = phase === "TOUCH_DEFENSE" && highVol && b.h >= mid &&
      b.c <= mid && closeLower && b.c <= hi && (upperWick >= P.wickFraction || effort);
    const newBuyer = buyers && !buyerEvidence;
    const newSeller = sellers && !sellerEvidence;
    if (buyers) buyerEvidence = true;
    if (sellers) sellerEvidence = true;
    if (newBuyer || newSeller) signals.push({
      episodeKey:episode.key, barTimeMs:b.t, availableAtMs:b.arrival,
      signalClass:phase, buyerDefense:newBuyer, sellerDefense:newSeller, relVol,
      source:"VERIFIED_AS_OF_COMPLETED_5M" });
    trace.push({barTimeMs:b.t, signalClass:phase, relVol,
      highVolumeNoSide:highVol && !buyers && !sellers,
      effortWithoutResult:highVol && effort,
      buyerDefense:buyers, sellerDefense:sellers});
  }
  const both = buyerEvidence && sellerEvidence;
  return { ...outputBase, evidenceCompleteness:"VERIFIED_AS_OF",
    episode:episode ? {...episode} : null,
    buyers: both ? "UNRESOLVED_TWO_SIDED" : buyerEvidence ? "BUYERS_CONFIRMED" : "NOT_CONFIRMED",
    sellers: both ? "UNRESOLVED_TWO_SIDED" : sellerEvidence ? "SELLERS_CONFIRMED" : "NOT_CONFIRMED",
    side:both ? "TWO_SIDED" : buyerEvidence ? "BUYERS_CONFIRMED" : sellerEvidence ? "SELLERS_CONFIRMED" : "PARTICIPATION_NEUTRAL",
    confirmationState:!episode ? "NOT_CONFIRMED" : both ? "UNRESOLVED" : buyerEvidence || sellerEvidence ? "CONFIRMED" : "NOT_CONFIRMED",
    signals:both ? [] : signals, trace, reasonCodes:both?["BOTH_SIDES_CONFLICT_UNRESOLVED"]:["INDEPENDENT_COMPLETED_5M_EVALUATION"] };
}

export function buildEngine3Engine4Agreement({ engine3Direction = "NEUTRAL", parallel = null } = {}) {
  const side = parallel?.confirmationState === "CONFIRMED" ? parallel.side : null;
  const valid = side === "BUYERS_CONFIRMED" || side === "SELLERS_CONFIRMED";
  const direction = engine3Direction === "LONG" || engine3Direction === "SHORT" ? engine3Direction : "NEUTRAL";
  const label = !valid ? "NO_COMPARISON" : direction === "NEUTRAL" ? "PARTICIPATION_LEADS_PRICE" :
    (direction === "LONG") === (side === "BUYERS_CONFIRMED") ? "ALIGNED" : "CONFLICT";
  return { label, displayOnly:true, gate:false, createsPermission:false,
    engine3Direction:direction, engine4Side:side ?? "UNAVAILABLE" };
}
