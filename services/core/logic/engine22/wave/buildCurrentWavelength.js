import { buildMicroWaveSequence } from "./buildMicroWaveSequence.js";
import { buildMicroFiveMinuteEvidence } from "./buildMicroFiveMinuteEvidence.js";
// Engine 22C Phase 1 — Manager-locked wavelength intelligence.
// READ_ONLY overlay: never feeds permissions, execution, or canonical wave-state mutations.
// Micro W1 progression uses Manager-locked 7782.75 start; prior W3 high remains historical.
const MICRO_TARGETS = [
  ["e0382", "0.382", 7833.75],
  ["e0500", "0.500", 7849.00],
  ["e0618", "0.618", 7864.25],
  ["e1000", "1.000", 7914.00],
  ["e1272", "1.272", 7949.25],
  ["e1618", "1.618", 7994.25],
  ["e2000", "2.000", 8044.00],
];
// Explicit legacy-mark anchors are only used for manager-reviewed display projections.
// These are not confirmation rules and never influence trade permissions.
const WAVE_PROJECTION_RATIOS = [
  ["e0382", "0.382", 0.382],
  ["e0500", "0.500", 0.5],
  ["e0618", "0.618", 0.618],
  ["e1000", "1.000", 1],
  ["e1272", "1.272", 1.272],
  ["e1618", "1.618", 1.618],
  ["e2000", "2.000", 2],
];
function waveProjectionLevels({ w1Low, w1High, start, currentPrice, anchorSource }) {
  const length = w1High - w1Low;
  if (![w1Low, w1High, start].every(Number.isFinite) || length <= 0) return [];
  return WAVE_PROJECTION_RATIOS.map(([key, label, ratio]) => {
    const target = Math.round((start + length * ratio) * 4) / 4;
    return level(key, label, target, currentPrice != null && currentPrice >= target ? "TOUCHED" : "WATCH", {
      anchorSource, projectionMode: "MANAGER_REVIEW_PROVISIONAL", wave1Length: length,
    });
  });
}
const ALERT_EVENTS = [
  "FIB_LEVEL_TOUCHED",
  "FIB_LEVEL_CONFIRMED",
  "WAVE_INVALIDATION_TOUCHED",
  "WAVE_CONFIRMATION_TOUCHED",
];
// Market prices must be positive. Missing values sometimes arrive as 0 from snapshot adapters.
const n = (x) => { const value = Number(x); return x == null || x === "" || !Number.isFinite(value) || value <= 0 ? null : value; };
const round = (x) => x == null ? null : Math.round(x * 100) / 100;
const level = (key, label, price, status = "WATCH", extra = {}) => ({
  key, label, price, status, touchedAt: null, confirmedAt: null, ...extra,
});
function nextLevel(levels, currentPrice) {
  return levels.find((v) => v.price != null && (currentPrice == null || v.price > currentPrice)) || null;
}
function lastTouchedLevel(levels) {
  return [...levels].reverse().find((v) => v.status === "TOUCHED" || v.status === "CONFIRMED") || null;
}
export function buildCurrentWavelength({
  symbol = "ES",
  currentPrice = null,
  degreeStates = null,
  engine22Display = null,
  waveFibState = null,
  currentLifecycleState = null,
  intrabarLow = null,
  lastClosed10mClose = null,
  microCandidateW1High = null,
  microConfirmedW1High = null,
  microW1CompletionConfirmed = false,
  microW1ConfirmationSource = null,
  microConfirmedW2Low = null,
  microW2CompletionConfirmed = false,
  microBars5m = [],
  evaluationTimeMs = null,
  previousMicroSequence = null,
} = {}) {
  const price = n(currentPrice);
  const low = n(intrabarLow);
  const close10m = n(lastClosed10mClose);
  const previous = previousMicroSequence && typeof previousMicroSequence === "object"
    ? previousMicroSequence : {};
  const w1Read = buildMicroFiveMinuteEvidence({
    bars: microBars5m, evaluationTimeMs, side: "HIGH", origin: 7782.75,
    prior: { candidateAnchor: previous.candidateW1High,
      lastObservedBarTime: previous.w1LastObservedBarTime },
  });
  const priorHigh = previous.confirmedW1High;
  const w2Read = (previous.w1Completion?.state === "LOCKED" || previous.w1Completion?.state === "CONFIRMED")
    ? buildMicroFiveMinuteEvidence({
      bars: microBars5m, evaluationTimeMs, side: "LOW", origin: 7782.75,
      prior: { candidateAnchor: previous.w2CandidateLow,
        lastObservedBarTime: previous.w2LastObservedBarTime,
        confirmedW1High: priorHigh,
        startAfterTimestamp: previous.w1Completion?.evidence?.sourceTimestamp ||
          previous.w1ConfirmedAtBarTime || null },
    }) : { evidence: null, candidateAnchor: null, lastObservedBarTime: null };
  const w1NewExtreme = previous.w1Completion?.state === "COMPLETION_CANDIDATE" &&
    previous.candidateW1High != null && w1Read.candidateAnchor != null &&
    w1Read.candidateAnchor > previous.candidateW1High;
  const w2NewExtreme = previous.w2Completion?.state === "COMPLETION_CANDIDATE" &&
    previous.w2CandidateLow != null && w2Read.candidateAnchor != null &&
    w2Read.candidateAnchor < previous.w2CandidateLow;

  /*
   * W2 must not auto-lock merely because the previous snapshot reached
   * CONFIRMED. A separate NEW completed 5m structural confirmation is
   * required before the confirmed W2 low becomes LOCKED.
   *
   * This prevents repeated snapshot builds from advancing W2 -> W3_WATCH
   * without new confirmation evidence.
   */
  const w2Evidence = w2Read?.evidence || null;
  const w2EvidenceClose = Number(w2Evidence?.close);
  const w2EvidencePivot = Number(w2Evidence?.localPivot);
  const w2DirectionBreak =
    w2Evidence?.timeframe === "5m" &&
    w2Evidence?.closed === true &&
    Number.isFinite(w2EvidenceClose) &&
    Number.isFinite(w2EvidencePivot) &&
    w2EvidenceClose > w2EvidencePivot;

  const w2StrongDisplacement =
    w2DirectionBreak &&
    w2Evidence?.displacement === true &&
    w2Evidence?.displacementQuality === "HIGH" &&
    Number(w2Evidence?.bodyToRange) >= 0.65;

  const w2SwingBreak =
    w2DirectionBreak &&
    w2Evidence?.swingBreak === true;

  const w2TwoCloseConfirmation =
    w2DirectionBreak &&
    Number(w2Evidence?.consecutiveClosesBeyondPivot) >= 2;

  const w2LockEvidence =
    w2Evidence?.anchorRejection === true &&
    w2Evidence?.validRetracementReaction === true &&
    (
      w2TwoCloseConfirmation ||
      (w2StrongDisplacement && w2SwingBreak)
    );

  const lockedW2Low =
    previous.w2Completion?.state === "LOCKED"
      ? previous.confirmedW2Low
      : previous.w2Completion?.state === "CONFIRMED" &&
        w2LockEvidence === true
      ? previous.confirmedW2Low
      : null;

  const microSequence = buildMicroWaveSequence({
    currentPrice: price,
    candidateW1High: w1Read.candidateAnchor ?? previous.candidateW1High ?? microCandidateW1High,
    w1Evidence5m: w1Read.evidence,
    w1PriorState: w1NewExtreme ? "DEVELOPING" : previous.w1Completion?.state ?? "DEVELOPING",
    lockedW1High: previous.w1Completion?.state === "CONFIRMED" ||
      previous.w1Completion?.state === "LOCKED" ? previous.confirmedW1High : null,
    w2Evidence5m: w2Read.evidence,
    w2PriorState: w2NewExtreme ? "DEVELOPING" : previous.w2Completion?.state ?? "DEVELOPING",
    lockedW2Low,
    confirmedW1High: microConfirmedW1High,
    w1CompletionConfirmed: microW1CompletionConfirmed,
    w1ConfirmationSource: microW1ConfirmationSource,
    confirmedW2Low: w2Read.candidateAnchor ?? previous.w2CandidateLow ?? microConfirmedW2Low,
    w2ObservedLow:
      w2Read.candidateAnchor ??
      previous.w2CandidateLow ??
      microConfirmedW2Low ??
      null,
    w2CompletionConfirmed: microW2CompletionConfirmed,
  });
  microSequence.resetReasonCodes = [
    ...(w1NewExtreme ? ["W1_CANDIDATE_RESET_NEW_HIGH"] : []),
    ...(w2NewExtreme ? ["W2_CANDIDATE_RESET_NEW_LOW"] : []),
  ];
  microSequence.w1LastObservedBarTime = w1Read.lastObservedBarTime;
  microSequence.w1ConfirmedAtBarTime = previous.w1ConfirmedAtBarTime ||
    (microSequence.w1Completion?.state === "CONFIRMED" ?
      microSequence.w1Completion?.evidence?.sourceTimestamp : null);
  microSequence.w2LastObservedBarTime = w2Read.lastObservedBarTime;
  microSequence.w2CandidateLow = w2Read.candidateAnchor;
  const microLevels = microSequence.activeWave === "W1"
    ? microSequence.projectedW1
    : microSequence.activeWave === "W2" ? microSequence.projectedW2 : [];
  const microBreach = low != null && low < 7782.75 || price != null && price < 7782.75;
  const microFailed = close10m != null && close10m < 7782.75;
  const microStatus = microFailed ? "FAILED" : microBreach
    ? "INVALIDATION_TOUCHED" : microSequence.state;
  const microConfirmationStatus = microFailed ? "FAILED_CONFIRMED" : microBreach
    ? "FAILED_REVIEW_REQUIRED" : microSequence.confirmationStatus;

  // Owner-locked Wave 3 projection geometry; display context only.
  // Verified candle touch status remains independent and unavailable here.
  const microW3Anchors = {
    w1Low:7706.25,w1High:7897.25,w2Low:7718.00,
    w2LowLocalTime:"2026-10-15 06:30",
    source:"OWNER_LOCKED_MICRO_W3_20261015",
  };
  const ownerMicroW3Levels = waveProjectionLevels({
    w1Low:microW3Anchors.w1Low,w1High:microW3Anchors.w1High,
    start:microW3Anchors.w2Low,currentPrice:null,
    anchorSource:microW3Anchors.source,
  }).map(level=>({...level,status:"WATCH",provisional:true,touchEvidenceAvailable:false}));
  // Oct 21 owner working count: Micro ABC UP builds Minute internal D.
  // A starts at Minute C's confirmed owner price (Oct 16 11:00 Phoenix).
  // This is a read-only candidate and does not replace microSequence.
  const ownerMicroAbc = {
    version:"engine22.microAbcMinuteD.v1",
    parentDegree:"minute",parentLeg:"D",
    activeWave:"C",direction:"UP",stage:"DEVELOPING_CANDIDATE",
    waveA:{
      startPrice:7676.50,
      startLocalTime:"2026-10-16 11:00",
      high:7773.25,highLocalTime:"2026-10-19 08:00",
      status:"OWNER_COMPLETED",
    },
    waveB:{
      low:7708.00,lowLocalTime:"2026-10-20 05:00",
      status:"OWNER_COMPLETED",
    },
    levels:[0.382,0.5,0.618,1,1.272,1.618,2].map(ratio=>({
      key:"e"+String(Math.round(ratio*1000)).padStart(4,"0"),
      label:ratio.toFixed(3),
      price:Math.round((7708+(7773.25-7676.50)*ratio)*4)/4,
      status:"WATCH",touchEvidenceAvailable:false,provisional:true,
    })),
    confirmationStatus:"C_UP_WORKING_COUNT_NOT_CONFIRMED",
    noExecution:true,noPermissionCreated:true,
  };
  // October 28 owner working transition: Micro W4 DOWN and Submicro A DOWN.
  // Prior W3/W5 records remain unchanged, and no completion is inferred.
  const ownerMicroW4Down = {
    version:"engine22.microW4DownOct28OwnerWorking.v1",
    degree:"micro",activeWave:"W4",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",
    parentDegree:"subminute",parentWave:"D",
    priorW3Ending:{price:7788.50,localTime:"2026-10-28 11:00",timezone:"America/Phoenix",
      status:"OWNER_MARKED_COMPLETE_NOT_INDEPENDENTLY_VERIFIED"},
    precedingW3:{low:7699.50,high:7788.50,length:89.00},
    projectionMethod:"W3_HIGH_MINUS_W3_LENGTH_TIMES_RETRACEMENT",
    levels:[0.236,0.382,0.5,0.618,0.786,1].map(ratio=>({
      key:"r"+Math.round(ratio*1000),label:ratio.toFixed(3),
      price:Math.round((7788.50-89*ratio)*4)/4,
      status:"WATCH",provisional:true,touchEvidenceAvailable:false,
    })),
    wave4:{low:null,completionConfirmed:false},
    nextWave:"W5_UP_POSSIBLE_NOT_STARTED",
    previousModelVersion:"engine22.microW3UpOct27Owner.v1",
    ownerWorkingOnly:true,noExecution:true,noPermissionCreated:true,
  };
  const ownerSubmicroADownInsideMicroW4 = {
    version:"engine22.submicroADownMicroW4Oct28OwnerWorking.v1",
    degree:"submicro",activeWave:"A",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",
    parentDegree:"micro",parentWave:"W4",
    priorW5Ending:{price:7788.50,localTime:"2026-10-28 11:00",timezone:"America/Phoenix",
      status:"OWNER_MARKED_COMPLETE_NOT_INDEPENDENTLY_VERIFIED"},
    sequence:{A:"DOWN_DEVELOPING",B:"UP_PENDING",C:"DOWN_PENDING"},
    projectionBasis:{priorLow:7703.75,priorHigh:7788.50,length:84.75},
    projectionMethod:"PRIOR_HIGH_MINUS_PRIOR_ADVANCE_TIMES_RATIO",
    levels:[0.236,0.382,0.5,0.618,0.786,1,1.272,1.618].map(ratio=>({
      key:"e"+Math.round(ratio*1000),label:ratio.toFixed(3),
      price:Math.round((7788.50-84.75*ratio)*4)/4,
      status:"WATCH",provisional:true,touchEvidenceAvailable:false,
    })),
    waveA:{low:null,completionConfirmed:false},
    previousModelVersion:"engine22.submicroFiveUpOct27OwnerWatch.v1",
    ownerWorkingOnly:true,noExecution:true,noPermissionCreated:true,
  };
  // October 27 owner working Micro impulse-up recount, independent from
  // existing C DOWN and historical Micro models; do not infer missing W1 high.
  const ownerMicroW3Up = {
    version:"engine22.microW3UpOct27Owner.v1",
    degree:"micro",direction:"UP",activeWave:"W3",
    stage:"DEVELOPING_CANDIDATE",parentDegree:"subminute",
    parentWave:"D",parentModelVersion:"engine22.subminuteDUpOwnerWorking.v1",
    wave1:{
      low:7651.75,lowLocalTime:"2026-10-25 15:00",
      high:7739.50,highLocalTime:"2026-10-26 08:00",
      highStatus:"OWNER_CONFIRMED_PRICE_NOT_INDEPENDENTLY_OHLC_VERIFIED",
    },
    wave2:{
      low:7699.50,lowLocalTime:"2026-10-27 01:00",
      status:"OWNER_WORKING_ENDING_PROVISIONAL",
    },
    wave3:{direction:"UP",stage:"DEVELOPING_CANDIDATE",
      startPrice:7699.50,completionConfirmed:false,
      ownerEnding:{price:7788.50,localTime:"2026-10-28 11:00",timezone:"America/Phoenix",status:"OWNER_MARKED_COMPLETE_NOT_INDEPENDENTLY_VERIFIED"}},
    projectionMethod:"W2_LOW_PLUS_W1_LENGTH_TIMES_EXTENSION",
    fibStatus:"OWNER_PROVISIONAL_MICRO_W3_UP_EXTENSIONS",
    fibAnchorStatus:"OWNER_PRICE_LEVELS_NOT_INDEPENDENTLY_CANDLE_VERIFIED",
    wave1Length:7739.50-7651.75,
    levels:[0.382,0.5,0.618,1,1.272,1.618,2].map(ratio=>({
      key:"e"+Math.round(ratio*1000),label:ratio.toFixed(3),
      price:Math.round((7699.50+(7739.50-7651.75)*ratio)*4)/4,
      status:"WATCH",touchEvidenceAvailable:false,
      touchEvidenceType:null,touchedAt:null,provisional:true,
    })),
    previousModelVersion:"engine22.microCDownOwnerWatch.v1",
    oldCDownHistoryPreserved:true,ownerWorkingOnly:true,
    noExecution:true,noPermissionCreated:true,
  };
  // Owner working recount October 22: Micro A completed, B DOWN developing.
  // Keep prior C-UP owner model as historical, without promoting wave confirmation.
  // Current owner working count: A DOWN complete, B UP complete, C DOWN developing.
  const ownerMicroCDown = {
    version:"engine22.microCDownOwnerWatch.v1",
    activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",
    parentDegree:"subminute",parentWave:"C",
    waveA:{high:7898,low:7678,lowLocalTime:"2026-10-16 09:00",status:"OWNER_COMPLETED"},
    waveB:{high:7813.25,highLocalTime:"2026-10-21 09:00",status:"OWNER_COMPLETED"},
    levels:[0.236,0.382,0.5,0.618,0.786,1,1.272,1.618,2].map(ratio=>({
      key:"e"+Math.round(ratio*1000),label:ratio.toFixed(3),
      price:Math.round((7813.25-(7898-7678)*ratio)*4)/4,
      status:"WATCH",provisional:true,touchEvidenceAvailable:false,
    })),
    confirmationStatus:"C_DOWN_WORKING_COUNT_NOT_CONFIRMED",
    noExecution:true,noPermissionCreated:true,
  };
  const ownerMicroBDown = {
    version:"engine22.microBDownOwnerWatch.v1",activeWave:"B",direction:"DOWN",
    stage:"DEVELOPING_CANDIDATE",parentDegree:"subminute",parentLeg:"ABC_UP_INSIDE_MINUTE_D",
    waveA:{low:7708.00,high:7812.25,highLocalTime:"2026-10-21 11:00",status:"OWNER_COMPLETED"},
    levels:[0.236,0.382,0.5,0.618,0.786,1].map(ratio=>({
      key:"r"+Math.round(ratio*1000),label:ratio.toFixed(3),
      price:Math.round((7812.25-(7812.25-7708)*ratio)*4)/4,
      status:"WATCH",provisional:true,touchEvidenceAvailable:false,
    })),
    confirmationStatus:"B_DOWN_WORKING_COUNT_NOT_CONFIRMED",noExecution:true,noPermissionCreated:true,
  };
  // Submicro A down is only a developing leg. These are reference
  // retracements from the last owner Submicro low to the Micro A high,
  // not an independently confirmed Submicro A projection.
  // Current owner working Submicro ABC DOWN inside Micro C DOWN.
  // B time corrected to Oct 22 18:50 Arizona, after A low at 14:30.
  // Owner chart, 2026-10-27 (15m ES): proposed bullish subdivisions
  // developing inside Micro W3 UP, which sits within Subminute D UP.
  // W1/W2/W4 exact extrema have NOT been furnished; do not fabricate them.
  // W3 high is chart-labeled 7772.75; 4 and 5 are tentative annotations.
  // This is NOT an official Elliott completion or autonomous recount.
  // Owner-specified October 27 Arizona 15m Submicro anchors.
  // W1 to W4 are owner working marks; W5 is not yet confirmed.
  const ownerSubmicroFiveUp = {
    version:"engine22.submicroFiveUpOct27OwnerWatch.v1",
    degree:"submicro",parentDegree:"micro",parentWave:"W3",
    parentModelVersion:"engine22.microW3UpOct27Owner.v1",
    activeWave:"W5",direction:"UP",stage:"PROJECTED_W5_WATCH",
    interpretation:"PROVISIONAL_UPWARD_FIVE_WAVE_SCENARIO",
    source:"OWNER_SPECIFIED_2026_10_27_ARIZONA_ANCHORS",
    wave1:{
      low:7703.75,lowLocalTime:"2026-10-27 01:45",
      high:7749.25,highLocalTime:"2026-10-27 05:15",
      status:"OWNER_WORKING_ANCHORS_NOT_CANDLE_VERIFIED",
    },
    wave2:{
      low:7712.75,lowLocalTime:"2026-10-27 07:15",
      status:"OWNER_WORKING_ANCHOR_NOT_CANDLE_VERIFIED",
    },
    wave3:{
      high:7772.25,highLocalTime:"2026-10-27 09:00",
      status:"OWNER_WORKING_ANCHOR_NOT_CANDLE_VERIFIED",
    },
    wave4:{
      low:7750.50,lowLocalTime:"2026-10-27 11:30",
      status:"OWNER_WORKING_ANCHOR_NOT_CANDLE_VERIFIED",
    },
    wave5:{high:null,status:"PROJECTED_NOT_CONFIRMED_COMPLETE",completionConfirmed:false,ownerEnding:{price:7788.50,localTime:"2026-10-28 11:00",timezone:"America/Phoenix",status:"OWNER_MARKED_COMPLETE_NOT_INDEPENDENTLY_VERIFIED"}},
    priorCEnding:{price:7648.50,localTime:"2026-10-23 07:00",
      status:"OWNER_NOMINATED_PRIOR_C_ENDING_UNVERIFIED"},
    wave1Length:45.50,
    projectionMethod:"W4_LOW_PLUS_W1_LENGTH_TIMES_RATIO",
    fibStatus:"OWNER_PROVISIONAL_W5_UP_PROJECTIONS",
    levels:[0.382,0.5,0.618,1,1.272,1.618,2].map(ratio=>({
      key:"e"+Math.round(ratio*1000),label:ratio.toFixed(3),
      price:Math.round((7750.50+(7749.25-7703.75)*ratio)*4)/4,
      status:"WATCH",touchEvidenceAvailable:false,
      touchEvidenceType:null,touchedAt:null,provisional:true,
    })),
    confirmationStatus:"NO_SUBMICRO_WAVE_COMPLETION_CONFIRMED",
    previousModelVersion:"engine22.submicroCDownOwnerWatch.v1",
    historicFibTouchesPreserved:true,
    noExecution:true,noPermissionCreated:true,ownerWorkingOnly:true,
  };
  const ownerSubmicroCDown = {
    version:"engine22.submicroCDownOwnerWatch.v1",
    activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",
    parentDegree:"micro",parentWave:"C",
    waveA:{high:7812,highLocalTime:"2026-10-21 11:30",
      low:7712,lowLocalTime:"2026-10-22 14:30",status:"OWNER_COMPLETED"},
    waveB:{high:7743,highLocalTime:"2026-10-22 18:50",status:"OWNER_COMPLETED"},
    levels:[0.382,0.5,0.618,0.786,1,1.272,1.618,2].map(ratio=>({
      key:"e"+Math.round(ratio*1000),label:ratio.toFixed(3),
      price:Math.round((7743-100*ratio)*4)/4,
      status:"WATCH",provisional:true,touchEvidenceAvailable:false,
    })),
    confirmationStatus:"C_DOWN_WORKING_COUNT_NOT_CONFIRMED",
    noExecution:true,noPermissionCreated:true,
  };
  const ownerSubmicroADown = {
    version:"engine22.submicroADownOwnerWatch.v1",activeWave:"A",direction:"DOWN",
    stage:"DEVELOPING_CANDIDATE",parentDegree:"micro",parentWave:"B",
    referenceLow:7750.75,originHigh:7812.25,
    referenceOnly:true,
    levels:[0.236,0.382,0.5,0.618,0.786,1].map(ratio=>({
      key:"r"+Math.round(ratio*1000),label:ratio.toFixed(3),
      price:Math.round((7812.25-(7812.25-7750.75)*ratio)*4)/4,
      status:"WATCH",provisional:true,touchEvidenceAvailable:false,
    })),
    confirmationStatus:"A_DOWN_DEVELOPING_UNCONFIRMED",noExecution:true,noPermissionCreated:true,
  };
  const subminuteLevels = waveProjectionLevels({
    w1Low:7616.25,w1High:7847.00,start:7673.25,currentPrice:null,
    anchorSource:"OWNER_CONFIRMED_ALL_NODES_SUBMINUTE_20261015",
  }).map(level=>({...level,status:"WATCH",provisional:true,touchEvidenceAvailable:false}));
  const minuteLevels = waveProjectionLevels({
    w1Low: 7591.00, w1High: 7848.50, start: 7576.00, currentPrice: price,
    anchorSource: "ACTIVE_WAVE_STATE_ES_MINUTE_W1_PLUS_MANAGER_W2_ORIGIN",
  });
  // Minor W5 only: a live ES snapshot at/above a Fib level proves that
  // price has REACHED that level. It does not prove a historic candle touch,
  // a completed candle, a W5 confirmation, or trade permission.
  const minorLevels = waveProjectionLevels({
    w1Low: 6417.00, w1High: 6948.75, start: 7398.00, currentPrice: price,
    anchorSource: "ACTIVE_WAVE_STATE_ES_MINOR_W1_W4",
  }).map(item => ({
    ...item,
    touchEvidenceAvailable:item.status==="TOUCHED",
    touchEvidenceType:item.status==="TOUCHED"?"ES_CURRENT_SNAPSHOT_AT_OR_ABOVE_LEVEL":null,
    touchEvidence:item.status==="TOUCHED" ? {
      verified:false, observation:"ES_CURRENT_SNAPSHOT_THRESHOLD",
      observedPrice:price, direction:"UP", historicTouchUnverified:true,
    }:null,
  }));
  // Owner-locked Submicro W1 after the ABC C low at 7718.00.
  // This is a distinct owner-directed read-only wave state, not a
  // candle-confirmed V3 recount or trading authorization.
  const submicroW1Low = 7718.00;
  const submicroW1High = 7800.00;
  const submicroW2Ratios = [
    ["r236","0.236",0.236],["r382","0.382",0.382],
    ["r500","0.500",0.5],["r618","0.618",0.618],
    ["r786","0.786",0.786],
  ];
  // Owner's annotated 10m chart showed W2 low at about 7772.50.
  // This proves a chart-observed 0.236 crossing, NOT a feed-verified touch.
  const ownerObservedW2Low = 7772.50;
  const submicroW2Levels = submicroW2Ratios.map(([key,label,ratio]) => {
    const target = Math.round((submicroW1High -
      (submicroW1High-submicroW1Low)*ratio)*4)/4;
    const chartObserved = ownerObservedW2Low <= target;
    return {
      key,label,price:target,
      status:chartObserved?"OWNER_OBSERVED_TOUCH":"WATCH",
      touchEvidenceType:chartObserved?"OWNER_CHART_OBSERVATION":null,
      ownerObservedW2Low:chartObserved?ownerObservedW2Low:null,
      provisional:true,touchEvidenceAvailable:false,
      anchorSource:"OWNER_CORRECTED_SUBMICRO_W1_20261016",
    };
  });
  const ownerSubmicroW2 = {
    version:"engine22.submicroW2OwnerProjection.v1",
    previousWave:"C",previousWaveEnd:7718.00,
    completedWave:"W1",activeWave:"W2",direction:"DOWN",
    lifecycle:"W1_COMPLETED_OWNER_READ_W2_WATCH",
    anchors:{w1Low:submicroW1Low,w1High:submicroW1High},
    ownerObservedW2Low,
    levels:submicroW2Levels,
    confirmationStatus:"OWNER_COUNT_CANDLE_CONFIRMATION_PENDING",
    noExecution:true,provisional:true,
  };
  // Owner-confirmed Oct 21 Submicro A/B points; C remains an active
  // developing working hypothesis, not a structurally confirmed completion.
  const ownerSubmicroAbc = {
    version:"engine22.submicroAbcMicroC.v1",
    parentDegree:"micro",parentWave:"C",
    activeWave:"C",direction:"UP",stage:"DEVELOPING_CANDIDATE",
    waveA:{
      startPrice:7708.00,startLocalTime:"2026-10-20 05:00",
      high:7793.25,highLocalTime:"2026-10-20 16:00",
      status:"OWNER_COMPLETED",
    },
    waveB:{
      low:7750.75,lowLocalTime:"2026-10-21 07:00",
      status:"OWNER_COMPLETED",
    },
    levels:[0.382,0.5,0.618,1,1.272,1.618,2].map(ratio=>({
      key:"e"+String(Math.round(ratio*1000)).padStart(4,"0"),
      label:ratio.toFixed(3),
      price:Math.round((7750.75+(7793.25-7708.00)*ratio)*4)/4,
      status:"WATCH",touchEvidenceAvailable:false,provisional:true,
    })),
    confirmationStatus:"C_UP_WORKING_COUNT_NOT_CONFIRMED",
    noExecution:true,noPermissionCreated:true,
  };
  const degrees = {
    submicro:{
      degree:"submicro",activeWave:"W2",direction:"DOWN",
      state:"SUBMICRO_W2_DOWN_WATCH_OWNER_READ",
      ownerSubmicroW2, // archived owner model; touch memory must remain separate
      ownerSubmicroAbc,
      ownerSubmicroADown,
      ownerSubmicroCDown,
      ownerSubmicroFiveUp,
      ownerSubmicroADownInsideMicroW4,
      levels:submicroW2Levels,
      nextLevel:null,lastTouchedLevel:null,
      noExecution:true,
    },
    micro: {
      degree: "micro", role: "TIMING_ONLY", activeWave: microSequence.activeWave,
      anchorProvenance: microSequence.anchorProvenance,
      microSequence,
      ownerMicroAbc,
      ownerMicroBDown,
      ownerMicroCDown,
      ownerMicroW3Up,
      ownerMicroW4Down,
      ownerMicroW3:{
        version:"engine22.microW3OwnerProjection.v1",
        activeWave:"W3",direction:"UP",anchors:microW3Anchors,
        levels:ownerMicroW3Levels,provisional:true,noExecution:true,
      },
      state: microStatus, origin: 7782.75, invalidation: 7782.75,
      confirmation: null, confirmationStatus: microConfirmationStatus,
      invalidationTouchRule: "INTRABAR_TOUCH_FLAGS_REVIEW",
      failureRule: "10M_CLOSE_BELOW_INVALIDATION_CONFIRMS_FAILURE",
      levels: microLevels, nextLevel: nextLevel(microLevels, price),
      lastTouchedLevel: lastTouchedLevel(microLevels),
      alertEligibleEvents: ALERT_EVENTS,
    },
    subminute: {
      // October 27 owner-selected working proposal. Not a completed-pattern
      // confirmation, canonical count promotion, or autonomous transition.
      // Earlier C DOWN and legacy W3 models remain below without mutation.
      ownerCurrentDUp:{
        version:"engine22.subminuteDUpOwnerWorking.v1",
        activeWave:"D",direction:"UP",stage:"DEVELOPING_CANDIDATE",
        degree:"subminute",parentDegree:"minute",parentWave:"W2",
        ownerApprovalReference:"OWNER_APPROVED_2026_10_27_PR214",
        proposedPriorC:{
          direction:"DOWN",endingPrice:7648.50,
          endingLocalTime:"2026-10-23 07:00",
          timezone:"America/Phoenix",
          source:"OWNER_CHART_REFERENCE_NOT_CANDLE_VERIFIED",
          confirmationStatus:"OWNER_WORKING_ENDING_NOT_STRUCTURALLY_VERIFIED",
        },
        parentCorrectionStatus:"MINUTE_W2_NOT_COMPLETE",
        minuteW3Started:false,
        structure:"ABCDE_TRIANGLE_CANDIDATE_NOT_CONFIRMED",
        nextLeg:"E_DOWN_POSSIBLE_NOT_STARTED",
        // D-UP retracements of the nominated B -> C decline.
        // B high is an older owner chart reference; C low is not candle-verified.
        // These are provisional upside objectives, never confirmation of D.
        anchors:{
          bHigh:7897.50,
          cLow:7648.50,
          cLowLocalTime:"2026-10-23 07:00",
          cLowTimezone:"America/Phoenix",
          status:"OWNER_REFERENCES_NOT_INDEPENDENTLY_VERIFIED",
        },
        projectionMethod:"C_LOW_PLUS_B_TO_C_RANGE_TIMES_RETRACEMENT_RATIO",
        levels:[0.236,0.382,0.5,0.618,0.786,0.886,1].map(ratio=>({
          key:"r"+Math.round(ratio*1000),label:ratio.toFixed(3),
          price:Math.round((7648.50+(7897.50-7648.50)*ratio)*4)/4,
          status:"WATCH",touchEvidenceAvailable:false,
          touchEvidenceType:null,touchedAt:null,provisional:true,
        })),
        fibLevelsStatus:"OWNER_PROVISIONAL_D_UP_RETRACEMENT",
        previousModelVersion:"engine22.subminuteCurrentCDownReference.v1",
        oldCDownHistoryPreserved:true,
        publicationStatus:"OWNER_WORKING_PROVISIONAL",
        noExecution:true,noPermissionCreated:true,
      },
      // Owner-selected presentation of larger corrective C inside Minute W2.
      // The source scenario stays independently stored under Minute, and the
      // legacy Subminute W3 remains for historical audit.
      ownerCurrentCDown:{
        version:"engine22.subminuteCurrentCDownReference.v1",
        activeWave:"C",direction:"DOWN",
        parentDegree:"minute",parentWave:"W2",
        stage:"DEVELOPING_CANDIDATE",
        scenarioSource:"engine22WaveStrategy.currentWavelength.degrees.minute.ownerLargerCDownScenario",
        modelStatus:"DEGREE_PLACEMENT_PROVISIONAL",
        levels:[], // resolved from canonical scenario at presentation time
        confirmationStatus:"NOT_STRUCTURALLY_CONFIRMED",
        noExecution:true,noPermissionCreated:true,
      },
      degree: "subminute", activeWave: "W3", direction: "UP",
      state: "SUBMINUTE_W3_ACTIVE_CANDIDATE", origin: 7673.25,
      invalidation: 7673.25,
      confirmationStatus: "PENDING_TOMORROW",
      confirmationRule: "NEXT_SESSION_10M_ACCEPTANCE_ABOVE_0618_REQUIRED",
      confirmationNote: "Owner anchors locked. Structural confirmation and candle touch evidence remain separately pending.",
      levels: subminuteLevels, nextLevel: nextLevel(subminuteLevels, price),
      fibAnchorStatus: "OWNER_COORDINATES_CONFIRMED_PRICE_BASIS_PENDING",
      lastTouchedLevel: lastTouchedLevel(subminuteLevels),
      alertEligibleEvents: ALERT_EVENTS,
    },
    minute: {
      // Owner's current Oct 21 working hypothesis is Minute W2 developing,
      // with an INTERNAL contracting triangle candidate. It is NOT a
      // completed triangle, a formally confirmed recount, or trade authority.
      // The historical W3 projection beneath this packet remains for audit.
      // Larger August-October correction: owner-directed C DOWN projection.
      // Degree placement between competing ABC and ABCDE paths is unconfirmed.
      // Independent from historical Minute W3 and older D-UP watch.
      ownerLargerCDownScenario:{
        version:"engine22.largerCorrectionCDownWatch.v1",
        status:"PROVISIONAL_WORKING_SCENARIO",activeLeg:"C",direction:"DOWN",
        structureCandidates:["ABC","ABCDE_TRIANGLE"],
        degreeAssignment:"PENDING_RECONCILIATION",
        anchors:{aHigh:7905,aHighLocalTime:"2026-08-13 07:00",
          aLow:7575,aLowLocalTime:"2026-09-16 12:00",
          bHigh:7897.50},
        formula:"B_HIGH_MINUS_A_LENGTH_TIMES_RATIO",
        levels:[0.382,0.5,0.618,0.786,1,1.272,1.618,2].map(ratio=>({
          key:"e"+Math.round(ratio*1000),label:ratio.toFixed(3),
          price:Math.round((7897.50-330*ratio)*4)/4,
          status:"WATCH",touchEvidenceAvailable:false,provisional:true,
        })),
        warningReferences:[7618,7575],
        confirmationStatus:"STRUCTURAL_C_COMPLETION_NOT_CONFIRMED",
        countIdentityStatus:"NOT_PUBLISHED",noExecution:true,noPermissionCreated:true,
      },
      // Oct 25 owner-confirmed Minute W1: July 30 12:00 AZ -> Aug 13 09:00 AZ.
      // W2 is still DOWN/DEVELOPING. This owner model supersedes the
      // historical Minute W3 projection for the CURRENT Minute card ONLY.
      ownerMinuteW2Retracement:{
        version:"engine22.minuteW2RetracementOwner.v1",
        degree:"minute",completedWave:"W1",completedWaveConfirmedByOwner:true,
        activeWave:"W2",direction:"DOWN",stage:"DEVELOPING",
        nextWave:"W3",nextWaveStarted:false,
        anchors:{
          w1Low:7419.50,w1LowLocalTime:"2026-07-30 12:00",
          w1High:7908.75,w1HighLocalTime:"2026-08-13 09:00",
          wave1Length:489.25,
          provenance:"OWNER_CHART_APPROVED_20261025",
        },
        levels:[0.236,0.382,0.5,0.618,0.786,1].map(ratio=>({
          key:"r"+String(Math.round(ratio*1000)).padStart(4,"0"),
          label:ratio.toFixed(3),
          price:Math.round((7908.75-489.25*ratio)*4)/4,
          status:"WATCH",provisional:false,touchEvidenceAvailable:false,
          levelType:ratio===1?"W1_ORIGIN_STRUCTURAL_BOUNDARY":"W2_RETRACEMENT",
        })),
        structuralReference:7419.50,
        invalidationRule:"MINUTE_W2_CANNOT_TRADE_BELOW_START_OF_MINUTE_W1",
        invalidationTrigger:"INTRABAR_PRICE_BELOW_7419_50",
        status:"OWNER_APPROVED_REFERENCE_NOT_LIVE_HARD_INVALIDATION",
        noExecution:true,noPermissionCreated:true,
      },
      ownerMinuteW2Hypothesis: {
        version:"engine22.minuteW2ComplexCorrectionWatch.v1",
        degree:"minute",activeWave:"W2",direction:"CORRECTIVE",
        stage:"COMPLEX_CORRECTION_CANDIDATE",
        confirmationStatus:"OWNER_HYPOTHESIS_UNCONFIRMED",
        // Owner confirmed these two pivots for the developing internal D leg.
        // Fib is a retracement of B -> C, NOT a new Minute W3 projection.
        activeInternalLeg:"D",
        activeInternalLegDirection:"UP",
        activeInternalLegStage:"DEVELOPING_CANDIDATE",
        priorPivotB:{price:7897.50,source:"OWNER_CONFIRMED_20261021"},
        priorPivotC:{price:7676.50,localTime:"2026-10-16 11:00",source:"OWNER_CONFIRMED_20261021"},
        internalDProjection:{
          version:"engine22.minuteW2InternalDProjection.v1",
          origin:7676.50,referenceHigh:7897.50,
          direction:"UP",status:"DEVELOPING_WATCH",
          levels:[0.382,0.5,0.618,0.786,0.886].map(ratio=>({
            key:"r"+Math.round(ratio*1000),label:ratio.toFixed(3),
            price:Math.round((7676.50+(7897.50-7676.50)*ratio)*4)/4,
            status:"WATCH",touchEvidenceAvailable:false,provisional:true,
          })),
          completionConfirmed:false,noExecution:true,
        },
        minuteW3Started:false,
        minuteW3Confirmation:"NOT_CONFIRMED",
        rangeReferences:{upperApprox:7910,lowerApprox:7557},
        internalPattern:{
          type:"CONTRACTING_TRIANGLE_CANDIDATE",
          placement:"INTERNAL_B_OR_X_COMPONENT_UNRESOLVED",
          A:"COMPLETION_CANDIDATE",
          B:"COMPLETION_CANDIDATE",
          C:"COMPLETION_CANDIDATE",
          D:"DEVELOPING_CANDIDATE",
          E:"ANTICIPATED_NOT_STARTED",
          completionConfirmed:false,
        },
        // Lower degrees are preserved, not reset or relabeled. Their prior
        // owner projections are observational swings during the Minute W2
        // hypothesis, not evidence that Minute W3 has been confirmed.
        childDegreeContext:{
          subminute:{
            historicalCountPreserved:true,
            priorProjection:"SUBMINUTE_W3_OWNER_PROJECTION",
            currentWorkingStructure:"ABC_UP_INSIDE_MINUTE_D",
            direction:"UP",
            A:"DEVELOPING_CANDIDATE",
            B:"PENDING",
            C:"PENDING",
            parentLeg:"MINUTE_W2_INTERNAL_D",
            relationship:"INSIDE_MINUTE_W2_CANDIDATE",
            waveRecount:"PENDING",
            noReset:true,
          },
          micro:{
            historicalCountPreserved:true,
            priorProjection:"MICRO_W3_OWNER_PROJECTION",
            relationship:"INSIDE_MINUTE_W2_CANDIDATE",
            waveRecount:"PENDING",
            noReset:true,
          },
          submicro:{
            historicalCountPreserved:true,
            priorProjection:"SUBMICRO_W2_OWNER_PROJECTION",
            relationship:"INSIDE_MINUTE_W2_CANDIDATE",
            waveRecount:"PENDING",
            noReset:true,
          },
        },
        preserveHistoricalAnchors:true,
        shadowOnly:true,noExecution:true,noPermissionCreated:true,
      },
      degree: "minute", activeWave: "W3", direction: "UP",
      state: "MINUTE_W3_STARTED_CONFIRMATION_PENDING",
      origin: 7576.00, originArea: [7575.00, 7576.00],
      confirmationLevels: [7848.50, 7906.25],
      confirmationStatus: "PENDING", levels: minuteLevels,
      nextLevel: nextLevel(minuteLevels, price),
      lastTouchedLevel: lastTouchedLevel(minuteLevels), alertEligibleEvents: ALERT_EVENTS,
    },
    minor: {
      // Owner-confirmed current W5 reference; strictly separate from order stops.
      ownerW5StructuralReference:{
        version:"engine22.minorW5StructuralReference.v1",
        pivotWave:"W4",price:7398.00,source:"OWNER_CHART_APPROVED_20261025",
        rule:"MINOR_W5_ACTIVE_COUNT_REQUIRES_W4_ORIGIN_REVIEW_IF_BREACHED",
        trigger:"INTRABAR_PRICE_BELOW_7398_00",
        status:"OWNER_APPROVED_REFERENCE_NOT_LIVE_HARD_INVALIDATION",
        noExecution:true,noPermissionCreated:true,
      },
      degree: "minor", activeWave: "W5", direction: "UP", state: "MINOR_W5_ACTIVE_CANDIDATE",
      origin: 7398.00, invalidation: 7398.00,
      confirmationStatus: "ACTIVE_CANDIDATE", levels: minorLevels,
      nextLevel: nextLevel(minorLevels, price), lastTouchedLevel: lastTouchedLevel(minorLevels), alertEligibleEvents: ALERT_EVENTS,
    },
  };
  return {
    version: "engine22.currentWavelength.v1",
    symbol: String(symbol || "ES").toUpperCase(),
    currentPrice: round(price),
    source: "MANAGER_LOCKED_CURRENT_WAVELENGTH_PHASE1",
    sourceMode: "OVERRIDE_DISPLAY_INTELLIGENCE",
    canonicalWaveStateConflict: true,
    primaryActiveDegree: "subminute",
    timingDegree: "micro",
    tacticalParentDegree: "minute",
    structuralParentDegree: "minor",
    requiresPersistence: true,
    persistenceMode: "TOUCH_STATUS_SHOULD_PERSIST_AFTER_FIRST_TOUCH",
    persistenceNote: "Phase 1 records Manager-locked touch facts and current-price observations; it does not maintain historical touch state.",
    degrees,
    alertsPreview: [], // Future Engine 13 integration only; no sends.
  };
}
