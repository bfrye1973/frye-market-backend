// services/core/jobs/archiveEsReplaySnapshot.js
// Archives a slim ES replay snapshot from data/strategy-snapshot-es.json
// Writes to persistent replay storage: /var/data/replay/es/YYYY-MM-DD/HHMM.json
//
// This job does NOT recompute history.
// It only archives the latest stored ES strategy snapshot.
//
// Engine 26 Replay Marker V2:
// - If strategy.engine26ReplayMarker exists, append one compact line to:
//   /var/data/replay/es/markers/engine26-replay-markers.jsonl
// - This creates a searchable bookmark list for Engine 26 watch / research moments.
// - This does NOT create permission, execution, Engine 8 calls, Schwab calls, or journal entries.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const AZ_TZ = "America/Phoenix";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(CORE_DIR, "data");

const SOURCE_FILE = path.join(DATA_DIR, "strategy-snapshot-es.json");

// Use same persistent root as Replay Mode.
// REPLAY_DATA_DIR should be /var/data in Render.
const REPLAY_DATA_DIR = (process.env.REPLAY_DATA_DIR || DATA_DIR).trim().replace(/\/+$/, "");
const ES_REPLAY_ROOT = path.join(REPLAY_DATA_DIR, "replay", "es");
const ES_REPLAY_MARKER_DIR = path.join(ES_REPLAY_ROOT, "markers");
const ENGINE26_MARKER_INDEX_FILE = path.join(
  ES_REPLAY_MARKER_DIR,
  "engine26-replay-markers.jsonl"
);

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
    azTime: `${Y}-${M}-${D} ${h}:${m}:${s}`,
  };
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return {
      ok: false,
      error: "READ_JSON_FAILED",
      file,
      detail: String(err?.message || err),
    };
  }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function firstNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstArrayItems(value, limit = 8) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, limit) : [];
}

function slimEngine25(engine25Context) {
  if (!engine25Context || typeof engine25Context !== "object") return null;

  return {
    ok: engine25Context.ok === true,
    score: engine25Context.score ?? null,
    regime: engine25Context.regime ?? null,
    label: engine25Context.label ?? null,
    permission: engine25Context.permission ?? null,
    sizeMultiplier: engine25Context.sizeMultiplier ?? null,
    esPermission: engine25Context.esPermission ?? null,
    tradePermission: engine25Context.tradePermission ?? null,
    freshnessStatus: engine25Context.freshnessStatus ?? null,
    modelDate: engine25Context.modelDate ?? null,
    updatedAt: engine25Context.updatedAt ?? null,
    warnings: Array.isArray(engine25Context.warnings)
      ? engine25Context.warnings
      : [],
    summary: engine25Context.summary ?? null,
  };
}

function slimConfluence(confluence) {
  if (!confluence || typeof confluence !== "object") return null;

  return {
    ok: confluence.ok ?? null,
    invalid: confluence.invalid ?? null,
    tradeReady: confluence.tradeReady ?? null,
    bias: confluence.bias ?? null,
    price: confluence.price ?? null,

    location: confluence.location ?? null,

    scores: confluence.scores ?? null,
    flags: confluence.flags ?? null,

    timingContext: confluence.timingContext ?? null,

    context: {
      activeZone: confluence.context?.activeZone ?? null,
      reaction: confluence.context?.reaction ?? null,
      volume: confluence.context?.volume ?? null,
      fib: confluence.context?.fib ?? null,
      engine1: {
        meta: confluence.context?.engine1?.meta ?? null,
        active: confluence.context?.engine1?.active ?? null,
        nearest: confluence.context?.engine1?.nearest ?? null,
      },
    },
  };
}

function slimZones(strategy) {
  const ctx = strategy?.context || null;
  if (!ctx || typeof ctx !== "object") return null;

  return {
    meta: ctx.meta ?? null,
    active: ctx.active ?? null,
    nearest: ctx.nearest ?? null,
    render: {
      negotiated: Array.isArray(ctx.render?.negotiated)
        ? ctx.render.negotiated
        : [],
      institutional: Array.isArray(ctx.render?.institutional)
        ? ctx.render.institutional
        : [],
      shelves: Array.isArray(ctx.render?.shelves)
        ? ctx.render.shelves
        : [],
    },
  };
}

