// services/core/jobs/updateEngine25NewsEvents.js
// Engine 25 Finlight News REST Fallback v0.4
//
// ROLE:
// - WebSocket listener is PRIMARY live Reuters ingestion.
// - This REST job is FALLBACK / RECOVERY / BACKFILL.
// - It MUST merge with existing WebSocket events instead of replacing them.
//
// NEWS IDENTIFIES THE EVENT.
// MARKETS CONFIRM THE EVENT.
// ENGINE 25 INTERPRETS THE RESULT.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  ENGINE25_NEWS_ENGINE,
  ENGINE25_NEWS_SOURCE,
  normalizeFinlightNews,
  dedupeEngine25NewsEvents,
} from "../logic/engine25NewsFilter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-news-events.json");

const FINLIGHT_BASE = "https://api.finlight.me";
const SOURCE_ENDPOINT = "/v2/articles";
const FINLIGHT_SOURCE_FILTER = Object.freeze(["www.reuters.com"]);

const FINLIGHT_API_KEY =
  process.env.FINLIGHT_API_KEY ||
  process.env.FINLIGHT_KEY ||
  "";

const DEFAULT_LIVE_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 100;
const RETENTION_HOURS = 48;

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

function readExistingFile() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    return {
      ok: true,
      engine: ENGINE25_NEWS_ENGINE,
      source: ENGINE25_NEWS_SOURCE,
      events: [],
      warnings: [],
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));

    return {
      ...raw,
      events: Array.isArray(raw?.events) ? raw.events : [],
      warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
    };
  } catch (error) {
    return {
      ok: true,
      engine: ENGINE25_NEWS_ENGINE,
      source: ENGINE25_NEWS_SOURCE,
      events: [],
      warnings: [
        `ENGINE25_NEWS_EVENTS_FILE_RECOVERY:${error?.message || String(error)}`,
      ],
    };
  }
}

