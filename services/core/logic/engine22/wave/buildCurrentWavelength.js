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
  const minorLevels = waveProjectionLevels({
    w1Low: 6417.00, w1High: 6948.75, start: 7398.00, currentPrice: price,
    anchorSource: "ACTIVE_WAVE_STATE_ES_MINOR_W1_W4",
  });
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