function buildSlimEsReplaySnapshot(source, parts) {
  const strategy = source?.strategies?.["intraday_scalp@10m"] || {};

  const price = firstNumber(
    strategy?.confluence?.price,
    strategy?.context?.meta?.current_price,
    strategy?.context?.meta?.currentPrice,
    strategy?.engine22WaveStrategy?.currentPrice,
    strategy?.engine16?.regimeLayers?.trigger10m?.close
  );

  const generatedAtUtc = new Date().toISOString();

  return {
    ok: true,
    schema: "es-replay-snapshot@v1",
    symbol: "ES",

    dateYmd: parts.dateYmd,
    timeHHMM: parts.timeHHMM,
    timeHHMMSS: parts.timeHHMMSS,

    timezone: AZ_TZ,
    azTime: parts.azTime,
    generatedAtUtc,

    sourceFile: "data/strategy-snapshot-es.json",

    price,
    currentPrice: price,

    marketRegime: source?.marketRegime ?? null,
    marketMeter: {
      score10m: source?.marketMind?.score10m ?? null,
      score30m: source?.marketMind?.score30m ?? null,
      score1h: source?.marketMind?.score1h ?? null,
      score4h: source?.marketMind?.score4h ?? null,
      scoreEOD: source?.marketMind?.scoreEOD ?? null,
      state10m: source?.marketMind?.state10m ?? null,
      state30m: source?.marketMind?.state30m ?? null,
      state1h: source?.marketMind?.state1h ?? null,
      state4h: source?.marketMind?.state4h ?? null,
      stateEOD: source?.marketMind?.stateEOD ?? null,
    },

    engine25Context: slimEngine25(
      source?.engine25Context ?? strategy?.engine25Context ?? null
    ),

    strategy: {
      strategyId: "intraday_scalp@10m",
      tf: strategy?.tf ?? "10m",
      degree: strategy?.degree ?? "minute",
      wave: strategy?.wave ?? "W1",

      executionBias: strategy?.executionBias ?? null,

      engine22WaveStrategy: strategy?.engine22WaveStrategy ?? null,
      waveOpportunity: strategy?.engine22WaveStrategy?.waveOpportunity ?? null,

      engine16: strategy?.engine16 ?? null,
      regimeLayers: strategy?.engine16?.regimeLayers ?? null,

      engine15: strategy?.engine15 ?? null,
      engine15Decision: strategy?.engine15Decision ?? null,

      permission: strategy?.permission ?? null,
      permissionPreliminary: strategy?.permissionPreliminary ?? null,

      engine26ReplayMarker: strategy?.engine26ReplayMarker ?? null,

      confluence: slimConfluence(strategy?.confluence ?? null),
      zones: slimZones(strategy),

      momentum: strategy?.momentum ?? source?.momentum ?? null,

      engine23Interpretation: strategy?.engine23Interpretation ?? null,
      aiTradeCopilot: strategy?.aiTradeCopilot ?? null,
    },
  };
}

function markerIndexEntryFromReplaySnapshot(replaySnapshot, outFile) {
  const marker = replaySnapshot?.strategy?.engine26ReplayMarker || null;

  if (!marker || marker.active !== true) return null;

  return {
    schema: "engine26-replay-marker-index@v1",

    symbol: marker.symbol || replaySnapshot?.symbol || "ES",
    strategyId: marker.strategyId || "intraday_scalp@10m",

    dateYmd: marker.dateYmd || replaySnapshot?.dateYmd || null,
    timeHHMM: marker.timeHHMM || replaySnapshot?.timeHHMM || null,
    replayApiTime:
      marker.replayApiTime ||
      marker.timeHHMM ||
      replaySnapshot?.timeHHMM ||
      null,

    azTime: replaySnapshot?.azTime || null,
    generatedAtUtc: replaySnapshot?.generatedAtUtc || null,
    indexedAtUtc: new Date().toISOString(),

    markerType: marker.markerType || null,
    status: marker.status || null,
    template: marker.template || null,
    setupType: marker.setupType || null,
    direction: marker.direction || null,
    preferredAction: marker.preferredAction || null,

    currentPrice: marker.currentPrice ?? replaySnapshot?.currentPrice ?? null,

    activeImbalanceRole: marker.activeImbalanceRole || null,
    structuralBias: marker.structuralBias || null,

    shortResearchOnly: marker.shortResearchOnly === true,
    doNotChaseLong: marker.doNotChaseLong === true,
    watchOnly: marker.watchOnly === true,

    zone: marker.zone || null,

    engine3: marker.engine3 || null,
    engine4: marker.engine4 || null,
    engine15: marker.engine15 || null,
    engine6: marker.engine6 || null,

    engine6Decision: marker.engine6?.decision || null,
    engine6Allowed: marker.engine6?.allowed === true,
    engine4State: marker.engine4?.state || null,
    engine4Allowed: marker.engine4?.allowed === true,
    engine4HardBlocked: marker.engine4?.hardBlocked === true,
    engine3State: marker.engine3?.state || null,
    engine3Direction: marker.engine3?.direction || null,
    engine15Readiness: marker.engine15?.readiness || null,

    ticketCreated: marker.ticket?.created === true,
    executionCreated: marker.execution?.created === true,

    replayPath: marker.replayPath || outFile,
    replayFile: outFile,

    dedupeKey:
      marker.dedupeKey ||
      [
        marker.symbol || "ES",
        marker.dateYmd || replaySnapshot?.dateYmd || "UNKNOWN_DATE",
        marker.timeHHMM || replaySnapshot?.timeHHMM || "UNKNOWN_TIME",
        marker.markerType || "UNKNOWN_MARKER",
        marker.status || "UNKNOWN_STATUS",
        marker.engine6?.decision || "UNKNOWN_ENGINE6_DECISION",
      ].join("|"),

    reasonCodes: firstArrayItems(marker.reasonCodes, 20),
  };
}

