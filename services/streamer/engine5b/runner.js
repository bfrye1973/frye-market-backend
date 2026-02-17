// services/streamer/engine5b/runner.js
import WebSocket from "ws";
import { engine5bState } from "./state.js";
import { recordGoOnRisingEdge } from "./goReplayRecorder.js";
import { maybeSendInstantGoAlert } from "../../core/logic/alerts/instantGoPushover.js";


const POLY_WS_URL = "wss://socket.polygon.io/stocks";
const BACKEND1_BASE =
  process.env.BACKEND1_BASE ||
  process.env.HIST_BASE ||
  "https://frye-market-backend-1.onrender.com";

/* -------------------- helpers -------------------- */

function resolvePolygonKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}

function nowUtc() {
  return new Date().toISOString();
}

function toUnixSec(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e12) return Math.floor(n / 1000);
  return Math.floor(n);
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toFloatEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolEnv01(name, fallbackBool) {
  const raw = String(process.env[name] ?? "").trim();
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallbackBool;
}

function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
function clampFloat(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

async function jget(url) {
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error(
      `POST ${url} -> ${r.status} ${(j && JSON.stringify(j).slice(0, 200)) || ""}`
    );
  return j;
}

/* -------------------- GO helpers (display-only) -------------------- */

function setGo(payload) {
  const nowMs = Date.now();
  const holdMs = Number(engine5bState.config?.goHoldMs || 120000);

  const cooldownUntilMs = Number.isFinite(payload.cooldownUntilMs)
    ? payload.cooldownUntilMs
    : nowMs + holdMs;

  const holdUntil = Math.max(nowMs + holdMs, cooldownUntilMs);

  engine5bState.go = engine5bState.go || {};
  engine5bState.go.signal = true;
  engine5bState.go.direction = payload.direction || null;
  engine5bState.go.atUtc = payload.atUtc || nowUtc();
  engine5bState.go.price = Number.isFinite(payload.price) ? payload.price : null;
  engine5bState.go.reason = payload.reason || null;
  engine5bState.go.reasonCodes = Array.isArray(payload.reasonCodes)
    ? payload.reasonCodes
    : [];
  engine5bState.go.triggerType = payload.triggerType || null;
  engine5bState.go.triggerLine = Number.isFinite(payload.triggerLine)
    ? payload.triggerLine
    : null;
  engine5bState.go.cooldownUntilMs = cooldownUntilMs;
  engine5bState.go._holdUntilMs = holdUntil;
}

function clearGoIfExpired() {
  const nowMs = Date.now();
  const holdUntil = Number(engine5bState.go?._holdUntilMs || 0);
  if (engine5bState.go?.signal && holdUntil && nowMs >= holdUntil) {
    engine5bState.go.signal = false;
    engine5bState.go.direction = null;
    engine5bState.go.atUtc = null;
    engine5bState.go.price = null;
    engine5bState.go.reason = null;
    engine5bState.go.reasonCodes = [];
    engine5bState.go.triggerType = null;
    engine5bState.go.triggerLine = null;
    engine5bState.go.cooldownUntilMs = null;
    engine5bState.go._holdUntilMs = null;
  }
}

/* -------------------- Engine 1 zone pick (strict + scalp fallback) -------------------- */

function pickZoneFromEngine1Context(ctx) {
  const price = Number(ctx?.meta?.current_price ?? NaN);

  const activeNeg = ctx?.active?.negotiated ?? null;
  const activeShelf = ctx?.active?.shelf ?? null;
  const activeInst = ctx?.active?.institutional ?? null;

  const active = activeNeg || activeShelf || activeInst || null;

  // STRICT containment (no guessing)
  if (active && Number.isFinite(price)) {
    const lo = Number(active.lo),
      hi = Number(active.hi);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= price && price <= hi) {
      return { id: active.id ?? null, lo, hi, source: "ACTIVE" };
    }
  }

  // Scalp fallback: nearest shelf reference (deterministic)
  const ns = ctx?.nearest?.shelf ?? null;
  if (ns?.lo != null && ns?.hi != null) {
    const lo = Number(ns.lo),
      hi = Number(ns.hi);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return { id: ns.id ?? null, lo, hi, source: "NEAREST_SHELF_SCALP_REF" };
    }
  }

  return { id: null, lo: null, hi: null, source: "NONE" };
}

