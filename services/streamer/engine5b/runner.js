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

/**
 * ✅ FIX: correct risk/killswitch source of truth
 * Engine 8 confirmed: GET /api/trading/status returns killSwitch
 */
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

async function tryExec
