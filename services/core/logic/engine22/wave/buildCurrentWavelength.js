import { buildMicroWaveSequence } from "./buildMicroWaveSequence.js";
// Engine 22C Phase 1 — Manager-locked wavelength intelligence.
// READ_ONLY overlay: never feeds permissions, execution, or canonical wave-state mutations.
// Micro W5 targets use the user-updated W4 low at 7784.00; prior W3 high remains 7897.75.
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
} = {}) {
  const price = n(currentPrice);
  const low = n(intrabarLow);
  const close10m = n(lastClosed10mClose);
  const microSequence = buildMicroWaveSequence({
    currentPrice: price,
    candidateW1High: microCandidateW1High,
    confirmedW1High: microConfirmedW1High,
    w1CompletionConfirmed: microW1CompletionConfirmed,
    w1ConfirmationSource: microW1ConfirmationSource,
    confirmedW2Low: microConfirmedW2Low,
    w2CompletionConfirmed: microW2CompletionConfirmed,
  });
  const microLevels = microSequence.activeWave === "W1"
    ? microSequence.projectedW1
    : microSequence.activeWave === "W2" ? microSequence.projectedW2 : [];
  const microBreach = low != null && low < 7784 || price != null && price < 7784;
  const microFailed = close10m != null && close10m < 7784;
  const microStatus = microFailed ? "FAILED" : microBreach
    ? "INVALIDATION_TOUCHED" : microSequence.state;
  const microConfirmationStatus = microFailed ? "FAILED_CONFIRMED" : microBreach
    ? "FAILED_REVIEW_REQUIRED" : microSequence.confirmationStatus;

  // Subminute W3 extension map is PROVISIONAL pending Manager verification of
  // the user's chart anchors: Subminute W1 7575.00 -> 7859.25, W2 7671.50.
  // Manager-locked historical .618 touch is retained on pullbacks.
  const subminuteLevels = waveProjectionLevels({
    w1Low: 7575.00, w1High: 7859.25, start: 7671.50, currentPrice: price,
    anchorSource: "USER_CHART_SUBMINUTE_W1_PROVISIONAL_20261008",
  }).map((fib) => fib.key === "e0618" ? {
    ...fib, status: "TOUCHED",
    note: "Historical .618 touch per Manager; projected price is provisional pending anchor review.",
  } : fib);
  const minuteLevels = waveProjectionLevels({
    w1Low: 7591.00, w1High: 7848.50, start: 7576.00, currentPrice: price,
    anchorSource: "ACTIVE_WAVE_STATE_ES_MINUTE_W1_PLUS_MANAGER_W2_ORIGIN",
  });
  const minorLevels = waveProjectionLevels({
    w1Low: 6417.00, w1High: 6948.75, start: 7398.00, currentPrice: price,
    anchorSource: "ACTIVE_WAVE_STATE_ES_MINOR_W1_W4",
  });
  const degrees = {
    micro: {
      degree: "micro", role: "TIMING_ONLY", activeWave: microSequence.activeWave,
      microSequence,
      state: microStatus, origin: 7784.00, invalidation: 7784.00,
      confirmation: null, confirmationStatus: microConfirmationStatus,
      invalidationTouchRule: "INTRABAR_TOUCH_FLAGS_REVIEW",
      failureRule: "10M_CLOSE_BELOW_INVALIDATION_CONFIRMS_FAILURE",
      levels: microLevels, nextLevel: nextLevel(microLevels, price),
      lastTouchedLevel: lastTouchedLevel(microLevels),
      alertEligibleEvents: ALERT_EVENTS,
    },
    subminute: {
      degree: "subminute", activeWave: "W3",
      state: "SUBMINUTE_W3_ACTIVE_CANDIDATE", origin: 7671.50,
      invalidation: 7671.50,
      confirmationStatus: "PENDING_TOMORROW",
      confirmationRule: "NEXT_SESSION_10M_ACCEPTANCE_ABOVE_0618_REQUIRED",
      confirmationNote: "Requires 10m close acceptance above locked .618 and intact Micro W4 / Subminute support. No auto-confirmation until provisional .618 anchors are Manager-locked.",
      levels: subminuteLevels, nextLevel: nextLevel(subminuteLevels, price),
      fibAnchorStatus: "PROVISIONAL_SUBMINUTE_W1_ANCHORS_MANAGER_REVIEW",
      lastTouchedLevel: lastTouchedLevel(subminuteLevels),
      alertEligibleEvents: ALERT_EVENTS,
    },
    minute: {
      degree: "minute", activeWave: "W3",
      state: "MINUTE_W3_STARTED_CONFIRMATION_PENDING",
      origin: 7576.00, originArea: [7575.00, 7576.00],
      confirmationLevels: [7848.50, 7906.25],
      confirmationStatus: "PENDING", levels: minuteLevels,
      nextLevel: nextLevel(minuteLevels, price),
      lastTouchedLevel: lastTouchedLevel(minuteLevels), alertEligibleEvents: ALERT_EVENTS,
    },
    minor: {
      degree: "minor", activeWave: "W5", state: "MINOR_W5_ACTIVE_CANDIDATE",
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
