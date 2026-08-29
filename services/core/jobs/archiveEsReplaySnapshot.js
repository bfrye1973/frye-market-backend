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
const EXCHANGE_TZ = "America/Chicago";

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


function zonedClockParts(
  date,
  timeZone
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }
    ).formatToParts(date);

  const get = (type) =>
    parts.find(
      (part) =>
        part.type === type
    )?.value || "";

  return {
    weekday:
      get("weekday"),

    year:
      get("year"),

    month:
      get("month"),

    day:
      get("day"),

    hour:
      Number(get("hour")),

    minute:
      Number(get("minute")),

    second:
      Number(get("second")),
  };
}

function formatClock(parts) {
  const pad = (value) =>
    String(value).padStart(2, "0");

  return [
    pad(parts.hour),
    pad(parts.minute),
    pad(parts.second),
  ].join(":");
}

function formatDateYmd(parts) {
  return [
    parts.year,
    parts.month,
    parts.day,
  ].join("-");
}

/**
 * Standard weekly CME Globex ES session decision.
 *
 * Authoritative timezone:
 *   America/Chicago
 *
 * Supported in this phase:
 * - standard Sunday-through-Friday weekly session
 * - standard daily maintenance break
 * - DST-safe Chicago/Phoenix conversion through Intl
 *
 * Deferred:
 * - CME holiday overrides
 * - special early closes
 */
export function evaluateEsFuturesSession(
  date = new Date()
) {
  const instant =
    date instanceof Date
      ? date
      : new Date(date);

  if (
    Number.isNaN(
      instant.getTime()
    )
  ) {
    throw new TypeError(
      "INVALID_SESSION_DECISION_DATE"
    );
  }

  const exchange =
    zonedClockParts(
      instant,
      EXCHANGE_TZ
    );

  const arizona =
    zonedClockParts(
      instant,
      AZ_TZ
    );

  const exchangeHour =
    exchange.hour;

  let open = false;
  let sessionState =
    "WEEKEND_CLOSED";

  switch (
    exchange.weekday
  ) {
    case "Sun":
      open =
        exchangeHour >= 17;

      sessionState =
        open
          ? "OPEN"
          : "SUNDAY_PREOPEN";
      break;

    case "Mon":
    case "Tue":
    case "Wed":
    case "Thu":
      open =
        exchangeHour < 16 ||
        exchangeHour >= 17;

      sessionState =
        open
          ? "OPEN"
          : "MAINTENANCE_BREAK";
      break;

    case "Fri":
      open =
        exchangeHour < 16;

      sessionState =
        open
          ? "OPEN"
          : "WEEKEND_CLOSED";
      break;

    case "Sat":
    default:
      open = false;
      sessionState =
        "WEEKEND_CLOSED";
      break;
  }

  return {
    open,

    reason:
      open
        ? "ES_FUTURES_SESSION_OPEN"
        : "ES_FUTURES_SESSION_CLOSED",

    exchangeTimezone:
      EXCHANGE_TZ,

    exchangeDate:
      formatDateYmd(
        exchange
      ),

    exchangeDay:
      exchange.weekday,

    exchangeTime:
      formatClock(
        exchange
      ),

    arizonaTimezone:
      AZ_TZ,

    arizonaDate:
      formatDateYmd(
        arizona
      ),

    arizonaTime:
      formatClock(
        arizona
      ),

    sessionState,

    nextSessionBoundary:
      null,

    sessionContract:
      "STANDARD_WEEKLY_SESSION_ONLY",

    holidayOverrideStatus:
      "CME_HOLIDAY_OVERRIDES_NOT_IMPLEMENTED",
  };
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

  // Preserve every emitted strategy lane while applying the one
  // manager-approved Replay-only optimization:
  //
  // - omit strategies[*].analytics.engine5
  // - omit analytics only when that removal leaves analytics empty
  //
  // No other strategy field, value, array, null, false value,
  // identity, timestamp, lifecycle object, or evidence branch changes.
  return Object.fromEntries(
    Object.entries(sourceStrategies).map(
      ([strategyId, strategy]) => {
        if (!isObject(strategy)) {
          return [strategyId, strategy];
        }

        const analytics = strategy.analytics;

        if (
          !isObject(analytics) ||
          !Object.prototype.hasOwnProperty.call(
            analytics,
            "engine5"
          )
        ) {
          return [strategyId, strategy];
        }

        const {
          engine5: _omittedEngine5,
          ...remainingAnalytics
        } = analytics;

        const replayStrategy = {
          ...strategy,
        };

        if (
          Object.keys(
            remainingAnalytics
          ).length > 0
        ) {
          replayStrategy.analytics =
            remainingAnalytics;
        } else {
          delete replayStrategy.analytics;
        }

        return [
          strategyId,
          replayStrategy,
        ];
      }
    )
  );
}