/* -------------------- 1s and 1m builders from ticks -------------------- */

function applyTickTo1s(cur, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s ?? 0);
  const tSec = toUnixSec(tick?.t);
  if (!Number.isFinite(price) || !Number.isFinite(tSec)) return cur;

  const sec = tSec;

  if (!cur || cur.time < sec) {
    return {
      time: sec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number.isFinite(size) ? size : 0,
    };
  }
  if (cur.time !== sec) return cur;

  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

function applyTickTo1m(cur, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s ?? 0);
  const tSec = toUnixSec(tick?.t);
  if (!Number.isFinite(price) || !Number.isFinite(tSec)) return cur;

  const minSec = Math.floor(tSec / 60) * 60;

  if (!cur || cur.time < minSec) {
    return {
      time: minSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number.isFinite(size) ? size : 0,
    };
  }
  if (cur.time !== minSec) return cur;

  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

/* -------------------- state machine helpers -------------------- */

function isKillSwitchOn() {
  return engine5bState.risk?.killSwitch === true;
}

function inCooldown() {
  const until = engine5bState.sm.cooldownUntilMs;
  return until != null && Date.now() < until;
}

function stageSet(newStage) {
  engine5bState.sm.stage = newStage;
  engine5bState.sm.lastDecision = `${nowUtc()} stage=${newStage}`;
}

function hardResetToIdle(reason) {
  engine5bState.sm.stage = "IDLE";
  engine5bState.sm.armedAtMs = null;
  engine5bState.sm.triggeredAtMs = null;
  engine5bState.sm.cooldownUntilMs = null;
  engine5bState.sm.outsideCount = 0;

  // extra fields for pullback pattern
  engine5bState.sm.pbState = null; // null | IMPULSE_SEEN | PULLBACK_SEEN
  engine5bState.sm.impulse1mTime = null;
  engine5bState.sm.impulse1mHigh = null;
  engine5bState.sm.pullback1mTime = null;
  engine5bState.sm.pullbackHigh = null;
  engine5bState.sm.triggerLine = null;
  engine5bState.sm.triggerAboveCount = 0;

  engine5bState.sm.lastDecision = `${nowUtc()} reset=IDLE reason=${reason || "UNKNOWN"}`;
}

function isArmedRecent() {
  const t = engine5bState.sm.armedAtMs;
  if (!t) return false;
  return Date.now() - t <= engine5bState.config.armedWindowMs;
}

/**
 * Option 1 entry:
 * After impulse candle, wait for next candle wick down, then enter when price breaks pullback candle HIGH.
 */
function pullbackReclaimCheck_1s(closePx) {
  const line = Number(engine5bState.sm.triggerLine);
  if (!Number.isFinite(closePx) || !Number.isFinite(line)) return false;

  // we want the break ABOVE pullback candle high; use breakoutPts as tiny buffer
  const req = line + Number(engine5bState.config.breakoutPts || 0.02);
  return closePx > req;
}

/* -------------------- engine calls -------------------- */

async function refreshZone() {
  const url = `${BACKEND1_BASE}/api/v1/engine5-context?symbol=SPY&tf=10m`;
  const ctx = await jget(url);
  const z = pickZoneFromEngine1Context(ctx);
  engine5bState.zone = { ...engine5bState.zone, ...z, refreshedAtUtc: nowUtc() };

  if (engine5bState.zone?.source === "NONE") {
    hardResetToIdle("NO_ZONE_SOURCE_NONE");
  }
}

async function refreshRisk() {
  const url = `${BACKEND1_BASE}/api/trading/status`;
  const j = await jget(url);

  engine5bState.risk = {
    killSwitch: j?.killSwitch ?? null,
    paperOnly: j?.paperOnly ?? null,
    allowlist: Array.isArray(j?.allowlist) ? j.allowlist : null,
    updatedAtUtc: nowUtc(),
    raw: j,
  };

  if (engine5bState.risk.killSwitch === true) {
    hardResetToIdle("KILL_SWITCH_ON");
  }
}

