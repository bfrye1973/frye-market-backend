// services/core/routes/replay.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fsp from "fs/promises";

import {
  listDates,
  listTimes,
  readJson,
  snapshotPath,
  eventsPath,
} from "../logic/replay/replayStore.js";

import { buildReplaySnapshot } from "../logic/replay/snapshotBuilder.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "..", "data");

// ---------- helpers ----------
const AZ_TZ = "America/Phoenix";

function azParts(d = new Date()) {
  // Returns { dateYmd: 'YYYY-MM-DD', timeHHMM: 'HHMM', timeHHMMSS: 'HHMMSS' } in AZ
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const Y = get("year");
  const M = get("month");
  const D = get("day");
  const h = get("hour");
  const m = get("minute");
  const s = get("second");
  return {
    dateYmd: `${Y}-${M}-${D}`,
    timeHHMM: `${h}${m}`,
    timeHHMMSS: `${h}${m}${s}`,
  };
}

function coreBase() {
  // Prefer explicit CORE_BASE_URL. Otherwise use localhost.
  const p = Number(process.env.PORT) || 8080;
  return (
    process.env.CORE_BASE_URL ||
    process.env.CORE_BASE ||
    `http://127.0.0.1:${p}`
  ).replace(/\/+$/, "");
}

async function jget(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", "Cache-Control": "no-store" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await r.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!r.ok) {
      const msg =
        json?.error ||
        json?.detail ||
        text.slice(0, 200) ||
        `GET ${url} -> ${r.status}`;
      throw new Error(msg);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function ensureDirSync(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function replayDayDir(dataDir, dateYmd) {
  return path.join(dataDir, "replay", dateYmd);
}

function goSnapshotFile(dataDir, dateYmd, timeHHMMSS) {
  // e.g. HHMMSS_GO.json
  return path.join(replayDayDir(dataDir, dateYmd), `${timeHHMMSS}_GO.json`);
}

function goLedgerPath(dataDir, dateYmd) {
  return path.join(replayDayDir(dataDir, dateYmd), `go-ledger.json`);
}

function clampInt(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(x)));
}

function isIso(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T/.test(s);
}

function normalizeStrategyId(s) {
  const x = String(s || "").trim();
  return x || "unknown_strategy";
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * ✅ UPDATED: Engine score extraction mapping
 * Engine 5 confluence returns:
 *   decision.scores.engine1..engine4 and decision.scores.total, decision.scores.label
 * We also keep fallbacks for older e1/e2/e3/e4 shapes.
 */
function summarizeEngineScores(snapshot) {
  // Best-effort summary. Don’t crash if fields change.
  const d = snapshot?.decision || {};
  const scores = d?.scores || {};
  const ctx = d?.context || {};

  const total = safeNum(scores?.total);
  const label = scores?.label || null;

  // ✅ Prefer canonical confluence keys first, then fallback keys
  const e1 =
    safeNum(scores?.engine1) ??
    safeNum(scores?.e1) ??
    safeNum(scores?.components?.engine1) ??
    safeNum(scores?.components?.e1) ??
    safeNum(scores?.breakdown?.engine1) ??
    safeNum(scores?.breakdown?.e1) ??
    null;

  const e2 =
    safeNum(scores?.engine2) ??
    safeNum(scores?.e2) ??
    safeNum(scores?.components?.engine2) ??
    safeNum(scores?.components?.e2) ??
    safeNum(scores?.breakdown?.engine2) ??
    safeNum(scores?.breakdown?.e2) ??
    null;

  const e3 =
    safeNum(scores?.engine3) ??
    safeNum(scores?.e3) ??
    safeNum(scores?.components?.engine3) ??
    safeNum(scores?.components?.e3) ??
    safeNum(scores?.breakdown?.engine3) ??
    safeNum(scores?.breakdown?.e3) ??
    null;

  const e4 =
    safeNum(scores?.engine4) ??
    safeNum(scores?.e4) ??
    safeNum(scores?.components?.engine4) ??
    safeNum(scores?.components?.e4) ??
    safeNum(scores?.breakdown?.engine4) ??
    safeNum(scores?.breakdown?.e4) ??
    null;

  // fibScore usually lives on node.engine2 in dashboard-snapshot, but replay snapshot fib is full payload.
  const fibScore =
    safeNum(snapshot?.fib?.fibScore) ??
    safeNum(snapshot?.fib?.scores?.fibScore) ??
    null;

  const zoneId =
    d?.location?.zoneId ||
    ctx?.activeZone?.id ||
    ctx?.zone?.id ||
    snapshot?.structure?.smzHierarchy?.render?.active?.id ||
    null;

  return {
    engine1: e1,
    engine2: e2 ?? fibScore,
    engine3: e3,
    engine4: e4,
    engine5_total: total,
    label,
    refs: { zoneId },
  };
}

async function readOrInitArray(file) {
  const cur = readJson(file);
  return Array.isArray(cur) ? cur : [];
}

async function writeJsonAtomic(file, obj) {
  ensureDirSync(path.dirname(file));
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fsp.rename(tmp, file);
}

async function appendEvent(dataDir, dateYmd, eventObj) {
  const file = eventsPath(dataDir, dateYmd);
  const events = await readOrInitArray(file);
  events.push(eventObj);
  await writeJsonAtomic(file, events);
  return { file, count: events.length };
}

async function loadLedger(dataDir, dateYmd) {
  const file = goLedgerPath(dataDir, dateYmd);
  const j = readJson(file);
  return j && typeof j === "object" ? j : { lastByStrategy: {} };
}

async function saveLedger(dataDir, dateYmd, ledger) {
  const file = goLedgerPath(dataDir, dateYmd);
  await writeJsonAtomic(file, ledger);
  return file;
}

// ---------- existing read-only replay endpoints ----------
router.get("/replay/dates", (req, res) => {
  const dates = listDates(DATA_DIR);
  res.json({ ok: true, dates });
});

router.get("/replay/times", (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ ok: false, reason: "BAD_DATE", expected: "YYYY-MM-DD" });
  }
  const times = listTimes(DATA_DIR, date);
  res.json({ ok: true, date, times });
});

