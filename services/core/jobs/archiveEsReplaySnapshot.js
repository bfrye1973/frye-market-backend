// services/core/jobs/archiveEsReplaySnapshot.js
// Engine 12 canonical multi-strategy ES Replay writer.
//
// Source:
//   services/core/data/strategy-snapshot-es.json
//
// Durable output:
//   /var/data/replay/es/YYYY-MM-DD/HHMM.json
//
// Contract:
// - Records all canonical strategy lanes from one completed snapshot build.
// - Does not calculate, rename, rebuild, approve, execute, or journal anything.
// - Never rewrites an existing replay file.
// - Leaves all legacy reduced replay files unchanged.
// - Continues the existing Engine 26 marker index during the ownership transition.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const AZ_TZ = "America/Phoenix";

const REPLAY_SCHEMA = "engine12.multiStrategyReplay.v1";
const REPLAY_CONTRACT = "CANONICAL_MULTI_STRATEGY_REPLAY";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(CORE_DIR, "data");
const SOURCE_FILE = path.join(DATA_DIR, "strategy-snapshot-es.json");

// Render production:
//   REPLAY_DATA_DIR=/var/data
//
// Local fallback:
//   services/core/data
const REPLAY_DATA_DIR = String(
  process.env.REPLAY_DATA_DIR || DATA_DIR
)
  .trim()
  .replace(/\/+$/, "");

const ES_REPLAY_ROOT = path.join(
  REPLAY_DATA_DIR,
  "replay",
  "es"
);

const ES_REPLAY_MARKER_DIR = path.join(
  ES_REPLAY_ROOT,
  "markers"
);

const ENGINE26_MARKER_INDEX_FILE = path.join(
  ES_REPLAY_MARKER_DIR,
  "engine26-replay-markers.jsonl"
);

const CANONICAL_STRATEGY_IDS = Object.freeze([
  "subminute_scalp@10m",
  "intraday_scalp@10m",
  "minor_swing@1h",
  "intermediate_swing@4h",
  "primary_position@1d",
]);

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function azParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) =>
    parts.find((part) => part.type === type)?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");

  return {
    dateYmd: `${year}-${month}-${day}`,
    timeHHMM: `${hour}${minute}`,
    timeHHMMSS: `${hour}${minute}${second}`,
    azTime: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
  };
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) {
      return {
        ok: false,
        error: "SOURCE_FILE_NOT_FOUND",
        file,
      };
    }

    const parsed = JSON.parse(
      fs.readFileSync(file, "utf8")
    );

    if (!isObject(parsed)) {
      return {
        ok: false,
        error: "SOURCE_JSON_NOT_OBJECT",
        file,
      };
    }

    return parsed;
  } catch (error) {
    return {
      ok: false,
      error: "READ_JSON_FAILED",
      file,
      detail: String(error?.message || error),
    };
  }
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (
      typeof value === "string" &&
      value.trim() !== ""
    ) {
      return value.trim();
    }
  }

  return null;
}

function firstArrayItems(value, limit = 20) {
  return Array.isArray(value)
    ? value.filter(Boolean).slice(0, limit)
    : [];
}

function getStrategy(
  strategies,
  strategyId
) {
  const strategy = strategies?.[strategyId];

  return isObject(strategy)
    ? strategy
    : null;
}

function getMinuteStrategy(strategies) {
  return getStrategy(
    strategies,
    "intraday_scalp@10m"
  );
}

function determineCurrentPrice(
  source,
  strategies
) {
  const minute = getMinuteStrategy(strategies);

  return firstFiniteNumber(
    source?.currentPrice,
    source?.price,

    minute?.currentPrice,
    minute?.price,

    minute?.engine26LocationCandidate?.currentPrice,
    minute?.engine27TraderDecision?.currentPrice,
    minute?.engine27IntradayDecision?.currentPrice,

    minute?.confluence?.price,
    minute?.context?.meta?.current_price,
    minute?.context?.meta?.currentPrice,

    minute?.engine22WaveStrategy?.currentPrice,
    minute?.engine16?.regimeLayers?.trigger10m?.close
  );
}

function determineSnapshotTime(
  source,
  strategies,
  generatedAtUtc
) {
  const minute = getMinuteStrategy(strategies);

  return firstNonEmptyString(
    source?.snapshotTime,
    source?.generatedAtUtc,
    source?.now,
    source?.updatedAt,

    minute?.snapshotTime,
    minute?.strategyTimeline?.snapshotTime,
    minute?.engine8PaperOrder?.snapshotTime,
    minute?.engine9OfficialManagementPlan?.snapshotTime,
    minute?.engine26LocationCandidate?.snapshotTime,

    generatedAtUtc
  );
}

