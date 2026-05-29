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
  dayDir as replayDayDir,
} from "../logic/replay/replayStore.js";

import { buildReplaySnapshot } from "../logic/replay/snapshotBuilder.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "..", "data");

// ---------- helpers ----------
const AZ_TZ = "America/Phoenix";

function azParts(d = new Date()) {
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

function dayPath(dataDir, dateYmd) {
  return replayDayDir(dataDir, dateYmd);
}

function goSnapshotFile(dataDir, dateYmd, timeHHMMSS) {
  return path.join(dayPath(dataDir, dateYmd), `${timeHHMMSS}_GO.json`);
}

function goLedgerPath(dataDir, dateYmd) {
  return path.join(dayPath(dataDir, dateYmd), "go-ledger.json");
}

function esReplayRoot(dataDir) {
  return path.join(dayPath(dataDir, "__dummy__"), "..", "es");
}

function esReplayDayDir(dataDir, dateYmd) {
  return path.join(esReplayRoot(dataDir), dateYmd);
}

function esReplaySnapshotPath(dataDir, dateYmd, timeHHMM) {
  return path.join(esReplayDayDir(dataDir, dateYmd), `${timeHHMM}.json`);
}

function listEsReplayTimes(dataDir, dateYmd) {
  const dir = esReplayDayDir(dataDir, dateYmd);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => f.name)
    .filter((n) => /^\d{4}\.json$/.test(n))
    .map((n) => n.replace(".json", ""))
    .sort();
}

function pickStrategyNodeFromReplaySnapshot(snap) {
  return (
    snap?.strategy ||
    snap?.snapshot?.strategies?.["intraday_scalp@10m"] ||
    snap?.strategies?.["intraday_scalp@10m"] ||
    {}
  );
}

function pickWaveOpportunity(strategy) {
  return (
    strategy?.waveOpportunity ||
    strategy?.engine22WaveStrategy?.waveOpportunity ||
    null
  );
}

function compactEngine5(strategy) {
  const confluence = strategy?.confluence || null;
  const engine5 = strategy?.engine5 || null;

  const reaction =
    confluence?.components?.engine3Reaction ||
    engine5?.reactionComponent ||
    null;

  const volume =
    confluence?.components?.engine4Volume ||
    engine5?.volumeComponent ||
    null;

  const timing =
    confluence?.timingContext ||
    engine5?.timingContext ||
    null;

  return {
    score: confluence?.score ?? engine5?.score ?? null,
    label: confluence?.label ?? engine5?.label ?? null,

    reactionConfirmed:
      reaction?.confirmed ??
      reaction?.cleanReaction ??
      null,

    reactionQuality:
      reaction?.quality ??
      reaction?.stage ??
      reaction?.state ??
      null,

    volumeClean:
      volume?.cleanParticipation ??
      volume?.confirmed ??
      null,

    volumeQuality:
      volume?.participationQuality ??
      volume?.quality ??
      volume?.state ??
      null,

    timingEntry:
      timing?.entryTiming ??
      engine5?.timingEntry ??
      null,

    chaseRisk:
      timing?.chaseRisk ??
      engine5?.timingChaseRisk ??
      null,

    suggestedAction:
      timing?.suggestedAction ??
      engine5?.timingAction ??
      null,
  };
}

