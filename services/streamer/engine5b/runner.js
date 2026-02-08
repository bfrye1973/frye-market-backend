// services/streamer/engine5b/runner.js
import WebSocket from "ws";
import { engine5bState } from "./state.js";

const POLY_WS_URL = "wss://socket.polygon.io/stocks";
const BACKEND1_BASE =
  process.env.BACKEND1_BASE ||
  process.env.HIST_BASE ||
  "https://frye-market-backend-1.onrender.com";

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
  try { return JSON.parse(s); } catch { return null; }
}

async function jget(url) {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`POST ${url} -> ${r.status} ${(j && JSON.stringify(j).slice(0,200)) || ""}`);
  return j;
}

function pickZoneFromEngine1Context(ctx) {
  const price = Number(ctx?.meta?.current_price ?? NaN);

  const activeNeg = ctx?.active?.negotiated ?? null;
  const activeShelf = ctx?.active?.shelf ?? null;
  const activeInst = ctx?.active?.institutional ?? null;

  const active = activeNeg || activeShelf || activeInst || null;

  // Strict containment check
  if (active && Number.isFinite(price)) {
    const lo = Number(active.lo), hi = Number(active.hi);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= price && price <= hi) {
      return { id: active.id ?? null, lo, hi, source: "ACTIVE" };
    }
  }

  // Scalp fallback: nearest shelf
  const ns = ctx?.nearest?.shelf ?? null;
  if (ns?.lo != null && ns?.hi != null) {
    const lo = Number(ns.lo), hi = Number(ns.hi);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return { id: ns.id ?? null, lo, hi, source: "NEAREST_SHELF_SCALP_REF" };
    }
  }

  return { id: null, lo: null, hi: null, source: "NONE" };
}

/* -------------------- 1s microbar builder from ticks -------------------- */
function applyTickTo1s(cur, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s ?? 0);
  const tSec = toUnixSec(tick?.t);
  if (!Number.isFinite(price) || !Number.isFinite(tSec)) return cur;

  const sec = tSec; // 1s bucket

  if (!cur || cur.time < sec) {
    return { time: sec, open: price, high: price, low: price, close: price, volume: Number.isFinite(size) ? size : 0 };
  }

  if (cur.time !== sec) return cur;

  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

/* -------------------- Decision helpers -------------------- */
function isKillSwitchOn() {
  return engine5bState.risk.killSwitch === true;
}

function inCooldown() {
  const until = engine5bState.sm.cooldownUntilMs;
  return until != null && Date.now() < until;
}

function stageSet(newStage) {
  engine5bState.sm.stage = newStage;
  engine5bState.sm.lastDecision = `${nowUtc()} stage=${newStage}`;
}

function resetOutsideCount() {
  engine5bState.sm.outsideCount = 0;
}

function isArmedRecent() {
  const t = engine5bState.sm.armedAtMs;
  if (!t) return false;
  return Date.now() - t <= engine5bState.config.armedWindowMs;
}

function breakoutCheck(closePx) {
  const { lo, hi } = engine5bState.zone;
  if (!Number.isFinite(closePx) || lo == null || hi == null) return { outside: false, dir: null };

  const breakoutPts = Number(engine5bState.config.breakoutPts || 0.02);

  // long-only v1
  if (engine5bState.config.longOnly) {
    const outside = closePx > (Number(hi) + breakoutPts);
    return { outside, dir: outside ? "LONG" : null };
  }

  // future: allow shorts
  const up = closePx > (Number(hi) + breakoutPts);
  const dn = closePx < (Number(lo) - breakoutPts);
  if (up) return { outside: true, dir: "LONG" };
  if (dn) return { outside: true, dir: "SHORT" };
  return { outside: false, dir: null };
}

/* -------------------- Engine calls -------------------- */
async function refreshZone() {
  const url = `${BACKEND1_BASE}/api/v1/engine5-context?symbol=SPY&tf=10m`;
  const ctx = await jget(url);
  const z = pickZoneFromEngine1Context(ctx);
  engine5bState.zone = { ...engine5bState.zone, ...z, refreshedAtUtc: nowUtc() };
}

async function refreshRisk() {
  const url = `${BACKEND1_BASE}/api/v1/risk/status`;
  const j = await jget(url);
  engine5bState.risk = { killSwitch: j?.killSwitch ?? null, updatedAtUtc: nowUtc(), raw: j };
}

async function refreshE3() {
  const { lo, hi } = engine5bState.zone;
  if (lo == null || hi == null) return;

  const url =
    `${BACKEND1_BASE}/api/v1/reaction-score` +
    `?symbol=SPY&tf=10m&strategyId=intraday_scalp@10m&lo=${encodeURIComponent(lo)}&hi=${encodeURIComponent(hi)}`;

  const j = await jget(url);

  engine5bState.e3 = {
    ok: true,
    stage: String(j?.stage || "IDLE").toUpperCase(),
    armed: j?.armed === true,
    reactionScore: Number(j?.reactionScore ?? 0),
    updatedAtUtc: nowUtc(),
    raw: j,
  };

  // update state machine base stage
  const stage = engine5bState.e3.stage;

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
  const { lo, hi } = engine5bState.zone;
  if (lo == null || hi == null) return;

  const url =
    `${BACKEND1_BASE}/api/v1/volume-behavior` +
    `?symbol=SPY&tf=1m&zoneLo=${encodeURIComponent(lo)}&zoneHi=${encodeURIComponent(hi)}&mode=scalp`;

  const j = await jget(url);

  engine5bState.e4 = {
    ok: true,
    volumeScore: Number(j?.volumeScore ?? 0),
    volumeConfirmed: j?.volumeConfirmed === true,
    liquidityTrap: j?.flags?.liquidityTrap === true,
    updatedAtUtc: nowUtc(),
    raw: j,
  };
}