function buildCanonicalReplaySnapshot(
  source,
  parts,
  generatedAtUtc =
    new Date().toISOString()
) {
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

    // Engine 27 canonical Replay preservation:
    // preserve the complete already-built root object unchanged.
    engine27Strategies:
      source?.engine27Strategies,

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
  outFile,
  markerIndexFile =
    ENGINE26_MARKER_INDEX_FILE
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
        markerIndexFile,
      markerIndexReason:
        "NO_ACTIVE_ENGINE26_REPLAY_MARKER",
      markerDedupeKey: null,
    };
  }

  if (
    markerIndexHasDedupeKey(
      markerIndexFile,
      entry.dedupeKey
    )
  ) {
    return {
      markerIndexed: false,
      markerIndexFile:
        markerIndexFile,
      markerIndexReason:
        "DUPLICATE_MARKER_DEDUPE_KEY",
      markerDedupeKey:
        entry.dedupeKey,
    };
  }

  appendJsonl(
    markerIndexFile,
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
      JSON.stringify(object),
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

export function runReplayArchive({
  now = new Date(),
  sourceFile =
    SOURCE_FILE,
  replayRoot =
    ES_REPLAY_ROOT,
  markerIndexFile =
    ENGINE26_MARKER_INDEX_FILE,
} = {}) {
  const sessionDecision =
    evaluateEsFuturesSession(
      now
    );

  if (
    sessionDecision.open !== true
  ) {
    return {
      ok: true,
      replayWritten: false,
      skipped: true,
      reason:
        "ES_FUTURES_SESSION_CLOSED",

      exchangeTimezone:
        sessionDecision
          .exchangeTimezone,

      exchangeDate:
        sessionDecision
          .exchangeDate,

      exchangeDay:
        sessionDecision
          .exchangeDay,

      exchangeTime:
        sessionDecision
          .exchangeTime,

      arizonaDate:
        sessionDecision
          .arizonaDate,

      arizonaTime:
        sessionDecision
          .arizonaTime,

      sessionState:
        sessionDecision
          .sessionState,

      nextSessionBoundary:
        sessionDecision
          .nextSessionBoundary,

      sessionContract:
        sessionDecision
          .sessionContract,

      holidayOverrideStatus:
        sessionDecision
          .holidayOverrideStatus,
    };
  }

  const parts =
    azParts(now);

  const source =
    readJsonSafe(
      sourceFile
    );

  if (
    !source ||
    source.ok === false
  ) {
    return {
      ok: false,
      replayWritten: false,
      skipped: true,
      reason:
        "ES_STRATEGY_SNAPSHOT_MISSING_OR_INVALID",
      sourceFile,
      dateYmd:
        parts.dateYmd,
      timeHHMM:
        parts.timeHHMM,
      detail:
        source?.detail ||
        source?.error ||
        null,
    };
  }

  const validation =
    validateCanonicalSource(
      source
    );

  if (!validation.ok) {
    return {
      ok: false,
      replayWritten: false,
      skipped: true,
      reason:
        validation.reason,
      sourceFile,
      dateYmd:
        parts.dateYmd,
      timeHHMM:
        parts.timeHHMM,
    };
  }

  const replaySnapshot =
    buildCanonicalReplaySnapshot(
      source,
      parts,
      now.toISOString()
    );

  const outFile = path.join(
    replayRoot,
    parts.dateYmd,
    `${parts.timeHHMM}.json`
  );

  const writeResult =
    writeJsonAtomicNoOverwrite(
      outFile,
      replaySnapshot
    );

  if (!writeResult.written) {
    return {
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

      exchangeTimezone:
        sessionDecision
          .exchangeTimezone,

      exchangeDate:
        sessionDecision
          .exchangeDate,

      exchangeDay:
        sessionDecision
          .exchangeDay,

      exchangeTime:
        sessionDecision
          .exchangeTime,

      arizonaDate:
        sessionDecision
          .arizonaDate,

      arizonaTime:
        sessionDecision
          .arizonaTime,

      sessionState:
        sessionDecision
          .sessionState,

      sessionContract:
        sessionDecision
          .sessionContract,

      holidayOverrideStatus:
        sessionDecision
          .holidayOverrideStatus,
    };
  }

  const markerIndexResult =
    appendEngine26MarkerIndexIfNeeded(
      replaySnapshot,
      outFile,
      markerIndexFile
    );

  const laneEvidence =
    canonicalLaneEvidence(
      replaySnapshot
    );

  return {
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

    exchangeTimezone:
      sessionDecision
        .exchangeTimezone,

    exchangeDate:
      sessionDecision
        .exchangeDate,

    exchangeDay:
      sessionDecision
        .exchangeDay,

    exchangeTime:
      sessionDecision
        .exchangeTime,

    arizonaDate:
      sessionDecision
        .arizonaDate,

    arizonaTime:
      sessionDecision
        .arizonaTime,

    sessionState:
      sessionDecision
        .sessionState,

    sessionContract:
      sessionDecision
        .sessionContract,

    holidayOverrideStatus:
      sessionDecision
        .holidayOverrideStatus,
  };
}

function main() {
  try {
    const result =
      runReplayArchive();

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    if (
      result.ok === false
    ) {
      process.exitCode = 1;
    }
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
              error?.message ||
              error
            ),
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(
    process.argv[1]
  ) === __filename;

if (isDirectExecution) {
  main();
}
