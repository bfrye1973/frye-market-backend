// services/core/logic/engine16D/engine16DRunner.js

import { maybeSendInstantTriggerAlert } from "../alerts/instantTriggerPushover.js";

const DEFAULT_BACKEND1_BASE =
  process.env.BACKEND1_BASE ||
  process.env.HIST_BASE ||
  "https://frye-market-backend-1.onrender.com";

const MIN_INTERVAL_MS = Number(process.env.ENGINE16D_INTERVAL_MS || 10000);
const DEFAULT_CONTRACTS = Number(process.env.ENGINE16D_CONTRACTS || 3);
const DEFAULT_OPTION_MIDPRICE = Number(
  process.env.ENGINE16D_OPTION_MIDPRICE || 1.85
);

let inFlight = false;
let lastStartedAtMs = 0;

function toFiniteNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePermission(permissionObj) {
  return String(permissionObj?.permission || "")
    .trim()
    .toUpperCase();
}

function normalizeDirection(decision) {
  const dir = String(decision?.direction || "")
    .trim()
    .toUpperCase();
  return dir === "LONG" || dir === "SHORT" ? dir : null;
}

function normalizeStrategyType(decision) {
  return String(decision?.strategyType || "")
    .trim()
    .toUpperCase();
}

function getLifecycleCurrentPrice(decision) {
  return toFiniteNumber(decision?.lifecycle?.currentPrice, null);
}

function resolveExhaustionTrigger(engine16) {
  const active = engine16?.exhaustionTrigger === true;
  if (!active) return null;

  const triggerTime =
    engine16?.signalTimes?.exhaustionTriggerTime ||
    engine16?.signalTimes?.exhaustionTime ||
    engine16?.exhaustionBarTime ||
    null;

  if (!triggerTime) return null;

  return {
    signalFamily: "EXHAUSTION",
    triggerTime: String(triggerTime),
    triggerPrice: toFiniteNumber(engine16?.exhaustionBarPrice, null),
  };
}

function resolveContinuationTrigger(engine16, decision) {
  const active = engine16?.continuationTrigger === true;
  if (!active) return null;

  const triggerTime = engine16?.signalTimes?.continuationTriggerTime || null;
  if (!triggerTime) return null;

  return {
    signalFamily: "CONTINUATION",
    triggerTime: String(triggerTime),
    triggerPrice: getLifecycleCurrentPrice(decision),
  };
}

function resolveTrigger(decision, engine16) {
  const strategyType = normalizeStrategyType(decision);

  if (strategyType === "EXHAUSTION") {
    return resolveExhaustionTrigger(engine16);
  }

  if (strategyType === "CONTINUATION") {
    return resolveContinuationTrigger(engine16, decision);
  }

  // Safe fallback only if upstream strategyType is absent/unexpected.
  return (
    resolveExhaustionTrigger(engine16) ||
    resolveContinuationTrigger(engine16, decision) ||
    null
  );
}

async function jget(url) {
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  const j = await r.json().catch(() => null);

  if (!r.ok) {
    throw new Error(
      `GET ${url} -> ${r.status} ${(j && JSON.stringify(j).slice(0, 300)) || ""}`
    );
  }

  return j;
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

  if (!r.ok && !j) {
    throw new Error(`POST ${url} -> ${r.status}`);
  }

  return j;
}