function buildEsReplayDecisionSummary(snap, { date, time, file } = {}) {
  const strategy = pickStrategyNodeFromReplaySnapshot(snap);
  const wave = pickWaveOpportunity(strategy);
  const engine16 = strategy?.engine16 || null;
  const engine15 = strategy?.engine15Decision || null;
  const permission = strategy?.permission || null;

  const price =
    wave?.currentPrice ??
    strategy?.engine22WaveStrategy?.currentPrice ??
    engine16?.regimeLayers?.trigger10m?.close ??
    null;

  const executable = permission?.executable === true;
  const action = engine15?.action || engine15?.readinessLabel || "UNKNOWN";
  const direction =
    engine15?.direction ||
    wave?.direction ||
    engine16?.directionBias ||
    null;

  const headline = wave
    ? `${String(wave.degree || "wave").toUpperCase()} ${wave.setupType || "W3/W5"} ${engine15?.readinessLabel || wave.readiness || "WATCH"}`
    : "NO VALID W3/W5 OPPORTUNITY";

  const reason =
    engine15?.summary ||
    wave?.summary ||
    (executable
      ? "Execution allowed."
      : "No execution allowed from compact replay summary.");

  return {
    ok: true,
    source: "es_replay_decision_summary.v1",
    symbol: "ES",
    date,
    time,
    file,
    price,

    decision: {
      headline,
      action,
      direction,
      executable,
      reason,
    },

    engine16: {
      readiness: engine16?.readiness ?? null,
      setupPosture: engine16?.setupPosture ?? null,
      directionBias: engine16?.directionBias ?? null,
      needs: Array.isArray(engine16?.needs) ? engine16.needs : [],
      reasonCodes: Array.isArray(engine16?.reasonCodes)
        ? engine16.reasonCodes
        : [],
    },

    waveOpportunity: {
      active: wave?.active ?? null,
      setupType: wave?.setupType ?? null,
      rawSetup: wave?.rawSetup ?? null,
      degree: wave?.degree ?? null,
      direction: wave?.direction ?? null,
      readiness: wave?.readiness ?? null,
      timing: wave?.timing ?? null,
      chaseRisk: wave?.chaseRisk ?? null,
      currentPrice: wave?.currentPrice ?? null,
      entryZone: wave?.entryZone ?? null,
      invalidation: wave?.invalidation ?? null,
      targets: wave?.targets ?? null,
      needs: Array.isArray(wave?.needs) ? wave.needs : [],
      summary: wave?.summary ?? null,
    },

    engine15: {
      strategyType: engine15?.strategyType ?? null,
      direction: engine15?.direction ?? null,
      readinessLabel: engine15?.readinessLabel ?? null,
      action: engine15?.action ?? null,
      qualityScore: engine15?.qualityScore ?? null,
      qualityBand: engine15?.qualityBand ?? null,
      needs: Array.isArray(engine15?.needs) ? engine15.needs : [],
      reasonCodes: Array.isArray(engine15?.reasonCodes)
        ? engine15.reasonCodes
        : [],
      summary: engine15?.summary ?? null,
    },

    engine5: compactEngine5(strategy),

    permission: {
      permission: permission?.permission ?? null,
      executable: permission?.executable ?? null,
      watchOnly: permission?.watchOnly ?? null,
      sizeMultiplier: permission?.sizeMultiplier ?? null,
      reasonCodes: Array.isArray(permission?.reasonCodes)
        ? permission.reasonCodes
        : [],
    },
  };
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

function summarizeEngineScores(snapshot) {
  const d = snapshot?.decision || {};
  const scores = d?.scores || {};
  const ctx = d?.context || {};

  const total = safeNum(scores?.total);
  const label = scores?.label || null;

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

// ---------- existing SPY replay read-only endpoints ----------
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

  if (!snap) {
    return res
      .status(404)
      .json({ ok: false, reason: "NOT_FOUND", date, time });
  }

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

// ---------- ES replay read-only endpoints ----------
router.get("/replay/es/times", (req, res) => {
  const date = String(req.query.date || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ ok: false, reason: "BAD_DATE", expected: "YYYY-MM-DD" });
  }

  const times = listEsReplayTimes(DATA_DIR, date);

  res.json({
    ok: true,
    symbol: "ES",
    date,
    times,
  });
});

router.get("/replay/es/snapshot", (req, res) => {
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

  const file = esReplaySnapshotPath(DATA_DIR, date, time);
  const snap = readJson(file);

  if (!snap) {
    return res.status(404).json({
      ok: false,
      reason: "NOT_FOUND",
      symbol: "ES",
      date,
      time,
      file,
    });
  }

  res.json(snap);
});

router.get("/replay/es/decision-summary", (req, res) => {
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

  const file = esReplaySnapshotPath(DATA_DIR, date, time);
  const snap = readJson(file);

  if (!snap) {
    return res.status(404).json({
      ok: false,
      reason: "NOT_FOUND",
      symbol: "ES",
      date,
      time,
      file,
    });
  }

  const summary = buildEsReplayDecisionSummary(snap, {
    date,
    time,
    file,
  });

  res.json(summary);
});

// ---------- record GO snapshot + event ----------
router.post("/replay/record-go", async (req, res) => {
  try {
    const body = req.body || {};
    const symbol = String(body.symbol || "SPY").toUpperCase();
    const strategyId = normalizeStrategyId(
      body.strategyId || "intraday_scalp@10m"
    );

    const { dateYmd, timeHHMM, timeHHMMSS } = azParts(new Date());

    const dayDirPath = dayPath(DATA_DIR, dateYmd);
    ensureDirSync(dayDirPath);

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

    const cb = coreBase();

    const smzHierUrl =
      process.env.REPLAY_SMZ_HIER_URL || `${cb}/api/v1/smz-hierarchy`;

    const fibUrl =
      process.env.REPLAY_FIB_URL ||
      `${cb}/api/v1/fib-levels?symbol=${symbol}&tf=1h&degree=minor&wave=W1`;

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
      smzHierarchyUrl,
      fibUrl,
      decisionUrl,
      permissionUrl,
    });

    snapshot.meta = {
      schemaVersion: 1,
      source: "GO_EVENT",
      symbol,
      strategyId,
      tsUtc: go.atUtc || new Date().toISOString(),
      tradingDayAz: dateYmd,
    };

    const snapFile = goSnapshotFile(DATA_DIR, dateYmd, timeHHMMSS);
    await writeJsonAtomic(snapFile, snapshot);

    const summary = summarizeEngineScores(snapshot);

    const event = {
      tsUtc: go.atUtc || new Date().toISOString(),
      type: "GO_SIGNAL",
      goKey,
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
      timeHHMM,
    };

    const appended = await appendEvent(DATA_DIR, dateYmd, event);

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
