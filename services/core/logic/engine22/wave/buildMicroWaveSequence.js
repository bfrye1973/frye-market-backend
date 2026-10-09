// Engine 22 — Micro sequential wave intelligence v1.
// Display-only. No trade authority, fills, alerts, or canonical wave-state changes.
const START = 7784.00;
const REFERENCE_LENGTH = 130.00; // Earlier Micro W1, 7675 -> 7805. Provisional scaling reference.
const W1_RATIOS = [0.382, 0.5, 0.618, 1, 1.272, 1.618, 2];
const W2_RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786];
const safe = (v) => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v);
const tick = (v) => Math.round(v * 4) / 4;
const label = (ratio) => ratio.toFixed(3);


// Deterministic 5m evidence: explicit named levels and completed bars only.
// No use of 1m observations for authority. Persisted locked anchors are immutable.
function evaluateCompletion({ side, evidence, priorState, anchor, lockedAnchor }) {
  const prior = ["DEVELOPING","COMPLETION_CANDIDATE","CONFIRMED","LOCKED"].includes(priorState)
    ? priorState : "DEVELOPING";
  if (lockedAnchor != null && prior === "LOCKED") return {
    state: "LOCKED", anchor: lockedAnchor,
    evidence: { timeframe: "5m", immutable: true },
    reasonCodes: ["ANCHOR_LOCKED_NO_REPAINT"],
  };
  const is5m = evidence?.timeframe === "5m" && evidence?.closed === true;
  const numeric = (v) => Number.isFinite(Number(v)) && v != null ? Number(v) : null;
  const close = numeric(evidence?.close);
  const pivot = numeric(evidence?.localPivot);
  const rejected = evidence?.anchorRejection === true;
  const directionBreak = is5m && close != null && pivot != null &&
    (side === "HIGH" ? close < pivot : close > pivot);
  const swing = evidence?.swingBreak === true && directionBreak;
  const displacement = evidence?.displacement === true && directionBreak &&
    evidence?.displacementQuality === "HIGH" &&
    Number(evidence?.bodyToRange) >= 0.65;
  const twoCloses = directionBreak && Number(evidence?.consecutiveClosesBeyondPivot) >= 2;
  const retracement = side === "LOW" ? evidence?.validRetracementReaction === true : true;
  const codes = [];
  if (rejected) codes.push("ANCHOR_REJECTION");
  if (retracement && side === "LOW") codes.push("RETRACEMENT_REACTION");
  if (swing) codes.push("FIVE_MIN_SWING_BREAK");
  if (displacement) codes.push("FIVE_MIN_DISPLACEMENT");
  if (twoCloses) codes.push("TWO_CLOSE_CONFIRMATION");
  const validCandidate = is5m && rejected && directionBreak && retracement && anchor != null;
  const structurallyConfirmed = validCandidate && (twoCloses || (displacement && swing));
  const nextState = prior === "CONFIRMED" && lockedAnchor != null ? "LOCKED"
    : prior === "CONFIRMED" ? "CONFIRMED"
    : structurallyConfirmed && (prior === "COMPLETION_CANDIDATE" || prior === "DEVELOPING")
      ? "CONFIRMED" : validCandidate ? "COMPLETION_CANDIDATE" : prior;
  return {
    state: nextState, anchor: nextState === "LOCKED" ? lockedAnchor : anchor,
    evidence: { timeframe: is5m ? "5m" : "UNVERIFIED", localPivot: pivot,
      close, swingBreak: swing, displacement: displacement,
      consecutiveClosesBeyondPivot: twoCloses ? Number(evidence.consecutiveClosesBeyondPivot) : 0,
      anchorRejection: rejected, validRetracementReaction: retracement,
      sourceTimestamp: is5m ? evidence?.sourceTimestamp || null : null },
    reasonCodes: codes.length ? codes : ["AWAIT_FIVE_MIN_STRUCTURAL_EVIDENCE"],
  };
}