export async function runEngine16DBridge({
  backend1Base = DEFAULT_BACKEND1_BASE,
  log = console.log,
} = {}) {
  const nowMs = Date.now();

  if (inFlight) return { ok: true, skipped: true, reason: "IN_FLIGHT" };
  if (nowMs - lastStartedAtMs < MIN_INTERVAL_MS) {
    return { ok: true, skipped: true, reason: "THROTTLED" };
  }

  inFlight = true;
  lastStartedAtMs = nowMs;

  try {
    const snapshotUrl = `${backend1Base}/api/v1/dashboard-snapshot`;
    const snapshot = await jget(snapshotUrl);

    const strat = snapshot?.strategies?.["intraday_scalp@10m"];
    if (!strat) {
      return { ok: true, skipped: true, reason: "NO_INTRADAY_STRATEGY" };
    }

    const decision = strat.engine15Decision;
    const permissionObj = strat.permission;
    const engine16 = strat.engine16;

    if (!decision || !permissionObj || !engine16) {
      return { ok: true, skipped: true, reason: "MISSING_SNAPSHOT_FIELDS" };
    }

    if (String(decision?.action || "").toUpperCase() !== "GO") {
      return { ok: true, skipped: true, reason: "ACTION_NOT_GO" };
    }

    const permission = normalizePermission(permissionObj);
    if (permission === "STAND_DOWN") {
      return { ok: true, skipped: true, reason: "ENGINE6_STAND_DOWN" };
    }

    if (permission !== "ALLOW" && permission !== "REDUCE") {
      return { ok: true, skipped: true, reason: "PERMISSION_NOT_EXECUTABLE" };
    }

    const direction = normalizeDirection(decision);
    if (!direction) {
      return { ok: true, skipped: true, reason: "MISSING_DIRECTION" };
    }

    const trigger = resolveTrigger(decision, engine16);
    if (!trigger) {
      return { ok: true, skipped: true, reason: "NO_MATCHING_TRIGGER" };
    }

    const signalType = trigger.signalFamily;
    const triggerTime = trigger.triggerTime;
    const triggerPrice =
      toFiniteNumber(trigger.triggerPrice, null) ??
      getLifecycleCurrentPrice(decision);

    if (!triggerTime) {
      return { ok: true, skipped: true, reason: "MISSING_TRIGGER_TIME" };
    }

    const idempotencyKey = `AUTO|SPY|intraday_scalp@10m|${direction}|${triggerTime}`;

    const payload = {
      idempotencyKey,
      symbol: "SPY",
      strategyId: "intraday_scalp@10m",
      intent: "ENTRY",
      direction,
      assetType: "OPTION",
      contracts: DEFAULT_CONTRACTS,
      paper: true,
      signalEvent: {
        signalType,
        direction,
        signalTime: triggerTime,
        signalPrice: triggerPrice,
        signalSource: "ENGINE16D",
      },
      option: {
        midPrice: DEFAULT_OPTION_MIDPRICE,
      },
      engine6: {
        permission,
      },
      meta: {
        source: "engine16D",
        signalType,
        signalTime: triggerTime,
        permission,
        decisionAtUtc: nowIso(),
      },
    };

    const tradeUrl = `${backend1Base}/api/trading/execute`;
    const tradeResult = await jpost(tradeUrl, payload);

    if (!tradeResult?.ok || tradeResult?.rejected) {
      log("[engine16d] trade rejected", tradeResult);
      return {
        ok: false,
        rejected: true,
        reason: tradeResult?.reason || "TRADE_REJECTED",
        tradeResult,
      };
    }

    if (tradeResult?.duplicate === true) {
      log("[engine16d] duplicate trade replay", tradeResult?.idempotencyKey);
      return { ok: true, duplicate: true, tradeResult };
    }

    log(
      `[engine16d] trade executed orderId=${tradeResult?.orderId} signal=${signalType} dir=${direction} time=${triggerTime}`
    );

    const alertDedupeKey = `SPY|${signalType}|${direction}|${triggerTime}`;

    const alertResult = await maybeSendInstantTriggerAlert({
      symbol: "SPY",
      signalFamily: signalType,
      direction,
      triggerTime,
      triggerPrice,
      mode: permission,
      dedupeKey: alertDedupeKey,
      actionText: `ENTER ${direction}`,
      log,
    });

    return {
      ok: true,
      tradeResult,
      alertResult,
    };
  } catch (err) {
    log("[engine16d] error", err?.message || err);
    return {
      ok: false,
      rejected: true,
      reason: "ENGINE16D_ERROR",
      message: String(err?.message || err),
    };
  } finally {
    inFlight = false;
  }
}