function buildCanonicalStrategies(source) {
  const sourceStrategies = isObject(source?.strategies)
    ? source.strategies
    : {};

  // Copy exactly what the canonical build emitted.
  // JSON serialization below creates the immutable recorded value.
  //
  // Do not:
  // - construct missing strategies
  // - calculate strategyTimeline
  // - substitute Minute fields into Subminute
  // - manufacture null objects
  return sourceStrategies;
}

function buildCanonicalReplaySnapshot(
  source,
  parts
) {
  const generatedAtUtc = new Date().toISOString();
  const strategies = buildCanonicalStrategies(source);
  const currentPrice = determineCurrentPrice(
    source,
    strategies
  );

  const snapshotTime = determineSnapshotTime(
    source,
    strategies,
    generatedAtUtc
  );

  return {
    ok: true,

    schema: REPLAY_SCHEMA,
    replayContract: REPLAY_CONTRACT,
    immutable: true,

    symbol:
      firstNonEmptyString(
        source?.symbol,
        "ES"
      ) || "ES",

    snapshotTime,

    dateYmd: parts.dateYmd,
    timeHHMM: parts.timeHHMM,
    timeHHMMSS: parts.timeHHMMSS,

    timezone: AZ_TZ,
    azTime: parts.azTime,
    generatedAtUtc,

    sourceFile: "data/strategy-snapshot-es.json",

    sourceSnapshot: {
      schema: source?.schema ?? null,
      generatedAtUtc:
        source?.generatedAtUtc ?? null,
      snapshotTime:
        source?.snapshotTime ?? null,
      dateYmd:
        source?.dateYmd ?? null,
      timeHHMM:
        source?.timeHHMM ?? null,
      symbol:
        source?.symbol ?? "ES",
    },

    currentPrice,
    price: currentPrice,

    marketRegime:
      source?.marketRegime ?? null,

    marketMeter:
      source?.marketMeter ??
      source?.marketMind ??
      null,

    engine25Context:
      source?.engine25Context ??
      null,

    // Canonical contract:
    // preserve every emitted strategy lane from one build.
    strategies,
  };
}

function canonicalLaneEvidence(
  replaySnapshot
) {
  const strategies = replaySnapshot?.strategies || {};

  return Object.fromEntries(
    CANONICAL_STRATEGY_IDS.map((strategyId) => {
      const strategy = getStrategy(
        strategies,
        strategyId
      );

      return [
        strategyId,
        {
          present: strategy !== null,

          laneId:
            strategy?.laneId ?? null,

          strategyId:
            strategy?.strategyId ??
            strategyId,

          strategyTimelineType:
            strategy?.strategyTimeline === null
              ? "null"
              : typeof strategy?.strategyTimeline,

          engine8PaperOrderType:
            strategy?.engine8PaperOrder === null
              ? "null"
              : typeof strategy?.engine8PaperOrder,
        },
      ];
    })
  );
}

function getEngine26ReplayMarker(
  replaySnapshot
) {
  return (
    replaySnapshot
      ?.strategies
      ?.["intraday_scalp@10m"]
      ?.engine26ReplayMarker ??
    null
  );
}

