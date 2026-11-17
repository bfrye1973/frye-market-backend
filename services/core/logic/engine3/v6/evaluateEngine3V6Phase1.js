// Engine 3 v6 Phase 1 SHADOW ONLY. A deterministic reducer; no reads, writes,
// trade permission, or modification of canonical Engine 3 v5.
// Thresholds are explicit research configuration, never production decisions.
const dir=x=>["LONG","SHORT"].includes(x)?x:"NEUTRAL";
const opposite=d=>d==="SHORT"?"LONG":d==="LONG"?"SHORT":"NEUTRAL";
const number=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const reasons=(...x)=>x.filter(Boolean);
export function evaluateEngine3V6Phase1({
  priorState=null, candidateId=null, zoneId=null,
  observedControl="NO_CONTROL", observedQuality="WEAK",
  completed1m=[],completed5m=[], evaluationTimeMs=null,
  reactionAnchor=null, progressExtreme=null, evidence=null,
  openTradeActive=false,lockedTradeDirection="NEUTRAL",
  policy=null, seedFromV5=null,
}={}){
  const prev=dir(priorState?.canonicalDirection);
  const lock=dir(lockedTradeDirection);
  const sameCandidate=Boolean(candidateId&&priorState?.candidateId===candidateId);
  const validTime=number(evaluationTimeMs);
  const anchor=number(priorState?.reactionAnchor)??number(reactionAnchor);
  const establishedAtMs=number(priorState?.establishedAtMs);
  const config=policy||{};
  // Research parameters must be passed explicitly. Missing requirements fail closed.
  const consecutiveCloses=Number.isInteger(config.invalidationCloses1m)&&config.invalidationCloses1m>0
    ?config.invalidationCloses1m:null;
  const deteriorationEvidenceCount=Number.isInteger(config.deteriorationEvidenceCount)&&config.deteriorationEvidenceCount>0
    ?config.deteriorationEvidenceCount:null;
  const deteriorationTimeoutMs=number(config.deteriorationTimeoutMs);
  const completedBars=bars=>(Array.isArray(bars)?bars:[])
    .filter(b=>b?.completed===true&&number(b?.close)!==null&&number(b?.closeTimeMs)!==null
      &&validTime!==null&&establishedAtMs!==null&&b.closeTimeMs>establishedAtMs
      &&b.closeTimeMs<=validTime)
    .sort((a,b)=>a.closeTimeMs-b.closeTimeMs);
  const bars1=completedBars(completed1m),bars5=completedBars(completed5m);
  const previousProgress=number(priorState?.progressExtreme);
  const priorProgressAt=number(priorState?.lastProgressAtMs);
  const directionExtremes=prev==="SHORT"
    ?bars1.map(b=>number(b?.low)).filter(x=>x!==null)
    :prev==="LONG"?bars1.map(b=>number(b?.high)).filter(x=>x!==null):[];
  const observedExtreme=directionExtremes.length
    ?prev==="SHORT"?Math.min(...directionExtremes):Math.max(...directionExtremes):null;
  const improved=previousProgress!==null&&observedExtreme!==null&&
    (prev==="SHORT"?observedExtreme<previousProgress:observedExtreme>previousProgress);
  const nextProgress=observedExtreme===null?previousProgress:
    previousProgress===null?observedExtreme:
    prev==="SHORT"?Math.min(previousProgress,observedExtreme):
    prev==="LONG"?Math.max(previousProgress,observedExtreme):previousProgress;
  const nextProgressAt=improved||previousProgress===null&&observedExtreme!==null
    ?bars1.at(-1)?.closeTimeMs??validTime:priorProgressAt;
  const against=(close,d)=>d==="SHORT"?close>anchor:close<anchor;
  const anchorBroken=prev!=="NEUTRAL"&&anchor!==null;
  const closed1=anchorBroken&&consecutiveCloses!==null&&bars1.length>=consecutiveCloses&&
    bars1.slice(-consecutiveCloses).every(b=>against(b.close,prev));
  const closed5=anchorBroken&&bars5.length>0&&against(bars5.at(-1).close,prev);
  const votes=[
    evidence?.noProgress===true,evidence?.highOverlap===true,
    evidence?.opposingReaction===true,evidence?.completed5mAbsorption===true
  ].filter(Boolean).length;
  const start=number(priorState?.deterioratingSinceMs);
  const deteriorating=deteriorationEvidenceCount!==null&&votes>=deteriorationEvidenceCount;
  const deteriorationSince=deteriorating&&!improved?(start??validTime):null;
  const timedOut=deteriorating&&!improved&&deteriorationTimeoutMs!==null&&
    validTime!==null&&deteriorationSince!==null&&validTime-deteriorationSince>=deteriorationTimeoutMs;
  const observedDirection=observedControl==="BUYERS_CONTROL"?"LONG":
    observedControl==="SELLERS_CONTROL"?"SHORT":"NEUTRAL";
  const qualified=["GOOD","STRONG"].includes(observedQuality);
  const base={
    schema:"engine3.v6.phase1.shadow.v1",mode:"SHADOW_READ_ONLY",
    candidateId,zoneId,reactionAnchor:anchor,progressExtreme:nextProgress??number(progressExtreme),
    lastProgressAtMs:nextProgressAt,
    establishedAtMs,lastEvaluatedAtMs:validTime,
    canonicalDirection:prev,convictionState:prev==="NEUTRAL"?"NEUTRAL":"HOLDING",
    invalidatedNow:false,establishedNow:false,reversedNow:false,
    deteriorationEvidenceVotes:votes,deterioratingSinceMs:deteriorationSince,
    evaluationTimeMs:validTime,observedControl,observedQuality,
    invalidationEvidence:{closed1mThroughAnchor:Boolean(closed1),
      closed5mThroughAnchor:Boolean(closed5)},
    deteriorationResearch:{timeoutExceeded:Boolean(timedOut),
      timeoutHasInvalidationAuthority:false},
    reasonCodes:[],noPermissionCreated:true,noExecution:true,
    authoritativeDownstream:false,
  };
  if(openTradeActive===true&&lock!=="NEUTRAL"){
    const sameLockedDirection=prev===lock;
    return {...base,canonicalDirection:lock,convictionState:"OPEN_TRADE_LOCKED",
      reactionAnchor:sameLockedDirection?anchor:null,
      establishedAtMs:sameLockedDirection?establishedAtMs:null,
      deterioratingSinceMs:null,
      reasonCodes:["ENGINE10_OPEN_TRADE_DIRECTION_LOCK_APPLIED",
        !sameLockedDirection?"OPPOSITE_PRIOR_ANCHOR_DISCARDED":null].filter(Boolean)};
  }
  // Duplicate or out-of-order evaluations must never rewind canonical shadow state.
  if(validTime!==null&&number(priorState?.lastEvaluatedAtMs)!==null&&
     validTime<=priorState.lastEvaluatedAtMs){
    return {...base,canonicalDirection:prev,convictionState:priorState?.convictionState??base.convictionState,
      lastEvaluatedAtMs:priorState.lastEvaluatedAtMs,
      deterioratingSinceMs:priorState?.deterioratingSinceMs??null,
      reasonCodes:["DUPLICATE_OR_REWOUND_EVALUATION_IGNORED"]};
  }
  if(prev!=="NEUTRAL"&&!sameCandidate){
    return {...base,canonicalDirection:"NEUTRAL",convictionState:"INVALIDATED",
      invalidatedNow:true,invalidatedAtMs:validTime,deterioratingSinceMs:null,
      reasonCodes:["CANDIDATE_IDENTITY_CHANGED","OPPOSITE_ESTABLISHMENT_DEFERRED"]};
  }
  // Phase1: deterioration expiry is an observation, NEVER an invalidation cause.
  if(prev!=="NEUTRAL"&&(closed1||closed5)){
    return {...base,canonicalDirection:"NEUTRAL",convictionState:"INVALIDATED",
      invalidatedNow:true,invalidatedAtMs:validTime,deterioratingSinceMs:null,
      reasonCodes:reasons(closed1&&"ANCHOR_INVALIDATED_COMPLETED_1M",
        closed5&&"ANCHOR_INVALIDATED_COMPLETED_5M",
        "OPPOSITE_ESTABLISHMENT_DEFERRED")};
  }
  if(prev!=="NEUTRAL"){
    return {...base,canonicalDirection:prev,
      convictionState:deteriorating?"DETERIORATING":"HOLDING",
      reasonCodes:reasons(deteriorating?"DIRECTION_HELD_WITH_DETERIORATION":"DIRECTION_HELD",
        timedOut&&"DETERIORATION_TIMEOUT_DIAGNOSTIC_ONLY",
        observedDirection===opposite(prev)&&"OPPOSITE_CONTROL_NOT_AUTOMATIC_REVERSAL")};
  }
  // Phase 1 may ONLY mirror a genuinely fresh, independently established
  // v5 directional event. Never derive a new direction from Engine 22 or 1m.
  const seedDirection=dir(seedFromV5?.direction);
  const seedAnchor=number(seedFromV5?.reactionAnchor);
  const seedTime=number(seedFromV5?.establishedAtMs);
  const afterInvalidation=number(priorState?.invalidatedAtMs);
  if(seedFromV5?.establishedNow===true&&seedDirection!=="NEUTRAL"&&
     seedAnchor!==null&&seedTime!==null&&validTime!==null&&seedTime<=validTime&&
     (afterInvalidation===null||seedTime>afterInvalidation)&&
     (!priorState?.candidateId||sameCandidate)){
    return {...base,canonicalDirection:seedDirection,convictionState:"HOLDING",
      reactionAnchor:seedAnchor,establishedAtMs:seedTime,
      establishedNow:true,
      reasonCodes:["FRESH_V5_DIRECTION_SEEDED_SHADOW_ONLY","V5_REMAINS_CANONICAL"]};
  }
  return {...base,canonicalDirection:"NEUTRAL",convictionState:"NEUTRAL",
    reasonCodes:["PHASE1_NO_FRESH_V5_SEED","V5_REMAINS_CANONICAL"]};
}
export default evaluateEngine3V6Phase1;
