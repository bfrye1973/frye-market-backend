// services/core/jobs/updateEngine25NewsEvents.js
// Engine 25 Finlight News v0.3
// Broad Reuters live-feed ingestion + Engine 25 normalization only.
//
// Architecture:
// FINLIGHT / REUTERS DISCOVERY
//        ↓
// ENGINE 25 CLASSIFIER
//        ↓
// MATERIALITY / DEDUPE / EXPIRY
//        ↓
// MARKET CONFIRMATION
//
// NEWS IDENTIFIES THE EVENT.
// MARKETS CONFIRM THE EVENT.
// ENGINE 25 INTERPRETS THE RESULT.
//
// Scope lock:
// - No LONG/SHORT.
// - No MACRO_SHOCK from news alone.
// - No Engine 6 permission.
// - No Engine 3/4/22/26 changes.
// - Polygon market-data usage is untouched.

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

// Reuters remains the initial Engine 25 production source.
// Other Finlight sources can be added later only after separate validation.
const FINLIGHT_SOURCE_FILTER = Object.freeze(["www.reuters.com"]);

const FINLIGHT_API_KEY =
  process.env.FINLIGHT_API_KEY ||
  process.env.FINLIGHT_KEY ||
  "";

const DEFAULT_LIVE_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 100;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function liveLookbackHours() {
  return clampNumber(
    process.env.FINLIGHT_LIVE_LOOKBACK_HOURS,
    1,
    48,
    DEFAULT_LIVE_LOOKBACK_HOURS
  );
}

function pageSize() {
  return Math.round(
    clampNumber(
      process.env.FINLIGHT_PAGE_SIZE,
      10,
      100,
      DEFAULT_PAGE_SIZE
    )
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
    providerFetchedAtUtc: null,
    feedAsOfUtc: null,
    sourceEndpoint: SOURCE_ENDPOINT,
    sourceFilters: FINLIGHT_SOURCE_FILTER,
    discoveryMode: "BROAD_REUTERS_LIVE_FEED",
    liveWindow: window,
    httpStatus,
    itemsFetched: 0,
    itemsRelevant: 0,
    itemsMaterial: 0,
    activeMaterialCount: 0,
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
    // Small future allowance prevents boundary loss from clock skew.
    to: new Date(safeNowMs + 2 * 60 * 1000).toISOString(),
  };
}

async function fetchFinlightReutersFeed({ now = new Date() } = {}) {
  if (!FINLIGHT_API_KEY) {
    const error = new Error("Missing FINLIGHT_API_KEY");
    error.httpStatus = null;
    throw error;
  }

  const liveWindow = buildLiveWindow(now);
  const url = `${FINLIGHT_BASE}${SOURCE_ENDPOINT}`;
  const requestedAtUtc = new Date().toISOString();

  // IMPORTANT:
  // There is intentionally NO semantic query here.
  //
  // The prior version searched five narrow phrases. That caused low recall
  // because a Reuters story could be economically relevant while using
  // different wording.
  //
  // This version asks Finlight for the broad recent Reuters feed and lets
  // engine25NewsFilter.js own relevance/classification/materiality.
  const requestBody = {
    sources: FINLIGHT_SOURCE_FILTER,
    from: liveWindow.from,
    to: liveWindow.to,
    language: "en",
    orderBy: "createdAt",
    order: "DESC",
    pageSize: pageSize(),
  };

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-KEY": FINLIGHT_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  const receivedAtUtc = new Date().toISOString();

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(
      `Finlight Reuters feed HTTP ${response.status} ${text.slice(0, 500)}`
    );
    error.httpStatus = response.status;
    throw error;
  }

  const json = await readJsonResponse(response, "Finlight Reuters live feed");
  const articles = Array.isArray(json?.articles) ? json.articles : [];

  return {
    httpStatus: response.status,
    providerFetchedAtUtc: receivedAtUtc,
    results: articles,
    liveWindow,
    providerDiagnostics: {
      requestedAtUtc,
      receivedAtUtc,
      page: Number.isFinite(Number(json?.page)) ? Number(json.page) : null,
      pageSize: Number.isFinite(Number(json?.pageSize))
        ? Number(json.pageSize)
        : requestBody.pageSize,
      articleCount: articles.length,
      requestBody: {
        ...requestBody,
        // Explicitly document that no query filter was used.
        query: null,
      },
    },
  };
}

function metricStats(values) {
  const valid = values.map(Number).filter(Number.isFinite);

  return {
    eventCountMeasured: valid.length,
    minMs: valid.length ? Math.min(...valid) : null,
    maxMs: valid.length ? Math.max(...valid) : null,
    averageMs: valid.length
      ? Math.round(
          valid.reduce((sum, value) => sum + value, 0) / valid.length
        )
      : null,
  };
}

export async function buildAndWriteEngine25NewsEvents({
  now = new Date(),
  fetcher = fetchFinlightReutersFeed,
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
      normalized.events.map(
        (event) => event?.publisherToFinlightLatencyMs
      )
    );

    const finlightToEngine = metricStats(
      normalized.events.map(
        (event) => event?.finlightToEngineFetchLatencyMs
      )
    );

    const publishedToEngine = metricStats(
      normalized.events.map(
        (event) => event?.publishedToEngineFetchLatencyMs
      )
    );

    const activeMaterialEvents = normalized.events.filter((event) => {
      const expiresMs = Date.parse(event?.expiresAt || "");

      return (
        event?.material === true &&
        String(event?.status || "").toUpperCase() !== "EVENT_EXPIRED" &&
        Number.isFinite(expiresMs) &&
        now.getTime() < expiresMs
      );
    });

    const output = {
      ok: true,
      engine: ENGINE25_NEWS_ENGINE,
      source: ENGINE25_NEWS_SOURCE,
      generatedAtUtc,
      providerFetchedAtUtc: fetched.providerFetchedAtUtc,
      feedAsOfUtc,
      sourceEndpoint: SOURCE_ENDPOINT,
      sourceFilters: FINLIGHT_SOURCE_FILTER,
      discoveryMode: "BROAD_REUTERS_LIVE_FEED",
      semanticQueryApplied: false,
      liveWindow: fetched.liveWindow || liveWindow,
      httpStatus: fetched.httpStatus ?? 200,
      itemsFetched: normalized.itemsFetched,
      itemsRelevant: normalized.itemsRelevant,
      itemsMaterial: normalized.itemsMaterial,
      activeMaterialCount: activeMaterialEvents.length,
      latency: {
        publisherToFinlight,
        finlightToEngine,
        publishedToEngine,
      },
      providerDiagnostics: fetched.providerDiagnostics || null,
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

  if (!output.ok) {
    process.exitCode = 1;
  }
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