function markerIndexEntryFromReplaySnapshot(
  replaySnapshot,
  outFile
) {
  const marker = getEngine26ReplayMarker(
    replaySnapshot
  );

  if (
    !isObject(marker) ||
    marker.active !== true
  ) {
    return null;
  }

  return {
    schema:
      "engine26-replay-marker-index@v1",

    replaySchema:
      replaySnapshot?.schema ?? null,

    replayContract:
      replaySnapshot?.replayContract ?? null,

    symbol:
      marker.symbol ||
      replaySnapshot?.symbol ||
      "ES",

    strategyId:
      marker.strategyId ||
      "intraday_scalp@10m",

    dateYmd:
      marker.dateYmd ||
      replaySnapshot?.dateYmd ||
      null,

    timeHHMM:
      marker.timeHHMM ||
      replaySnapshot?.timeHHMM ||
      null,

    replayApiTime:
      marker.replayApiTime ||
      marker.timeHHMM ||
      replaySnapshot?.timeHHMM ||
      null,

    snapshotTime:
      replaySnapshot?.snapshotTime ||
      null,

    azTime:
      replaySnapshot?.azTime ||
      null,

    generatedAtUtc:
      replaySnapshot?.generatedAtUtc ||
      null,

    indexedAtUtc:
      new Date().toISOString(),

    markerType:
      marker.markerType || null,

    status:
      marker.status || null,

    template:
      marker.template || null,

    setupType:
      marker.setupType || null,

    direction:
      marker.direction || null,

    preferredAction:
      marker.preferredAction || null,

    currentPrice:
      marker.currentPrice ??
      replaySnapshot?.currentPrice ??
      null,

    activeImbalanceRole:
      marker.activeImbalanceRole || null,

    structuralBias:
      marker.structuralBias || null,

    shortResearchOnly:
      marker.shortResearchOnly === true,

    doNotChaseLong:
      marker.doNotChaseLong === true,

    watchOnly:
      marker.watchOnly === true,

    zone:
      marker.zone || null,

    engine3:
      marker.engine3 || null,

    engine4:
      marker.engine4 || null,

    engine15:
      marker.engine15 || null,

    engine6:
      marker.engine6 || null,

    engine6Decision:
      marker.engine6?.decision || null,

    engine6Allowed:
      marker.engine6?.allowed === true,

    engine4State:
      marker.engine4?.state || null,

    engine4Allowed:
      marker.engine4?.allowed === true,

    engine4HardBlocked:
      marker.engine4?.hardBlocked === true,

    engine3State:
      marker.engine3?.state || null,

    engine3Direction:
      marker.engine3?.direction || null,

    engine15Readiness:
      marker.engine15?.readiness || null,

    ticketCreated:
      marker.ticket?.created === true,

    executionCreated:
      marker.execution?.created === true,

    replayPath:
      marker.replayPath || outFile,

    replayFile:
      outFile,

    dedupeKey:
      marker.dedupeKey ||
      [
        marker.symbol || "ES",
        marker.dateYmd ||
          replaySnapshot?.dateYmd ||
          "UNKNOWN_DATE",
        marker.timeHHMM ||
          replaySnapshot?.timeHHMM ||
          "UNKNOWN_TIME",
        marker.markerType ||
          "UNKNOWN_MARKER",
        marker.status ||
          "UNKNOWN_STATUS",
        marker.engine6?.decision ||
          "UNKNOWN_ENGINE6_DECISION",
      ].join("|"),

    reasonCodes:
      firstArrayItems(
        marker.reasonCodes,
        20
      ),
  };
}

function appendJsonl(
  file,
  object
) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.appendFileSync(
    file,
    `${JSON.stringify(object)}\n`,
    "utf8"
  );
}

function markerIndexHasDedupeKey(
  file,
  dedupeKey
) {
  if (
    !dedupeKey ||
    !fs.existsSync(file)
  ) {
    return false;
  }

  try {
    const text = fs.readFileSync(
      file,
      "utf8"
    );

    return text.includes(
      `"dedupeKey":"${dedupeKey}"`
    );
  } catch {
    return false;
  }
}

function appendEngine26MarkerIndexIfNeeded(
  replaySnapshot,
  outFile
) {
  const entry =
    markerIndexEntryFromReplaySnapshot(
      replaySnapshot,
      outFile
    );

  if (!entry) {
    return {
      markerIndexed: false,
      markerIndexFile:
        ENGINE26_MARKER_INDEX_FILE,
      markerIndexReason:
        "NO_ACTIVE_ENGINE26_REPLAY_MARKER",
      markerDedupeKey: null,
    };
  }

  if (
    markerIndexHasDedupeKey(
      ENGINE26_MARKER_INDEX_FILE,
      entry.dedupeKey
    )
  ) {
    return {
      markerIndexed: false,
      markerIndexFile:
        ENGINE26_MARKER_INDEX_FILE,
      markerIndexReason:
        "DUPLICATE_MARKER_DEDUPE_KEY",
      markerDedupeKey:
        entry.dedupeKey,
    };
  }

  appendJsonl(
    ENGINE26_MARKER_INDEX_FILE,
    entry
  );

  return {
    markerIndexed: true,
    markerIndexFile:
      ENGINE26_MARKER_INDEX_FILE,
    markerIndexReason:
      "ENGINE26_REPLAY_MARKER_INDEXED",
    markerDedupeKey:
      entry.dedupeKey,
  };
}

function writeJsonAtomicNoOverwrite(
  file,
  object
) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  if (fs.existsSync(file)) {
    return {
      written: false,
      reason:
        "DUPLICATE_REPLAY_BLOCKED",
      file,
    };
  }

  const temporaryFile = [
    file,
    ".tmp.",
    process.pid,
    ".",
    Date.now(),
  ].join("");

  try {
    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(object, null, 2),
      {
        encoding: "utf8",
        flag: "wx",
      }
    );

    // An atomic hard-link claim prevents replacement of an
    // existing final path. linkSync throws EEXIST when another
    // process already claimed this timestamp.
    fs.linkSync(
      temporaryFile,
      file
    );

    fs.unlinkSync(
      temporaryFile
    );

    return {
      written: true,
      reason:
        "CANONICAL_REPLAY_WRITTEN",
      file,
    };
  } catch (error) {
    try {
      if (
        fs.existsSync(temporaryFile)
      ) {
        fs.unlinkSync(
          temporaryFile
        );
      }
    } catch {
      // Cleanup failure must not replace the original error.
    }

    if (
      error?.code === "EEXIST"
    ) {
      return {
        written: false,
        reason:
          "DUPLICATE_REPLAY_BLOCKED",
        file,
      };
    }

    throw error;
  }
}

