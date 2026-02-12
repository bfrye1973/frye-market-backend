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

  // ✅ GO signal (display-only, no execution)
  // Contract: stable keys always present
  go: {
    signal: false,
    direction: null,        // "LONG" | "SHORT"
    atUtc: null,            // ISO UTC
    price: null,            // number
    reason: null,           // short string
    reasonCodes: [],        // string[]
    triggerType: null,      // "PULLBACK_RECLAIM" | "BREAKOUT"
    triggerLine: null,      // number
    cooldownUntilMs: null,  // epoch ms
    _holdUntilMs: null,     // internal (not required by UI)
  },

  sm: {
    stage: "IDLE",
    armedAtMs: null,
    triggeredAtMs: null,
    cooldownUntilMs: null,
    outsideCount: 0,
    lastDecision: null,
  },

  config: {
    mode: "monitor", // monitor | paper
    executeEnabled: false, // ⚠️ remains OFF (display-only GO)
    longOnly: true,

    breakoutPts: 0.02,
    persistBars: 1, // ✅ OPTION A: was 2, now 1 (blink trigger)

    armedWindowMs: 120000,

    e3IntervalMs: 2000,
    zoneRefreshMs: 120000,
    e4RefreshMs: 60000,

    cooldownMs: 120000,

    // ✅ GO visibility hold (minimum). GO still clears at cooldown expiry.
    goHoldMs: Number(process.env.ENGINE5B_GO_HOLD_MS || 120000),
  },
};