function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
}

function markerIndexHasDedupeKey(file, dedupeKey) {
  if (!dedupeKey || !fs.existsSync(file)) return false;

  try {
    const text = fs.readFileSync(file, "utf8");
    return text.includes(`"dedupeKey":"${dedupeKey}"`);
  } catch {
    return false;
  }
}

function appendEngine26MarkerIndexIfNeeded(replaySnapshot, outFile) {
  const entry = markerIndexEntryFromReplaySnapshot(replaySnapshot, outFile);

  if (!entry) {
    return {
      markerIndexed: false,
      markerIndexFile: ENGINE26_MARKER_INDEX_FILE,
      markerIndexReason: "NO_ACTIVE_ENGINE26_REPLAY_MARKER",
      markerDedupeKey: null,
    };
  }

  if (markerIndexHasDedupeKey(ENGINE26_MARKER_INDEX_FILE, entry.dedupeKey)) {
    return {
      markerIndexed: false,
      markerIndexFile: ENGINE26_MARKER_INDEX_FILE,
      markerIndexReason: "DUPLICATE_MARKER_DEDUPE_KEY",
      markerDedupeKey: entry.dedupeKey,
    };
  }

  appendJsonl(ENGINE26_MARKER_INDEX_FILE, entry);

  return {
    markerIndexed: true,
    markerIndexFile: ENGINE26_MARKER_INDEX_FILE,
    markerIndexReason: "ENGINE26_REPLAY_MARKER_INDEXED",
    markerDedupeKey: entry.dedupeKey,
  };
}

function main() {
  const parts = azParts(new Date());

  const source = readJsonSafe(SOURCE_FILE);

  if (!source || source.ok === false) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          skipped: true,
          reason: "ES_STRATEGY_SNAPSHOT_MISSING_OR_INVALID",
          sourceFile: SOURCE_FILE,
          dateYmd: parts.dateYmd,
          timeHHMM: parts.timeHHMM,
          detail: source?.detail || source?.error || null,
        },
        null,
        2
      )
    );
    return;
  }

  const replaySnapshot = buildSlimEsReplaySnapshot(source, parts);

  const outFile = path.join(
    ES_REPLAY_ROOT,
    parts.dateYmd,
    `${parts.timeHHMM}.json`
  );

  writeJsonAtomic(outFile, replaySnapshot);

  const markerIndexResult = appendEngine26MarkerIndexIfNeeded(
    replaySnapshot,
    outFile
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        schema: replaySnapshot.schema,
        symbol: "ES",
        dateYmd: parts.dateYmd,
        timeHHMM: parts.timeHHMM,
        file: outFile,
        bytes: fs.statSync(outFile).size,

        hasWaveOpportunity:
          replaySnapshot.strategy?.waveOpportunity != null,
        hasEngine16:
          replaySnapshot.strategy?.engine16 != null,
        hasEngine25:
          replaySnapshot.engine25Context != null,
        hasEngine15Decision:
          replaySnapshot.strategy?.engine15Decision != null,

        hasEngine26ReplayMarker:
          replaySnapshot.strategy?.engine26ReplayMarker != null,

        markerIndexed: markerIndexResult.markerIndexed,
        markerIndexFile: markerIndexResult.markerIndexFile,
        markerIndexReason: markerIndexResult.markerIndexReason,
        markerDedupeKey: markerIndexResult.markerDedupeKey,
      },
      null,
      2
    )
  );
}

main();