async function tryExecutePaper(dir, barTimeSec) {
  // Safety: monitor-only by default
  if (!engine5bState.config.executeEnabled) return { ok: false, skipped: true, reason: "EXECUTE_DISABLED" };
  if (isKillSwitchOn()) return { ok: false, skipped: true, reason: "KILL_SWITCH" };

  // Engine4 blocks
  if (engine5bState.e4.liquidityTrap) return { ok: false, skipped: true, reason: "E4_LIQUIDITY_TRAP" };
  if ((engine5bState.e4.volumeScore ?? 0) < 7) return { ok: false, skipped: true, reason: "E4_VOLUME_SCORE_LT_7" };

  const idempotencyKey = `SPY|intraday_scalp@10m|${dir}|${barTimeSec}`;

  const body = {
    idempotencyKey,
    symbol: "SPY",
    strategyId: "intraday_scalp@10m",
    side: "ENTRY",
    engine6: { permission: "ALLOW" },     // NOTE: we will wire Engine 6 next; monitor-first keeps execute disabled
    engine7: { finalR: 0.1 },             // safe tiny default; later wire real Engine 7
    assetType: "EQUITY",
    paper: true,
    engine5: { bias: dir === "LONG" ? "long" : "short" },
  };

  const url = `${BACKEND1_BASE}/api/trading/execute`;
  const j = await jpost(url, body);

  return j;
}

/* -------------------- Core loop -------------------- */
export function startEngine5B({ log = console.log } = {}) {
  const KEY = resolvePolygonKey();
  if (!KEY) {
    log("[engine5b] Missing POLYGON_API_KEY — not started");
    return { stop() {} };
  }

  // config from env (safe defaults)
  engine5bState.config.executeEnabled = String(process.env.ENGINE5B_EXECUTE_PAPER || "0") === "1";
  engine5bState.config.mode = engine5bState.config.executeEnabled ? "paper" : "monitor";
  engine5bState.config.longOnly = String(process.env.ENGINE5B_LONG_ONLY || "1") === "1";

  log(`[engine5b] starting mode=${engine5bState.config.mode} execute=${engine5bState.config.executeEnabled}`);

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

  async function safe(fn, label) {
    try { await fn(); }
    catch (e) { log(`[engine5b] ${label} error: ${e?.message || e}`); }
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

        engine5bState.lastTick = { t: ev.t, p: ev.p, s: ev.s, updatedAtUtc: nowUtc() };

        const updated = applyTickTo1s(cur1s, ev);
        cur1s = updated;

        const sec = cur1s?.time;
        if (!sec) continue;

        // close a 1s bar when we move to next second
        if (lastClosedSec == null) lastClosedSec = sec;

        if (sec !== lastClosedSec) {
          // we "closed" the previous bar
          const closedBar = { ...engine5bState.lastBar1s, ...(cur1s ? { } : {}) };
          engine5bState.lastBar1s = { ...cur1s, closedAtUtc: nowUtc() };

          // decision only on bar close
          const closePx = Number(cur1s?.close);
          const { outside, dir } = breakoutCheck(closePx);

          if (engine5bState.sm.stage === "ARMED" && isArmedRecent() && !inCooldown()) {
            if (outside) engine5bState.sm.outsideCount += 1;
            else resetOutsideCount();

            if (engine5bState.sm.outsideCount >= engine5bState.config.persistBars) {
              stageSet("TRIGGERED");
              engine5bState.sm.triggeredAtMs = Date.now();

              // try execute (paper) if enabled
              const result = await (async () => {
                try { return await tryExecutePaper(dir || "LONG", sec); }
                catch (e) { return { ok: false, error: String(e?.message || e) }; }
              })();

              engine5bState.sm.lastDecision = `${nowUtc()} TRIGGERED outside=${engine5bState.sm.outsideCount} exec=${JSON.stringify(result).slice(0,200)}`;

              // cooldown always (even if execute disabled) to prevent spam
              engine5bState.sm.cooldownUntilMs = Date.now() + engine5bState.config.cooldownMs;
              stageSet("COOLDOWN");
              resetOutsideCount();
            }
          }

          // If kill switch, force IDLE
          if (isKillSwitchOn()) {
            stageSet("IDLE");
            engine5bState.sm.armedAtMs = null;
            engine5bState.sm.triggeredAtMs = null;
            engine5bState.sm.cooldownUntilMs = null;
            resetOutsideCount();
          }

          // cooldown expiry
          if (engine5bState.sm.stage === "COOLDOWN" && !inCooldown()) {
            stageSet("IDLE");
            engine5bState.sm.armedAtMs = null;
            engine5bState.sm.triggeredAtMs = null;
            engine5bState.sm.cooldownUntilMs = null;
            resetOutsideCount();
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
      try { ws.close(); } catch {}
    });
  }

  connectWs();

  return {
    stop() {
      stopped = true;
      try { ws?.close?.(); } catch {}
      if (zoneTimer) clearInterval(zoneTimer);
      if (riskTimer) clearInterval(riskTimer);
      if (e3Timer) clearInterval(e3Timer);
      if (e4Timer) clearInterval(e4Timer);
      log("[engine5b] stopped");
    },
  };
}
