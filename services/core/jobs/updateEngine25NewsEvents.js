// services/core/jobs/updateEngine25NewsEvents.js
// Engine 25 Finlight News v0.2
// Finlight REST ingestion + normalization only.
// NEWS IDENTIFIES THE EVENT. MARKETS CONFIRM THE EVENT. ENGINE 25 INTERPRETS THE RESULT.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  ENGINE25_NEWS_ENGINE,
  ENGINE25_NEWS_SOURCE,
  normalizeFinlightNews,
} from "../logic/engine25NewsFilter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-news-events.json");

const FINLIGHT_BASE = "https://api.finlight.me";
const SOURCE_ENDPOINT = "/v2/articles";
const FINLIGHT_SOURCE_FILTER = ["www.reuters.com"];

const FINLIGHT_API_KEY =
  process.env.FINLIGHT_API_KEY ||
  process.env.FINLIGHT_KEY ||
  "";

const FINLIGHT_QUERIES = Object.freeze([
  "Iran Strait of Hormuz oil shipping",
  "Federal Reserve interest rates monetary policy",
  "Treasury bond yields auction selloff liquidity",
  "inflation payrolls jobless claims GDP retail sales",
  "tariffs trade sanctions bank liquidity credit stress",
]);

const DEFAULT_LIVE_LOOKBACK_HOURS = 8;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function liveLookbackHours() {
  return clampNumber(
    process.env.FINLIGHT_LIVE_LOOKBACK_HOURS,
    1,
    24,
    DEFAULT_LIVE_LOOKBACK_HOURS
  );
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function failureOutput({
  generatedAtUtc,
  httpStatus = null,
  warning = "FINLIGHT_NEWS_UNAVAILABLE",
  window = null,
} = {}) {
  return {
    ok: false,
    engine: ENGINE25_NEWS_ENGINE,
    source: ENGINE25_NEWS_SOURCE,
    generatedAtUtc,
    feedAsOfUtc: null,
    providerFetchedAtUtc: null,
    sourceEndpoint: SOURCE_ENDPOINT,
    sourceFilters: FINLIGHT_SOURCE_FILTER,
    sourceQueries: FINLIGHT_QUERIES,
    liveWindow: window,
    httpStatus,
    itemsFetched: 0,
    itemsRelevant: 0,
    itemsMaterial: 0,
    events: [],
    warnings: [warning],
  };
}

async function readJsonResponse(response, label) {
  const text = await response.text();

  if (!text || !text.trim()) {
    const error = new Error(`${label} returned empty response`);
    error.httpStatus = response.status;
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(
      `${label} returned non-JSON response. status=${response.status} preview=${text.slice(
        0,
        300
      )}`
    );
    error.httpStatus = response.status;
    throw error;
  }
}

function buildLiveWindow(now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const lookbackHours = liveLookbackHours();

  return {
    lookbackHours,
    from: new Date(
      safeNowMs - lookbackHours * 60 * 60 * 1000
    ).toISOString(),
    to: new Date(safeNowMs + 2 * 60 * 1000).toISOString(),
  };
}

async function fetchFinlightQuery(query, window) {
  if (!FINLIGHT_API_KEY) {
    const error = new Error("Missing FINLIGHT_API_KEY");
    error.httpStatus = null;
    throw error;
  }

  const url = `${FINLIGHT_BASE}${SOURCE_ENDPOINT}`;
  const requestedAtUtc = new Date().toISOString();

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-KEY": FINLIGHT_API_KEY,
    },
    body: JSON.stringify({
      query,
      sources: FINLIGHT_SOURCE_FILTER,
      from: window.from,
      to: window.to,
      language: "en",
      orderBy: "createdAt",
      order: "DESC",
      pageSize: 100,
    }),
  });

  const receivedAtUtc = new Date().toISOString();

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(
      `Finlight news HTTP ${response.status} query=${query} ${text.slice(0, 300)}`
    );
    error.httpStatus = response.status;
    throw error;
  }

  const json = await readJsonResponse(response, `Finlight query "${query}"`);
  const articles = Array.isArray(json?.articles) ? json.articles : [];

  return {
    query,
    httpStatus: response.status,
    requestedAtUtc,
    receivedAtUtc,
    articles,
  };
}

function articleIdentity(article) {
  const link = String(article?.link || "").trim();
  if (link) return `LINK:${link}`;

  return [
    String(article?.source || "").trim().toLowerCase(),
    String(article?.publishDate || "").trim(),
    String(article?.title || "").trim().toLowerCase(),
  ].join("|");
}

