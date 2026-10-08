// Engine 22C Phase 1 — Manager-locked wavelength intelligence.
// READ_ONLY overlay: never feeds permissions, execution, or canonical wave-state mutations.
const MICRO_TARGETS = [
  ["e0382", "0.382", 7832.50],
  ["e0500", "0.500", 7847.75],
  ["e0618", "0.618", 7863.00],
  ["e1000", "1.000", 7912.75],
  ["e1272", "1.272", 7948.25],
  ["e1618", "1.618", 7993.00],
  ["e2000", "2.000", 8042.75],
];
const ALERT_EVENTS = [
  "FIB_LEVEL_TOUCHED",
  "FIB_LEVEL_CONFIRMED",
  "WAVE_INVALIDATION_TOUCHED",
  "WAVE_CONFIRMATION_TOUCHED",
];
const n = (x) => x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null;
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
} = {}) {
  const price = n(currentPrice);
  const low = n(intrabarLow);
  const close10m = n(lastClosed10mClose);
  const microLevels = MICRO_TARGETS.map(([key, label, target]) =>
    level(key, label, target, price != null && price >= target ? "TOUCHED" : "WATCH")
  );
  const microBreach = low != null && low < 7782.75 || price != null && price < 7782.75;
  const microFailed = close10m != null && close10m < 7782.75;
  const microStatus = microFailed ? "FAILED" : microBreach ? "INVALIDATION_TOUCHED" : "MICRO_W5_LAUNCH_WATCH";
  const microConfirmationStatus = microFailed ? "FAILED_CONFIRMED" : microBreach ? "FAILED_REVIEW_REQUIRED" : "PENDING";

  // The .618 was touched according to the Manager. The old canonical Subminute
  // model is an earlier DOWN C-wave and must not be treated as this UP W3 extension.
  const subminuteLevels = [
    level("e0382", "0.382", null),
    level("e0500", "0.500", null),
    level("e0618", "0.618", null, "TOUCHED", {
      note: "Touched per Manager; exact W3 extension price pending anchor lock.",
    }),
  ];
  const minuteLevels = [
    level("reclaim", "First reclaim", 7848.50),
    level("confirmation", "Stronger confirmation", 7906.25),
  ];
  const degrees = {
    micro: {
      degree: "micro", role: "TIMING_ONLY", activeWave: "W5",
      state: microStatus, origin: 7782.75, invalidation: 7782.75,
      confirmation: 7897.75, confirmationStatus: microConfirmationStatus,
      invalidationTouchRule: "INTRABAR_TOUCH_FLAGS_REVIEW",
      failureRule: "10M_CLOSE_BELOW_INVALIDATION_CONFIRMS_FAILURE",
      levels: microLevels, nextLevel: nextLevel(microLevels, price),
      lastTouchedLevel: lastTouchedLevel(microLevels),
      alertEligibleEvents: ALERT_EVENTS,
    },
    subminute: {
      degree: "subminute", activeWave: "W3",
      state: "SUBMINUTE_W3_ACTIVE_CANDIDATE", origin: 7672.50,
      invalidation: 7672.50,
      confirmationStatus: "PENDING_TOMORROW",
      confirmationRule: "NEXT_SESSION_10M_ACCEPTANCE_ABOVE_0618_REQUIRED",
      confirmationNote: "Requires 10m close acceptance above locked .618 and intact Micro W4 / Subminute support. No auto-confirmation until exact .618 is locked.",
      levels: subminuteLevels, nextLevel: null,
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
      lastTouchedLevel: null, alertEligibleEvents: ALERT_EVENTS,
    },
    minor: {
      degree: "minor", activeWave: "W5", state: "MINOR_W5_ACTIVE_CANDIDATE",
      origin: 7398.00, invalidation: 7398.00,
      confirmationStatus: "ACTIVE_CANDIDATE", levels: [],
      nextLevel: null, lastTouchedLevel: null, alertEligibleEvents: ALERT_EVENTS,
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
