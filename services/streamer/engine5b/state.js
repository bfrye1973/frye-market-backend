// services/streamer/engine5b/state.js
export const engine5bState = {
  ok: true,
  symbol: "SPY",
  strategyId: "intraday_scalp@10m",

  zone: {
    id: null,
    lo: null,
    hi: null,
    source: null,
    refreshedAtUtc: null,
  },

  lastTick: null,
  lastBar1s: null,

  e3: {
    ok: false,
    stage: "IDLE",
    armed: false,
    reactionScore: 0,
    updatedAtUtc: null,
    raw: null,
  },
  e4: {
    ok: false,
    volumeScore: 0,
    volumeConfirmed: false,
    liquidityTrap: false,
    updatedAtUtc: null,
    raw: null,
  },

  risk: {
    killSwitch: null,
    paperOnly: null,
    allowlist: null,
    updatedAtUtc: null,
    raw: null,
  },

  go: {
    signal: false,
    direction: null, // "LONG" | "SHORT"
    atUtc: null,
    price: null,
    reason: null,
    reasonCodes: [],
    triggerType: null,
    triggerLine: null,
    cooldownUntilMs: null,
    _holdUntilMs: null,
  },

  sm: {
    stage: "IDLE",
    armedAtMs: null,
    triggeredAtMs: null,
    cooldownUntilMs: null,
    outsideCount: 0,
    lastDecision: null,

    moveType: "NONE", // NONE | ACCEPTANCE | UPPER_REJECTION | LOWER_REJECTION | FAILURE
    moveScore: 0,
    moveDirection: null,
    setupAlive: false,
    armedValid: false,
    triggerFresh: false,
    tooExtended: false,
    staleReason: null,
    eligibilityReason: null,

    interactionZoneId: null,
    interactionZoneSource: null,
    interactionZoneDistPts: null,

    // ✅ Pass 2 — early reversal detector (informational only)
    earlyReversal: false,
    earlyReversalDirection: null, // LONG | SHORT | null
    earlyReversalReason: null,
    earlyReversalControlMid: null,
    earlyReversalTouchBarsAgo: null,
  },

  config: {
    mode: "monitor",
    executeEnabled: false,
    longOnly: true,

    breakoutPts: 0.02,
    persistBars: 1,

    armedWindowMs: 120000,

    e3IntervalMs: 2000,
    zoneRefreshMs: 120000,
    e4RefreshMs: 60000,

    cooldownMs: 120000,
    goHoldMs: Number(process.env.ENGINE5B_GO_HOLD_MS || 120000),
  },
};