async function fetchFinlightNews({ now = new Date() } = {}) {
  const window = buildLiveWindow(now);
  const queryResults = [];
  const combined = [];
  const seen = new Set();

  for (const query of FINLIGHT_QUERIES) {
    const result = await fetchFinlightQuery(query, window);

    queryResults.push({
      query: result.query,
      httpStatus: result.httpStatus,
      requestedAtUtc: result.requestedAtUtc,
      receivedAtUtc: result.receivedAtUtc,
      articleCount: result.articles.length,
    });

    for (const article of result.articles) {
      const id = articleIdentity(article);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      combined.push(article);
    }
  }

  const providerFetchedAtUtc = queryResults.length
    ? queryResults.reduce((latest, row) => {
        if (!latest) return row.receivedAtUtc;
        return Date.parse(row.receivedAtUtc) > Date.parse(latest)
          ? row.receivedAtUtc
          : latest;
      }, null)
    : new Date().toISOString();

  return {
    httpStatus: 200,
    providerFetchedAtUtc,
    results: combined,
    queryResults,
    liveWindow: window,
  };
}

function metricStats(values) {
  const valid = values.map(Number).filter(Number.isFinite);

  return {
    eventCountMeasured: valid.length,
    minMs: valid.length ? Math.min(...valid) : null,
    maxMs: valid.length ? Math.max(...valid) : null,
    averageMs: valid.length
      ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length)
      : null,
  };
}

export async function buildAndWriteEngine25NewsEvents({
  now = new Date(),
  fetcher = fetchFinlightNews,
} = {}) {
  const generatedAtUtc = now.toISOString();
  const liveWindow = buildLiveWindow(now);

  try {
    const fetched = await fetcher({ now });
    const normalized = normalizeFinlightNews(
      fetched.results,
      now,
      fetched.providerFetchedAtUtc
    );

    const feedAsOfUtc = normalized.events.length
      ? normalized.events.reduce((latest, event) => {
          if (!latest) return event.observedAt;
          return Date.parse(event.observedAt) > Date.parse(latest)
            ? event.observedAt
            : latest;
        }, null)
      : null;

    const publisherToFinlight = metricStats(
      normalized.events.map((event) => event?.publisherToFinlightLatencyMs)
    );

    const finlightToEngine = metricStats(
      normalized.events.map((event) => event?.finlightToEngineFetchLatencyMs)
    );

    const publishedToEngine = metricStats(
      normalized.events.map((event) => event?.publishedToEngineFetchLatencyMs)
    );

    const activeMaterialCount = normalized.events.filter((event) => {
      const expiresMs = Date.parse(event?.expiresAt || "");
      return (
        event?.material === true &&
        Number.isFinite(expiresMs) &&
        now.getTime() < expiresMs
      );
    }).length;

    const output = {
      ok: true,
      engine: ENGINE25_NEWS_ENGINE,
      source: ENGINE25_NEWS_SOURCE,
      generatedAtUtc,
      providerFetchedAtUtc: fetched.providerFetchedAtUtc,
      feedAsOfUtc,
      sourceEndpoint: SOURCE_ENDPOINT,
      sourceFilters: FINLIGHT_SOURCE_FILTER,
      sourceQueries: FINLIGHT_QUERIES,
      liveWindow: fetched.liveWindow || liveWindow,
      httpStatus: fetched.httpStatus ?? 200,
      itemsFetched: normalized.itemsFetched,
      itemsRelevant: normalized.itemsRelevant,
      itemsMaterial: normalized.itemsMaterial,
      activeMaterialCount,
      latency: {
        publisherToFinlight,
        finlightToEngine,
        publishedToEngine,
      },
      providerDiagnostics: {
        queries: fetched.queryResults || [],
      },
      events: normalized.events,
      warnings: [],
    };

    atomicWriteJson(OUTPUT_FILE, output);
    return output;
  } catch (error) {
    const output = failureOutput({
      generatedAtUtc,
      httpStatus: Number.isInteger(error?.httpStatus)
        ? error.httpStatus
        : null,
      window: liveWindow,
    });

    output.error = error?.message || String(error);

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
    output.error = error?.message || String(error);
    atomicWriteJson(OUTPUT_FILE, output);
    console.error(JSON.stringify(output, null, 2));
    process.exitCode = 1;
  });
}