async function refreshE3() {
  const { lo, hi } = engine5bState.zone || {};
  if (lo == null || hi == null) return;

  const url =
    `${BACKEND1_BASE}/api/v1/reaction-score` +
    `?symbol=SPY&tf=10m&strategyId=intraday_scalp@10m&lo=${encodeURIComponent(
      lo
    )}&hi=${encodeURIComponent(hi)}`;

  const j = await jget(url);

  engine5bState.e3 = {
    ok: true,
    stage: String(j?.stage || "IDLE").toUpperCase(),
    armed: j?.armed === true,
    reactionScore: Number(j?.reactionScore ?? 0),
    updatedAtUtc: nowUtc(),
    raw: j,
  };

  const reasonCodes = Array.isArray(j?.reasonCodes) ? j.reasonCodes : [];
  const stage = engine5bState.e3.stage;

  if (reasonCodes.includes("NOT_IN_ZONE")) {
    hardResetToIdle("E3_NOT_IN_ZONE");
    return;
  }

  if (stage === "ARMED") {
    if (engine5bState.sm.stage === "IDLE") stageSet("ARMED");
    engine5bState.sm.armedAtMs = engine5bState.sm.armedAtMs || Date.now();
  }

  if (stage === "TRIGGERED" || stage === "CONFIRMED") {
    if (engine5bState.sm.stage !== "TRIGGERED") {
      stageSet("TRIGGERED");
      engine5bState.sm.triggeredAtMs = Date.now();
    }
  }
}

async function refreshE4_1m() {
  const { lo, hi } = engine5bState.zone || {};
  if (lo == null || hi == null) return;

  const url =
    `${BACKEND1_BASE}/api/v1/volume-behavior` +
    `?symbol=SPY&tf=1m&zoneLo=${encodeURIComponent(
      lo
    )}&zoneHi=${encodeURIComponent(hi)}&mode=scalp`;

  const j = await jget(url);

  // Safety: if Engine 4 responds with a different zone, treat as stale
  const rzLo = Number(j?.zone?.lo);
  const rzHi = Number(j?.zone?.hi);
  const reqLo = Number(lo);
  const reqHi = Number(hi);

  const match =
    Number.isFinite(rzLo) &&
    Number.isFinite(rzHi) &&
    Math.abs(rzLo - reqLo) < 1e-6 &&
    Math.abs(rzHi - reqHi) < 1e-6;

  if (!match) {
    engine5bState.e4 = {
      ok: false,
      volumeScore: 0,
      volumeConfirmed: false,
      liquidityTrap: false,
      updatedAtUtc: nowUtc(),
      raw: {
        ok: false,
        error: "ZONE_MISMATCH_STALE",
        requested: { lo, hi },
        received: j?.zone ?? null,
      },
    };
    return;
  }

  engine5bState.e4 = {
    ok: true,
    volumeScore: Number(j?.volumeScore ?? 0),
    volumeConfirmed: j?.volumeConfirmed === true,
    liquidityTrap: j?.flags?.liquidityTrap === true,
    updatedAtUtc: nowUtc(),
    raw: j,
  };
}

// ⚠️ kept (but NEVER called in this step)
async function tryExecutePaper(dir, barTimeSec) {
  if (!engine5bState.config.executeEnabled)
    return { ok: false, skipped: true, reason: "EXECUTE_DISABLED" };
  if (isKillSwitchOn())
    return { ok: false, skipped: true, reason: "KILL_SWITCH" };

  // Engine 4 hard blocks
  if (engine5bState.e4?.liquidityTrap)
    return { ok: false, skipped: true, reason: "E4_LIQUIDITY_TRAP" };

  // Require volume score threshold for entry
  if ((engine5bState.e4?.volumeScore ?? 0) < 7)
    return { ok: false, skipped: true, reason: "E4_VOLUME_SCORE_LT_7" };

  const idempotencyKey = `SPY|intraday_scalp@10m|${dir}|${barTimeSec}`;

  const body = {
    idempotencyKey,
    symbol: "SPY",
    strategyId: "intraday_scalp@10m",
    side: "ENTRY",
    engine6: { permission: "ALLOW" },
    engine7: { finalR: 0.1 },
    assetType: "EQUITY",
    paper: true,
    engine5: { bias: dir === "LONG" ? "long" : "short" },
  };

  const url = `${BACKEND1_BASE}/api/trading/execute`;
  return await jpost(url, body);
}

/* -------------------- main loop -------------------- */

