// services/streamer/engine5b/state.js
export const engine5bState = {
  ok: true,
  symbol: "SPY",
  strategyId: "intraday_scalp@10m",

  // zone ref (from engine5-context)
  zone: {
    id: null,
    lo: null,
    hi: null,
    source: null,
    refreshedAtUtc: null,
  },

  // fast price / microbars (from ticks)
  lastTick: null,
  lastBar1s: null,

  // engines
  e3: { ok: false, stage: "IDLE", armed: false, reactionScore: 0, updatedAtUtc: null, raw: null },
  e4: { ok: false, volumeScore: 0, volumeConfirmed: false, liquidityTrap: false, updatedAtUtc: null, raw: null },

  // risk
  risk: { killSwitch: null, updatedAtUtc: null, raw: null },

  // state machine
  sm: {
    stage: "IDLE",              // IDLE | ARMED | TRIGGERED | COOLDOWN
    armedAtMs: null,
    triggeredAtMs: null,
    cooldownUntilMs: null,
    outsideCount: 0,
    lastDecision: null,
  },

  // config (what we’re running with)
  config: {
    mode: "monitor", // monitor | paper
    executeEnabled: false,
    longOnly: true,
    breakoutPts: 0.02,
    persistBars: 2,
    armedWindowMs: 120000,
    e3IntervalMs: 2000,
    zoneRefreshMs: 120000,
    e4RefreshMs: 60000,
    cooldownMs: 120000,
  },
};
