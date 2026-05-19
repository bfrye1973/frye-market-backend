// services/core/jobs/buildEngine25HistoricalMacroFeeds6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  ENGINE25_FRED_SERIES,
  fetchEngine25FredBundle,
} from "../logic/engine25DataSources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const REPLAY_BASE_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-macro-feeds-6mo.json"
);

const ENGINE_NAME = "engine25.historicalMacroFeeds.v0.1";
const MODEL_TYPE = "FRED_ONLY_RAW_HISTORICAL_MAPPING";

const FRED_OBSERVATION_START = "2015-01-01";

const KEY_VALIDATION_SERIES = [
  "DGS10",
  "NFCI",
  "BAMLH0A0HYM2",
  "CPIAUCSL",
  "UNRATE",
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function normalizeReplayRows(baseReplay) {
  if (Array.isArray(baseReplay)) {
    return baseReplay;
  }

  if (Array.isArray(baseReplay?.rows)) {
    return baseReplay.rows;
  }

  throw new Error(
    "Base replay file does not contain a rows array or top-level array."
  );
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getReplayDate(row) {
  return row?.date || row?.tradingDate || row?.day || null;
}

function getReplayTime(row) {
  return row?.time || row?.timestamp || row?.dateTime || null;
}

function getEsClose(row) {
  return (
    safeNumber(row?.esClose) ??
    safeNumber(row?.ESClose) ??
    safeNumber(row?.close) ??
    safeNumber(row?.es?.close) ??
    safeNumber(row?.ohlc?.close) ??
    null
  );
}

function cleanFredObservation(obs) {
  if (!obs) {
    return {
      observationDate: null,
      value: null,
      rawValue: null,
      realtime_start: null,
      realtime_end: null,
    };
  }

  return {
    observationDate: obs.date || null,
    value: Number.isFinite(obs.value) ? obs.value : null,
    rawValue: obs.rawValue ?? null,
    realtime_start: obs.realtime_start ?? null,
    realtime_end: obs.realtime_end ?? null,
  };
}

function buildSeriesLookup(fredBundle) {
  const lookup = {};

  for (const series of ENGINE25_FRED_SERIES) {
    const block = fredBundle?.results?.[series.id];

    const observations = Array.isArray(block?.observations)
      ? block.observations
          .filter(
            (obs) =>
              obs &&
              typeof obs.date === "string" &&
              Number.isFinite(obs.value)
          )
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      : [];

    lookup[series.id] = {
      id: series.id,
      label: series.label,
      component: series.component,
      ok: Boolean(block?.ok),
      error: block?.error || null,
      count: Array.isArray(block?.observations) ? block.observations.length : 0,
      validCount: observations.length,
      observations,
    };
  }

  return lookup;
}

function findLatestObservationOnOrBefore(observations, replayDate) {
  if (!Array.isArray(observations) || observations.length === 0 || !replayDate) {
    return null;
  }

  let lo = 0;
  let hi = observations.length - 1;
  let best = null;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const obs = observations[mid];

    if (String(obs.date) <= String(replayDate)) {
      best = obs;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

function mapFredForReplayDate({ replayDate, seriesLookup }) {
  const fred = {};

  for (const series of ENGINE25_FRED_SERIES) {
    const block = seriesLookup[series.id];
    const latestObs = findLatestObservationOnOrBefore(
      block?.observations || [],
      replayDate
    );

    fred[series.id] = {
      label: series.label,
      component: series.component,
      ...cleanFredObservation(latestObs),
    };
  }

  return fred;
}

function validateNoFutureLeakage(rows) {
  const leaks = [];

  for (const row of rows) {
    const replayDate = row.date;

    for (const series of ENGINE25_FRED_SERIES) {
      const mapped = row.fred?.[series.id];

      if (
        mapped?.observationDate &&
        replayDate &&
        String(mapped.observationDate) > String(replayDate)
      ) {
        leaks.push({
          date: replayDate,
          seriesId: series.id,
          observationDate: mapped.observationDate,
        });
      }
    }
  }

  return leaks;
}

function buildQuickValidation(rows) {
  const firstRow = rows[0] || null;
  const lastRow = rows[rows.length - 1] || null;

  function pick(row) {
    if (!row) return null;

    const picked = {
      date: row.date,
      time: row.time,
      esClose: row.esClose,
      fred: {},
    };

    for (const id of KEY_VALIDATION_SERIES) {
      picked.fred[id] = row.fred?.[id] || null;
    }

    return picked;
  }

  return {
    firstRow: pick(firstRow),
    lastRow: pick(lastRow),
  };
}

async function main() {
  const startedAt = new Date().toISOString();

  const output = {
    ok: false,
    engine: ENGINE_NAME,
    modelType: MODEL_TYPE,
    symbol: "ES",
    timeframe: "1d",
    generatedAtUtc: null,
    startedAt,
    finishedAt: null,
    source: {
      fredSeries: ENGINE25_FRED_SERIES.map((series) => ({
        id: series.id,
        label: series.label,
        component: series.component,
      })),
      replayBaseFile: "engine25-historical-replay-6mo.json",
      outputFile: "engine25-historical-macro-feeds-6mo.json",
      fredObservationStart: FRED_OBSERVATION_START,
    },
    limitations: [
      "This first version is raw FRED-only historical mapping.",
      "No FMP data is included yet.",
      "No macro scoring is included yet.",
      "FRED observation dates are used as available-date approximation unless release-date metadata is added later.",
      "Each replay date uses the latest FRED observation date on or before that replay date.",
      "The working POLYGON_PROXY_ONLY replay file is not overwritten.",
    ],
    summary: {
      replayRowsLoaded: 0,
      rowsWritten: 0,
      fredSeriesRequested: ENGINE25_FRED_SERIES.length,
      fredSeriesLoaded: 0,
      futureLeakCount: 0,
    },
    validation: null,
    rows: [],
    errors: [],
  };

  try {
    const fredApiKey = process.env.FRED_API_KEY;

    if (!fredApiKey) {
      throw new Error("Missing FRED_API_KEY environment variable");
    }

    console.log("========================================");
    console.log("Engine 25 Historical Macro Feeds");
    console.log("FRED-only raw historical mapping");
    console.log("========================================");

    console.log("\nReading base replay file:");
    console.log(REPLAY_BASE_FILE);

    const baseReplay = readJsonFile(REPLAY_BASE_FILE);
    const replayRows = normalizeReplayRows(baseReplay);

    output.summary.replayRowsLoaded = replayRows.length;

    if (!replayRows.length) {
      throw new Error("Base replay file has zero rows.");
    }

    console.log("Replay rows loaded:", replayRows.length);

    console.log("\nFetching FRED bundle...");
    const fredBundle = await fetchEngine25FredBundle({
      apiKey: fredApiKey,
      observationStart: FRED_OBSERVATION_START,
    });

    output.summary.fredSeriesLoaded = fredBundle.seriesLoaded || 0;

    if (Array.isArray(fredBundle.errors) && fredBundle.errors.length) {
      output.errors.push(
        ...fredBundle.errors.map((err) => ({
          source: "FRED",
          ...err,
        }))
      );
    }

    console.log(
      "FRED loaded:",
      fredBundle.seriesLoaded,
      "/",
      fredBundle.seriesRequested
    );

    const seriesLookup = buildSeriesLookup(fredBundle);

    const rows = replayRows.map((row, index) => {
      const replayDate = getReplayDate(row);

      if (!replayDate) {
        throw new Error(`Replay row ${index} is missing date.`);
      }

      const fred = mapFredForReplayDate({
        replayDate,
        seriesLookup,
      });

      return {
        date: replayDate,
        time: getReplayTime(row),
        esClose: getEsClose(row),
        fred,
      };
    });

    const futureLeaks = validateNoFutureLeakage(rows);

    output.summary.rowsWritten = rows.length;
    output.summary.futureLeakCount = futureLeaks.length;
    output.validation = {
      noFutureLeakage: futureLeaks.length === 0,
      futureLeaks,
      keySeriesChecked: KEY_VALIDATION_SERIES,
      ...buildQuickValidation(rows),
    };

    output.rows = rows;
    output.ok = futureLeaks.length === 0 && rows.length > 0;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Historical Macro Feeds Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rowsWritten);
    console.log("Future leaks:", output.summary.futureLeakCount);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          modelType: output.modelType,
          replayRowsLoaded: output.summary.replayRowsLoaded,
          rowsWritten: output.summary.rowsWritten,
          fredSeriesLoaded: output.summary.fredSeriesLoaded,
          futureLeakCount: output.summary.futureLeakCount,
          firstRowDate: output.validation?.firstRow?.date || null,
          lastRowDate: output.validation?.lastRow?.date || null,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );

    if (!output.ok) {
      process.exit(1);
    }
  } catch (err) {
    output.ok = false;
    output.finishedAt = new Date().toISOString();
    output.generatedAtUtc = output.finishedAt;
    output.errors.push({
      message: err.message,
      stack: err.stack,
    });

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.error("Engine 25 Historical Macro Feeds Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