router.get("/replay/snapshot", (req, res) => {
  const date = String(req.query.date || "");
  const time = String(req.query.time || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ ok: false, reason: "BAD_DATE", expected: "YYYY-MM-DD" });
  }
  if (!/^\d{4}$/.test(time)) {
    return res
      .status(400)
      .json({ ok: false, reason: "BAD_TIME", expected: "HHMM" });
  }
  const file = snapshotPath(DATA_DIR, date, time);
  const snap = readJson(file);
  if (!snap)
    return res
      .status(404)
      .json({ ok: false, reason: "NOT_FOUND", date, time });
  res.json(snap);
});

router.get("/replay/events", (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ ok: false, reason: "BAD_DATE", expected: "YYYY-MM-DD" });
  }
  const file = eventsPath(DATA_DIR, date);
  const events = readJson(file);
  res.json({ ok: true, date, events: Array.isArray(events) ? events : [] });
});

// ---------- NEW: record GO snapshot + event ----------
//
// POST /api/v1/replay/record-go
//
// Body (minimal):
// {
//   "symbol": "SPY",
//   "strategyId": "intraday_scalp@10m",
//   "direction": "LONG",
//   "triggerType": "PULLBACK_RECLAIM",
//   "triggerLine": 682.30,
//   "price": 682.25,
//   "atUtc": "2026-02-12T22:33:10.525Z",
//   "cooldownUntilMs": 1770935710000,
//   "reasonCodes": ["PB_RECLAIM","E3_ARMED","E4_OK"]
// }
//
// If fields are missing, we will attempt to fetch scalp-status for GO payload (for scalp strategy).
//
router.post("/replay/record-go", async (req, res) => {
  try {
    const body = req.body || {};
    const symbol = String(body.symbol || "SPY").toUpperCase();
    const strategyId = normalizeStrategyId(
      body.strategyId || "intraday_scalp@10m"
    );

    // Determine AZ day/time
    const { dateYmd, timeHHMM, timeHHMMSS } = azParts(new Date());

    const dayDir = replayDayDir(DATA_DIR, dateYmd);
    ensureDirSync(dayDir);

    // Dedupe/rate limit
    const minIntervalSec = clampInt(
      process.env.REPLAY_GO_MIN_INTERVAL_SEC || 20,
      5,
      600
    );
    const ledger = await loadLedger(DATA_DIR, dateYmd);
    ledger.lastByStrategy = ledger.lastByStrategy || {};

    const nowMs = Date.now();
    const last = ledger.lastByStrategy[strategyId] || {};
    const lastSentMs = Number(last.lastSentMs || 0);
    if (lastSentMs && nowMs - lastSentMs < minIntervalSec * 1000) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "RATE_LIMIT",
        minIntervalSec,
      });
    }

    // If no go payload provided, attempt to pull scalp-status (works for scalp)
    let go = {
      signal: true,
      direction: String(body.direction || "").toUpperCase() || null,
      triggerType: body.triggerType || null,
      triggerLine: safeNum(body.triggerLine),
      atUtc: isIso(body.atUtc) ? body.atUtc : new Date().toISOString(),
      price: safeNum(body.price),
      reason: body.reason || null,
      reasonCodes: Array.isArray(body.reasonCodes) ? body.reasonCodes : [],
      cooldownUntilMs: Number.isFinite(Number(body.cooldownUntilMs))
        ? Number(body.cooldownUntilMs)
        : null,
    };

    if (!go.direction || !go.triggerType) {
      // try to hydrate from scalp-status proxy if this is scalp strategy
      const cb = coreBase();
      const scalp = await jget(`${cb}/api/v1/scalp-status`, {
        timeoutMs: 8000,
      }).catch(() => null);
      const sg = scalp?.go || null;
      if (sg && sg.signal === true) {
        go = {
          signal: true,
          direction: String(sg.direction || "").toUpperCase() || go.direction,
          triggerType: sg.triggerType || go.triggerType,
          triggerLine: safeNum(sg.triggerLine) ?? go.triggerLine,
          atUtc: isIso(sg.atUtc) ? sg.atUtc : go.atUtc,
          price: safeNum(sg.price) ?? go.price,
          reason: sg.reason || go.reason,
          reasonCodes: Array.isArray(sg.reasonCodes)
            ? sg.reasonCodes
            : go.reasonCodes,
          cooldownUntilMs: Number.isFinite(Number(sg.cooldownUntilMs))
            ? Number(sg.cooldownUntilMs)
            : go.cooldownUntilMs,
        };
      }
    }

    // Dedupe by go.atUtc (or fallback to HHMMSS) per strategy
    const goKey = `${symbol}|${strategyId}|${go.direction || "—"}|${
      go.atUtc || timeHHMMSS
    }`;
    if (last.lastGoKey && last.lastGoKey === goKey) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "DUPLICATE_GO_KEY",
        goKey,
      });
    }

    // Build snapshot (reuse snapshotBuilder)
    const cb = coreBase();
    const smzHierUrl = process.env.REPLAY_SMZ_HIER_URL || `${cb}/api/v1/smz-hierarchy`;
    const fibUrl =
      process.env.REPLAY_FIB_URL ||
      `${cb}/api/v1/fib-levels?symbol=${symbol}&tf=1h&degree=minor&wave=W1`;

    // Decision source: default to confluence-score for scalp; can be overridden by env
    const decisionUrl =
      process.env.REPLAY_DECISION_URL ||
      `${cb}/api/v1/confluence-score?symbol=${encodeURIComponent(
        symbol
      )}&tf=10m&degree=minute&wave=W1&strategyId=${encodeURIComponent(
        strategyId
      )}`;

    const permissionUrl = process.env.REPLAY_PERMISSION_URL || null;

    const snapshot = await buildReplaySnapshot({
      dataDir: DATA_DIR,
      symbol,
      smzHierarchyUrl: smzHierUrl,
      fibUrl,
      decisionUrl,
      permissionUrl,
    });

    // Add meta (schema lock)
    snapshot.meta = {
      schemaVersion: 1,
      source: "GO_EVENT",
      symbol,
      strategyId,
      tsUtc: go.atUtc || new Date().toISOString(),
      tradingDayAz: dateYmd,
    };

    // Write GO snapshot file (HHMMSS_GO.json)
    const snapFile = goSnapshotFile(DATA_DIR, dateYmd, timeHHMMSS);
    await writeJsonAtomic(snapFile, snapshot);

    // Summarize engine scores
    const summary = summarizeEngineScores(snapshot);

    // Event record (locked contract + pointers)
    const event = {
      tsUtc: go.atUtc || new Date().toISOString(),
      type: "GO_SIGNAL",
      symbol,
      strategyId,
      direction: go.direction,
      triggerType: go.triggerType,
      triggerLine: go.triggerLine,
      price: go.price,
      cooldownUntilMs: go.cooldownUntilMs || 0,
      reason: go.reason || null,
      reasonCodes: go.reasonCodes || [],
      engineScores: {
        engine1: summary.engine1,
        engine2: summary.engine2,
        engine3: summary.engine3,
        engine4: summary.engine4,
        engine5_total: summary.engine5_total,
        label: summary.label,
      },
      refs: {
        zoneId: summary.refs?.zoneId || null,
      },
      snapshotFile: path.basename(snapFile),
      timeHHMM, // useful for UI grouping
    };

    const appended = await appendEvent(DATA_DIR, dateYmd, event);

    // Update ledger
    ledger.lastByStrategy[strategyId] = {
      lastGoKey: goKey,
      lastSentMs: nowMs,
      lastGoAtUtc: event.tsUtc,
      snapshotFile: event.snapshotFile,
    };
    const ledgerFile = await saveLedger(DATA_DIR, dateYmd, ledger);

    return res.json({
      ok: true,
      dateYmd,
      timeHHMM,
      timeHHMMSS,
      snapshotFile: snapFile,
      eventsFile: appended.file,
      eventsCount: appended.count,
      ledgerFile,
      goKey,
      event,
    });
  } catch (e) {
    console.error("[replay/record-go] failed:", e?.stack || e);
    return res.status(500).json({
      ok: false,
      error: "record_go_failed",
      detail: String(e?.message || e),
    });
  }
});

export default router;