export function buildMicroWaveSequence({
  currentPrice = null,
  candidateW1High = null,
  confirmedW1High = null,
  w1CompletionConfirmed = false,
  w1ConfirmationSource = null,
  confirmedW2Low = null,
  w2CompletionConfirmed = false,
  w1Evidence5m = null,
  w2Evidence5m = null,
  w1PriorState = "DEVELOPING",
  w2PriorState = "DEVELOPING",
  lockedW1High = null,
  lockedW2Low = null,
} = {}) {
  const price = safe(currentPrice);
  const candidate = safe(candidateW1High);
  const confirmed = safe(confirmedW1High);
  const w1Completion = evaluateCompletion({
    side: "HIGH", evidence: w1Evidence5m, priorState: w1PriorState,
    anchor: candidate, lockedAnchor: safe(lockedW1High),
  });
  const w2Completion = evaluateCompletion({
    side: "LOW", evidence: w2Evidence5m, priorState: w2PriorState,
    anchor: safe(confirmedW2Low), lockedAnchor: safe(lockedW2Low),
  });
  // Structural 5m evidence is the only confirmation authority.
  // Legacy manual booleans remain accepted as inputs but cannot confirm waves.
  const w1Confirmed = (w1Completion.state === "CONFIRMED" ||
    w1Completion.state === "LOCKED") && w1Completion.anchor != null &&
    w1Completion.anchor > START;
  const projectedW1 = W1_RATIOS.map((ratio) => {
    const target = tick(START + REFERENCE_LENGTH * ratio);
    return {
      key: "e" + Math.round(ratio * 1000),
      label: label(ratio), price: target,
      status: price != null && price >= target ? "TOUCHED" : "WATCH",
      projectionMode: "PROVISIONAL_REFERENCE_LENGTH_NOT_CONFIRMED_W1_HIGH",
      touchedAt: null, confirmedAt: null,
    };
  });
  const high = w1Confirmed ? w1Completion.anchor : null;
  const range = high == null ? null : high - START;
  const projectedW2 = range == null ? [] : W2_RETRACEMENTS.map((ratio) => ({
    key: "r" + Math.round(ratio * 1000),
    label: label(ratio),
    price: tick(high - range * ratio),
    status: "WATCH",
    touchedAt: null, confirmedAt: null,
    anchorSource: "CONFIRMED_MICRO_W1_HIGH",
  }));
  const w2Low = safe(confirmedW2Low);
  const w2Confirmed = w1Confirmed && (w2Completion.state === "LOCKED" || w2Completion.state === "CONFIRMED" ) &&
    (w2Completion.state === "LOCKED" ? safe(lockedW2Low) : w2Low) != null &&
    (w2Completion.state === "LOCKED" ? safe(lockedW2Low) : w2Low) > START && (w2Completion.state === "LOCKED" ? safe(lockedW2Low) : w2Low) < high;
  return {
    version: "engine22.microWaveSequence.v1",
    role: "TIMING_ONLY",
    origin: START,
    referenceLength: REFERENCE_LENGTH,
    currentPrice: price,
    activeWave: !w1Confirmed ? "W1" : !w2Confirmed ? "W2" : "W3_WATCH",
    state: !w1Confirmed ? "MICRO_W1_HIGH_SEARCH" : !w2Confirmed ? "MICRO_W2_PULLBACK_WATCH" : "MICRO_W3_SETUP_WATCH",
    confirmationStatus: !w1Confirmed ? "W1_COMPLETION_NOT_CONFIRMED" : !w2Confirmed ? "W1_CONFIRMED_W2_PENDING" : "W2_CONFIRMED_W3_PENDING",
    candidateW1High: candidate != null && candidate > START ? candidate : null,
    confirmedW1High: high,
    w1ConfirmationSource: w1Confirmed ? "FIVE_MIN_STRUCTURAL_EVIDENCE" : null,
    w1Completion,
    w2Completion,
    projectedW1,
    projectedW2,
    w2TargetsAvailable: w1Confirmed,
    confirmedW2Low: w2Confirmed ? w2Low : null,
    rules: {
      completion: "EXPLICIT_VALIDATED_W1_COMPLETION_EVIDENCE_REQUIRED",
      wave2: "PROJECT_RETRACEMENTS_ONLY_AFTER_CONFIRMED_W1_HIGH",
      wave3: "WAIT_FOR_CONFIRMED_W2_LOW",
    },
    noPermissionCreated: true,
    noExecution: true,
    noSizing: true,
  };
}