export function startEngine5B({ log = console.log } = {}) {
  const KEY = resolvePolygonKey();
  if (!KEY) {
    log("[engine5b] Missing POLYGON_API_KEY — not started");
    return { stop() {} };
  }

  // base config from env
  // ⚠️ execution remains OFF (display-only GO)
  engine5bState.config.executeEnabled = false;
  engine5bState.config.mode = "monitor";
  engine5bState.config.longOnly = toBoolEnv01("ENGINE5B_LONG_ONLY", true);

  // tunables from env
  engine5bState.config.persistBars = clampInt(
    toIntEnv("ENGINE5B_PERSIST_BARS", engine5bState.config.persistBars ?? 2),
    1,
    5
  );
  engine5bState.config.breakoutPts = clampFloat(
    toFloatEnv("ENGINE5B_BREAKOUT_PTS", engine5bState.config.breakoutPts ?? 0.02),
    0.0,
    1.0
  );
  engine5bState.config.cooldownMs = clampInt(
    toIntEnv("ENGINE5B_COOLDOWN_MS", engine5bState.config.cooldownMs ?? 120000),
    1000,
    60 * 60 * 1000
  );
  engine5bState.config.armedWindowMs = clampInt(
    toIntEnv("ENGINE5B_ARMED_WINDOW_MS", engine5bState.config.armedWindowMs ?? 120000),
    1000,
    60 * 60 * 1000
  );
  engine5bState.config.e3IntervalMs = clampInt(
    toIntEnv("ENGINE5B_E3_INTERVAL_MS", engine5bState.config.e3IntervalMs ?? 2000),
    250,
    60000
  );

  // GO visibility hold
  engine5bState.config.goHoldMs = clampInt(
    toIntEnv("ENGINE5B_GO_HOLD_MS", engine5bState.config.goHoldMs ?? 120000),
    1000,
    10 * 60 * 1000
  );

  // NEW: pullback reclaim tunables (safe defaults for your Option 1)
  const IMPULSE_RANGE_PTS = clampFloat(
    toFloatEnv("ENGINE5B_IMPULSE_RANGE_PTS", 0.40),
    0.05,
    5.0
  );
  const PULLBACK_WICK_PTS = clampFloat(
    toFloatEnv("ENGINE5B_PULLBACK_WICK_PTS", 0.20),
    0.01,
    5.0
  );
  const PULLBACK_MAX_MINUTES = clampInt(
    toIntEnv("ENGINE5B_PULLBACK_MAX_MINUTES", 3),
    1,
    10
  );

  log(`[engine5b] starting mode=${engine5bState.config.mode} execute=${engine5bState.config.executeEnabled}`);
  log(`[engine5b] cfg persistBars=${engine5bState.config.persistBars} breakoutPts=${engine5bState.config.breakoutPts} cooldownMs=${engine5bState.config.cooldownMs}`);
  log(`[engine5b] GO hold ms=${engine5bState.config.goHoldMs}`);
  log(`[engine5b] pullback cfg impulseRangePts=${IMPULSE_RANGE_PTS} pullbackWickPts=${PULLBACK_WICK_PTS} pullbackMaxMin=${PULLBACK_MAX_MINUTES}`);

  let stopped = false;
  let ws = null;

  // timers
  let zoneTimer = null;
  let riskTimer = null;
  let e3Timer = null;
  let e4Timer = null;

  // tick microbars
  let cur1s = null;
  let lastClosedSec = null;

  // 1m bar builder for "impulse" + "next candle pullback"
  let cur1m = null;
  let lastClosedMinSec = null;

  // init pullback state
  engine5bState.sm.pbState = engine5bState.sm.pbState ?? null;
  engine5bState.sm.triggerAboveCount = engine5bState.sm.triggerAboveCount ?? 0;

  async function safe(fn, label) {
    try {
      await fn();
    } catch (e) {
      log(`[engine5b] ${label} error: ${e?.message || e}`);
    }
  }

  // initial fetches
  safe(refreshZone, "refreshZone");
  safe(refreshRisk, "refreshRisk");
  safe(refreshE3, "refreshE3");
  safe(refreshE4_1m, "refreshE4_1m");

  // schedule
  zoneTimer = setInterval(() => safe(refreshZone, "refreshZone"), engine5bState.config.zoneRefreshMs);
  riskTimer = setInterval(() => safe(refreshRisk, "refreshRisk"), 5000);
  e3Timer = setInterval(() => safe(refreshE3, "refreshE3"), engine5bState.config.e3IntervalMs);
  e4Timer = setInterval(() => safe(refreshE4_1m, "refreshE4_1m"), engine5bState.config.e4RefreshMs);

  function connectWs() {
    if (stopped) return;
    ws = new WebSocket(POLY_WS_URL);

    ws.on("open", () => {
      ws.send(JSON.stringify({ action: "auth", params: KEY }));
      ws.send(JSON.stringify({ action: "subscribe", params: `T.SPY` }));
      log("[engine5b] WS open, subscribed T.SPY");
    });

    ws.on("message", async (buf) => {
      const msg = safeJsonParse(buf.toString("utf8"));
      if (!msg) return;

      const arr = Array.isArray(msg) ? msg : [msg];
      for (const ev of arr) {
        if (ev?.ev === "status") continue;
        if (ev?.ev !== "T") continue;
        if (String(ev?.sym || "").toUpperCase() !== "SPY") continue;

        // clear GO when expired (runs continuously)
        clearGoIfExpired();

        if (isKillSwitchOn()) {
          hardResetToIdle("KILL_SWITCH_TICK_BLOCK");
          continue;
        }

        engine5bState.lastTick = { t: ev.t, p: ev.p, s: ev.s, updatedAtUtc: nowUtc() };

        // Update 1s bar
        cur1s = applyTickTo1s(cur1s, ev);
        const sec = cur1s?.time;
        if (!sec) continue;

        // Update 1m bar
        cur1m = applyTickTo1m(cur1m, ev);
        const minSec = cur1m?.time ?? null;

        /* ---------- 1m close events: detect impulse then pullback candle ---------- */
        if (minSec != null) {
          if (lastClosedMinSec == null) lastClosedMinSec = minSec;

          if (minSec !== lastClosedMinSec) {
            const closed1m = cur1m;
            const haveZone = engine5bState.zone?.source && engine5bState.zone.source !== "NONE";
            const armedOk = engine5bState.e3?.stage === "ARMED" || engine5bState.sm.stage === "ARMED";

            if (haveZone && armedOk) {
              if (engine5bState.sm.pbState === "IMPULSE_SEEN") {
                const impulseT = Number(engine5bState.sm.impulse1mTime ?? 0);
                if (impulseT > 0) {
                  const minsPassed = Math.floor((minSec - impulseT) / 60);
                  if (minsPassed > PULLBACK_MAX_MINUTES) {
                    engine5bState.sm.pbState = null;
                    engine5bState.sm.impulse1mTime = null;
                    engine5bState.sm.impulse1mHigh = null;
                    engine5bState.sm.pullback1mTime = null;
                    engine5bState.sm.pullbackHigh = null;
                    engine5bState.sm.triggerLine = null;
                    engine5bState.sm.triggerAboveCount = 0;
                    engine5bState.sm.lastDecision = `${nowUtc()} pb_reset=TIMEOUT`;
                  }
                }
              }

              if (!engine5bState.sm.pbState) {
                const range = Number(closed1m.high) - Number(closed1m.low);
                const zoneHi = Number(engine5bState.zone.hi);
                const breakoutPts = Number(engine5bState.config.breakoutPts || 0.02);

                if (
                  Number.isFinite(range) &&
                  range >= IMPULSE_RANGE_PTS &&
                  Number(closed1m.close) > (zoneHi + breakoutPts)
                ) {
                  engine5bState.sm.pbState = "IMPULSE_SEEN";
                  engine5bState.sm.impulse1mTime = minSec;
                  engine5bState.sm.impulse1mHigh = Number(closed1m.high);
                  engine5bState.sm.lastDecision = `${nowUtc()} pb=IMPULSE_SEEN impulseHigh=${engine5bState.sm.impulse1mHigh}`;
                }
              } else if (engine5bState.sm.pbState === "IMPULSE_SEEN") {
                const impulseHigh = Number(engine5bState.sm.impulse1mHigh);
                const wickDown = impulseHigh - Number(closed1m.low);

                if (Number.isFinite(impulseHigh) && Number.isFinite(wickDown) && wickDown >= PULLBACK_WICK_PTS) {
                  engine5bState.sm.pbState = "PULLBACK_SEEN";
                  engine5bState.sm.pullback1mTime = minSec;
                  engine5bState.sm.pullbackHigh = Number(closed1m.high);
                  engine5bState.sm.triggerLine = Number(closed1m.high);
                  engine5bState.sm.triggerAboveCount = 0;
                  engine5bState.sm.lastDecision = `${nowUtc()} pb=PULLBACK_SEEN triggerLine=${engine5bState.sm.triggerLine}`;
                }
              }
            }

            lastClosedMinSec = minSec;
          }
        }

        /* ---------- 1s close events: trigger logic ---------- */
        if (lastClosedSec == null) lastClosedSec = sec;

        if (sec !== lastClosedSec) {
          engine5bState.lastBar1s = { ...cur1s, closedAtUtc: nowUtc() };
          const closePx = Number(cur1s?.close);

          // ✅ Option 1 trigger
          if (
            engine5bState.sm.pbState === "PULLBACK_SEEN" &&
            engine5bState.sm.stage === "ARMED" &&
            isArmedRecent() &&
            !inCooldown()
          ) {
            const above = pullbackReclaimCheck_1s(closePx);
            if (above) engine5bState.sm.triggerAboveCount = Number(engine5bState.sm.triggerAboveCount || 0) + 1;
            else engine5bState.sm.triggerAboveCount = 0;

            if (engine5bState.sm.triggerAboveCount >= engine5bState.config.persistBars) {
              // ✅ TRIGGER — DISPLAY ONLY (NO EXECUTION)
              stageSet("TRIGGERED");
              engine5bState.sm.triggeredAtMs = Date.now();

              // cooldown
              engine5bState.sm.cooldownUntilMs = Date.now() + engine5bState.config.cooldownMs;

              // ✅ Rising edge check BEFORE setGo
              const wasGo = engine5bState.go?.signal === true;

              // ✅ Set GO (display-only) — holds until cooldown (or holdMs) expires
              setGo({
                direction: "LONG",
                atUtc: nowUtc(),
                price: Number.isFinite(closePx) ? closePx : null,
                reason: "PULLBACK_RECLAIM",
                reasonCodes: ["PB_RECLAIM", "E3_ARMED", "E4_OK", "TRIGGER_LINE_BREAK"],
                triggerType: "PULLBACK_RECLAIM",
                triggerLine: Number(engine5bState.sm.triggerLine),
                cooldownUntilMs: engine5bState.sm.cooldownUntilMs,
              });

              // ✅ Auto-record ONLY on NO→YES rising edge
              if (!wasGo && engine5bState.go?.signal === true) {
                recordGoOnRisingEdge({
                  backend1Base: BACKEND1_BASE,
                  symbol: "SPY",
                  strategyId: "intraday_scalp@10m",
                  go: engine5bState.go,
                }).catch(() => {});
              }


              engine5bState.sm.lastDecision =
                `${nowUtc()} GO(PULLBACK_RECLAIM) aboveCount=${engine5bState.sm.triggerAboveCount} cooldownUntilMs=${engine5bState.sm.cooldownUntilMs}`;

              stageSet("COOLDOWN");

              // reset pullback pattern after trigger
              engine5bState.sm.pbState = null;
              engine5bState.sm.impulse1mTime = null;
              engine5bState.sm.impulse1mHigh = null;
              engine5bState.sm.pullback1mTime = null;
              engine5bState.sm.pullbackHigh = null;
              engine5bState.sm.triggerLine = null;
              engine5bState.sm.triggerAboveCount = 0;
            }
          }

          if (engine5bState.sm.stage === "COOLDOWN" && !inCooldown()) {
            hardResetToIdle("COOLDOWN_EXPIRED");
          }

          lastClosedSec = sec;
        }
      }
    });

    ws.on("close", () => {
      log("[engine5b] WS closed; reconnecting in 2.5s");
      setTimeout(() => connectWs(), 2500);
    });

    ws.on("error", (err) => {
      log(`[engine5b] WS error: ${err?.message || err}`);
      try {
        ws.close();
      } catch {}
    });
  }

  connectWs();

  return {
    stop() {
      stopped = true;
      try {
        ws?.close?.();
      } catch {}
      if (zoneTimer) clearInterval(zoneTimer);
      if (riskTimer) clearInterval(riskTimer);
      if (e3Timer) clearInterval(e3Timer);
      if (e4Timer) clearInterval(e4Timer);
      log("[engine5b] stopped");
    },
  };
}
