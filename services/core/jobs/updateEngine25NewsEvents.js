// services/core/jobs/updateEngine25NewsEvents.js
// Engine 25 Massive/Benzinga News v0.1
// Licensed news ingestion + normalization only.
// NEWS IDENTIFIES THE EVENT. MARKETS CONFIRM THE EVENT. ENGINE 25 INTERPRETS THE RESULT.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  ENGINE25_NEWS_ENGINE,
  ENGINE25_NEWS_SOURCE,
  normalizeBenzingaNews,
} from "../logic/engine25NewsFilter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-news-events.json");
const SOURCE_ENDPOINT = "/benzinga/v2/news";
const MASSIVE_BASE = "https://api.massive.com";

const API_KEY = process.env.POLYGON_API_KEY || "";

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function failureOutput({ generatedAtUtc, httpStatus = null, warning = "MASSIVE_BENZINGA_NEWS_UNAVAILABLE" } = {}) {
  return {
    ok: false,
    engine: ENGINE25_NEWS_ENGINE,
    source: ENGINE25_NEWS_SOURCE,
    generatedAtUtc,
    sourceEndpoint: SOURCE_ENDPOINT,
    httpStatus,
    itemsFetched: 0,
    itemsRelevant: 0,
    itemsMaterial: 0,
    events: [],
    warnings: [warning],
  };
}

async function fetchMassiveBenzingaNews() {
  if (!API_KEY) {
    const error = new Error("Missing POLYGON_API_KEY");
    error.httpStatus = null;
    throw error;
  }

  const url = new URL(`${MASSIVE_BASE}${SOURCE_ENDPOINT}`);
  url.searchParams.set("limit", "200");
  url.searchParams.set("sort", "published.desc");
  url.searchParams.set("apiKey", API_KEY);

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const error = new Error(`Massive/Benzinga news HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }

  const json = await response.json();
  return {
    httpStatus: response.status,
    results: Array.isArray(json?.results) ? json.results : [],
  };
}

export async function buildAndWriteEngine25NewsEvents({ now = new Date(), fetcher = fetchMassiveBenzingaNews } = {}) {
  const generatedAtUtc = now.toISOString();

  try {
    const fetched = await fetcher();
    const normalized = normalizeBenzingaNews(fetched.results, now);
    const feedAsOfUtc = normalized.events.length
      ? normalized.events.reduce((latest, event) => {
          if (!latest) return event.observedAt;
          return Date.parse(event.observedAt) > Date.parse(latest) ? event.observedAt : latest;
        }, null)
      : null;

    const output = {
      ok: true,
      engine: ENGINE25_NEWS_ENGINE,
      source: ENGINE25_NEWS_SOURCE,
      generatedAtUtc,
      feedAsOfUtc,
      sourceEndpoint: SOURCE_ENDPOINT,
      httpStatus: fetched.httpStatus ?? 200,
      itemsFetched: normalized.itemsFetched,
      itemsRelevant: normalized.itemsRelevant,
      itemsMaterial: normalized.itemsMaterial,
      events: normalized.events,
      warnings: [],
    };

    atomicWriteJson(OUTPUT_FILE, output);
    return output;
  } catch (error) {
    const output = failureOutput({
      generatedAtUtc,
      httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
    });
    atomicWriteJson(OUTPUT_FILE, output);
    return output;
  }
}

async function main() {
  const output = await buildAndWriteEngine25NewsEvents();
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  main().catch((error) => {
    const generatedAtUtc = new Date().toISOString();
    const output = failureOutput({ generatedAtUtc });
    atomicWriteJson(OUTPUT_FILE, output);
    console.error(JSON.stringify(output, null, 2));
    process.exitCode = 1;
  });
}