function validateCanonicalSource(
  source
) {
  if (!isObject(source)) {
    return {
      ok: false,
      reason:
        "SOURCE_SNAPSHOT_NOT_OBJECT",
    };
  }

  if (!isObject(source.strategies)) {
    return {
      ok: false,
      reason:
        "SOURCE_STRATEGIES_MISSING",
    };
  }

  return {
    ok: true,
    reason:
      "CANONICAL_SOURCE_VALID",
  };
}

function main() {
  const parts = azParts(
    new Date()
  );

  const source =
    readJsonSafe(SOURCE_FILE);

  if (
    !source ||
    source.ok === false
  ) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          replayWritten: false,
          skipped: true,
          reason:
            "ES_STRATEGY_SNAPSHOT_MISSING_OR_INVALID",
          sourceFile:
            SOURCE_FILE,
          dateYmd:
            parts.dateYmd,
          timeHHMM:
            parts.timeHHMM,
          detail:
            source?.detail ||
            source?.error ||
            null,
        },
        null,
        2
      )
    );

    process.exitCode = 1;
    return;
  }

  const validation =
    validateCanonicalSource(source);

  if (!validation.ok) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          replayWritten: false,
          skipped: true,
          reason:
            validation.reason,
          sourceFile:
            SOURCE_FILE,
          dateYmd:
            parts.dateYmd,
          timeHHMM:
            parts.timeHHMM,
        },
        null,
        2
      )
    );

    process.exitCode = 1;
    return;
  }

  const replaySnapshot =
    buildCanonicalReplaySnapshot(
      source,
      parts
    );

  const outFile = path.join(
    ES_REPLAY_ROOT,
    parts.dateYmd,
    `${parts.timeHHMM}.json`
  );

  const writeResult =
    writeJsonAtomicNoOverwrite(
      outFile,
      replaySnapshot
    );

  if (!writeResult.written) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          replayWritten: false,
          skipped: true,
          reason:
            writeResult.reason,

          schema:
            REPLAY_SCHEMA,

          replayContract:
            REPLAY_CONTRACT,

          symbol:
            replaySnapshot.symbol,

          dateYmd:
            parts.dateYmd,

          timeHHMM:
            parts.timeHHMM,

          file:
            outFile,

          existingFilePreserved:
            true,

          markerIndexed:
            false,

          markerIndexReason:
            "REPLAY_NOT_WRITTEN",
        },
        null,
        2
      )
    );

    return;
  }

  const markerIndexResult =
    appendEngine26MarkerIndexIfNeeded(
      replaySnapshot,
      outFile
    );

  const laneEvidence =
    canonicalLaneEvidence(
      replaySnapshot
    );

  console.log(
    JSON.stringify(
      {
        ok: true,
        replayWritten: true,

        schema:
          replaySnapshot.schema,

        replayContract:
          replaySnapshot.replayContract,

        immutable:
          replaySnapshot.immutable === true,

        symbol:
          replaySnapshot.symbol,

        snapshotTime:
          replaySnapshot.snapshotTime,

        dateYmd:
          parts.dateYmd,

        timeHHMM:
          parts.timeHHMM,

        file:
          outFile,

        bytes:
          fs.statSync(outFile).size,

        strategyCount:
          Object.keys(
            replaySnapshot.strategies
          ).length,

        strategyIds:
          Object.keys(
            replaySnapshot.strategies
          ),

        canonicalLaneEvidence:
          laneEvidence,

        markerIndexed:
          markerIndexResult.markerIndexed,

        markerIndexFile:
          markerIndexResult.markerIndexFile,

        markerIndexReason:
          markerIndexResult.markerIndexReason,

        markerDedupeKey:
          markerIndexResult.markerDedupeKey,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        replayWritten: false,
        errorCode:
          "REPLAY_WRITE_FAILED",
        sourceFile:
          SOURCE_FILE,
        replayRoot:
          ES_REPLAY_ROOT,
        retryable: true,
        detail:
          String(
            error?.message || error
          ),
      },
      null,
      2
    )
  );