function failureOutput({
  generatedAtUtc,
  httpStatus = null,
  warning = "FINLIGHT_NEWS_UNAVAILABLE",
  window = null,
} = {}) {
  const existing = readExistingFile();

  return {
    ...existing,
    ok: false,
    engine: ENGINE25_NEWS_ENGINE,
    source: ENGINE25_NEWS_SOURCE,
    generatedAtUtc,
    sourceEndpoint: SOURCE_ENDPOINT,
    sourceFilters: FINLIGHT_SOURCE_FILTER,
    discoveryMode: "FINLIGHT_REST_FALLBACK_MERGE",
    liveWindow: window,
    httpStatus,
    warnings: [
      ...new Set([
        ...(existing.warnings || []),
        warning,
      ]),
    ],
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

async function fetchFinlightReutersFeed({ now = new Date() } = {}) {
  if (!FINLIGHT_API_KEY) {
    const error = new Error("Missing FINLIGHT_API_KEY");
    error.httpStatus = null;
    throw error;
  }

  const liveWindow = buildLiveWindow(now);
  const url = `${FINLIGHT_BASE}${SOURCE_ENDPOINT}`;
  const requestedAtUtc = new Date().toISOString();

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

  const json = await readJsonResponse(response, "Finlight Reuters REST fallback");
  const articles = Array.isArray(json?.articles) ? json.articles : [];

  return {
    httpStatus: response.status,
    providerFetchedAtUtc: receivedAtUtc,
    results: articles,
    liveWindow,
    providerDiagnostics: {
      transport: "REST",
      role: "FALLBACK_RECOVERY_BACKFILL",
      requestedAtUtc,
      receivedAtUtc,
      page: Number.isFinite(Number(json?.page)) ? Number(json.page) : null,
      pageSize: Number.isFinite(Number(json?.pageSize))
        ? Number(json.pageSize)
        : requestBody.pageSize,
      articleCount: articles.length,
      requestBody,
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
      ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length)
      : null,
  };
}

function refreshEventStatus(event, nowMs) {
  const expiresMs = Date.parse(event?.expiresAt || "");
  const expired =
    !Number.isFinite(expiresMs) ||
    nowMs >= expiresMs;

  return {
    ...event,
    status: expired ? "EVENT_EXPIRED" : "EVENT_DETECTED",
  };
}

function retainRecentEvents(events, nowMs) {
  const cutoffMs = nowMs - RETENTION_HOURS * 60 * 60 * 1000;

  return events.filter((event) => {
    const observedMs = Date.parse(event?.observedAt || "");
    const expiresMs = Date.parse(event?.expiresAt || "");

    const active =
      Number.isFinite(expiresMs) &&
      nowMs < expiresMs;

    const recent =
      Number.isFinite(observedMs) &&
      observedMs >= cutoffMs;

    return active || recent;
  });
}

function maxIso(values = []) {
  const valid = values
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);

  if (!valid.length) return null;
  return new Date(Math.max(...valid)).toISOString();
}

function mergeEvents(existingEvents, fetchedEvents, nowMs) {
  return retainRecentEvents(
    dedupeEngine25NewsEvents([
      ...(existingEvents || []),
      ...(fetchedEvents || []),
    ]).map((event) => refreshEventStatus(event, nowMs)),
    nowMs
  );
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

    // IMPORTANT:
    // Read the existing file AFTER the network request so WebSocket events
    // received while REST was fetching are less likely to be lost.
    let existing = readExistingFile();
    let existingMtimeMs = fs.existsSync(OUTPUT_FILE)
      ? fs.statSync(OUTPUT_FILE).mtimeMs
      : null;

    let mergedEvents = mergeEvents(
      existing.events,
      normalized.events,
      now.getTime()
    );

    // One optimistic-concurrency retry:
    // if the WebSocket updated the file after our read, merge that newer copy too.
    const latestMtimeMs = fs.existsSync(OUTPUT_FILE)
      ? fs.statSync(OUTPUT_FILE).mtimeMs
      : null;

    if (
      Number.isFinite(existingMtimeMs) &&
      Number.isFinite(latestMtimeMs) &&
      latestMtimeMs > existingMtimeMs
    ) {
      existing = readExistingFile();

      mergedEvents = mergeEvents(
        existing.events,
        normalized.events,
        now.getTime()
      );
    }

    const activeMaterialEvents = mergedEvents.filter((event) => {
      const expiresMs = Date.parse(event?.expiresAt || "");

      return (
        event?.material === true &&
        String(event?.status || "").toUpperCase() !== "EVENT_EXPIRED" &&
        Number.isFinite(expiresMs) &&
        now.getTime() < expiresMs
      );
    });

    const publisherToFinlight = metricStats(
      mergedEvents.map((event) => event?.publisherToFinlightLatencyMs)
    );

    const finlightToEngine = metricStats(
      mergedEvents.map((event) => event?.finlightToEngineFetchLatencyMs)
    );

    const publishedToEngine = metricStats(
      mergedEvents.map((event) => event?.publishedToEngineFetchLatencyMs)
    );

    const output = {
      ...existing,
      ok: true,
      engine: ENGINE25_NEWS_ENGINE,
      source: ENGINE25_NEWS_SOURCE,
      generatedAtUtc,
      providerFetchedAtUtc: fetched.providerFetchedAtUtc,
      feedAsOfUtc: maxIso(
        mergedEvents.map((event) => event?.observedAt)
      ),
      sourceEndpoint: SOURCE_ENDPOINT,
      sourceFilters: FINLIGHT_SOURCE_FILTER,
      discoveryMode: "FINLIGHT_REST_FALLBACK_MERGE",
      semanticQueryApplied: false,
      liveWindow: fetched.liveWindow || liveWindow,
      httpStatus: fetched.httpStatus ?? 200,
      itemsFetched: mergedEvents.length,
      itemsRelevant: mergedEvents.length,
      itemsMaterial: mergedEvents.filter(
        (event) => event?.material === true
      ).length,
      activeMaterialCount: activeMaterialEvents.length,
      latency: {
        publisherToFinlight,
        finlightToEngine,
        publishedToEngine,
      },
      providerDiagnostics: {
        ...(existing.providerDiagnostics || {}),
        restFallback: fetched.providerDiagnostics || null,
      },
      events: mergedEvents,
      warnings: Array.isArray(existing.warnings)
        ? existing.warnings.filter(
            (warning) =>
              warning !== "FINLIGHT_NEWS_UNAVAILABLE" &&
              warning !== "MASSIVE_BENZINGA_NEWS_UNAVAILABLE"
          )
        : [],
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

    // Failure remains non-fatal and preserves any existing WebSocket events.
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
