// Engine 22 — Micro sequential wave intelligence v1.
// Display-only. No trade authority, fills, alerts, or canonical wave-state changes.
const START = 7784.00;
const REFERENCE_LENGTH = 130.00; // Earlier Micro W1, 7675 -> 7805. Provisional scaling reference.
const W1_RATIOS = [0.382, 0.5, 0.618, 1, 1.272, 1.618, 2];
const W2_RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786];
const safe = (v) => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v);
const tick = (v) => Math.round(v * 4) / 4;
const label = (ratio) => ratio.toFixed(3);

export function buildMicroWaveSequence({
  currentPrice = null,
  candidateW1High = null,
  confirmedW1High = null,
  w1CompletionConfirmed = false,
  w1ConfirmationSource = null,
  confirmedW2Low = null,
  w2CompletionConfirmed = false,
} = {}) {
  const price = safe(currentPrice);
  const candidate = safe(candidateW1High);
  const confirmed = safe(confirmedW1High);
  const w1Confirmed = w1CompletionConfirmed === true &&
    confirmed != null && confirmed > START &&
    Boolean(String(w1ConfirmationSource || "").trim());
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
  const high = w1Confirmed ? confirmed : null;
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
  const w2Confirmed = w1Confirmed && w2CompletionConfirmed === true &&
    w2Low != null && w2Low > START && w2Low < high;
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
    w1ConfirmationSource: w1Confirmed ? String(w1ConfirmationSource) : null,
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
