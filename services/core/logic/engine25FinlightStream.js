// services/core/logic/engine25FinlightStream.js
// Engine 25 Finlight Reuters WebSocket v0.2 — continuation-thread aware
//
// PRIMARY LIVE NEWS LANE
// Finlight raw WebSocket -> Reuters-only -> existing Engine 25 classifier
// -> merge/dedupe -> data/engine25-news-events.json
//
// Safety:
// - News identifies events only.
// - No MACRO_SHOCK from news alone.
// - No LONG/SHORT.
// - No permission/execution authority.
// - Existing Engine 25 market-confirmation logic remains authoritative.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import WebSocket from "ws";

import {
  ENGINE25_NEWS_ENGINE,
  ENGINE25_NEWS_SOURCE,
  normalizeFinlightArticle,
  dedupeEngine25NewsEvents,
  buildEngine25NewsThreads,
} from "./engine25NewsFilter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-news-events.json");

const FINLIGHT_WS_URL = "wss://wss.finlight.me/raw";
const FINLIGHT_API_KEY =
  process.env.FINLIGHT_API_KEY ||
  process.env.FINLIGHT_KEY ||
  "";

const STREAM_ENABLED =
  String(process.env.ENGINE25_FINLIGHT_STREAM_ENABLED ?? "true")
    .trim()
    .toLowerCase() !== "false";

const RETENTION_HOURS = 48;
const HEARTBEAT_MS = 25_000;
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

let socket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectDelayMs = RECONNECT_MIN_MS;
let started = false;
let stopping = false;

const streamState = {
  enabled: STREAM_ENABLED,
  started: false,
  connected: false,
  admitted: false,
  leaseId: null,
  connectedAtUtc: null,
  admittedAtUtc: null,
  lastArticleAtUtc: null,
  lastArticlePublishedAtUtc: null,
  lastArticleTitle: null,
  lastPongAtUtc: null,
  lastError: null,
  reconnectCount: 0,
  articlesReceived: 0,
  articlesNormalized: 0,
  articlesRejectedByClassifier: 0,
};

function nowIso() {
  return new Date().toISOString();
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function readExistingNewsFile() {
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

    const stillActive =
      Number.isFinite(expiresMs) &&
      nowMs < expiresMs;

    const recent =
      Number.isFinite(observedMs) &&
      observedMs >= cutoffMs;

    return stillActive || recent;
  });
}

function maxIso(values = []) {
  const valid = values
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);

  if (!valid.length) return null;
  return new Date(Math.max(...valid)).toISOString();
}

function buildMergedOutput(newEvent, receivedAtUtc) {
  const nowMs = Date.parse(receivedAtUtc) || Date.now();
  const current = readExistingNewsFile();

  const merged = dedupeEngine25NewsEvents([
    ...(current.events || []),
    newEvent,
  ])
    .map((event) => refreshEventStatus(event, nowMs));

  const retained = retainRecentEvents(merged, nowMs);

  const activeMaterialEvents = retained.filter((event) => {
    const expiresMs = Date.parse(event?.expiresAt || "");

    return (
      event?.material === true &&
      String(event?.status || "").toUpperCase() !== "EVENT_EXPIRED" &&
      Number.isFinite(expiresMs) &&
      nowMs < expiresMs
    );
  });

  const previousStream =
    current?.providerDiagnostics?.stream &&
    typeof current.providerDiagnostics.stream === "object"
      ? current.providerDiagnostics.stream
      : {};

  const eventThreads = buildEngine25NewsThreads(retained);

  return {
    ...current,
    ok: true,
    engine: ENGINE25_NEWS_ENGINE,
    source: ENGINE25_NEWS_SOURCE,
    generatedAtUtc: receivedAtUtc,
    providerFetchedAtUtc: receivedAtUtc,
    feedAsOfUtc: maxIso(retained.map((event) => event?.observedAt)),
    sourceEndpoint: "wss://wss.finlight.me/raw",
    sourceFilters: ["www.reuters.com"],
    discoveryMode: "FINLIGHT_WEBSOCKET_PRIMARY",
    semanticQueryApplied: false,
    httpStatus: null,
    itemsFetched: retained.length,
    itemsRelevant: retained.length,
    itemsMaterial: retained.filter((event) => event?.material === true).length,
    activeMaterialCount: activeMaterialEvents.length,
    eventThreads,
    providerDiagnostics: {
      ...(current.providerDiagnostics || {}),
      stream: {
        ...previousStream,
        transport: "WEBSOCKET",
        sourceFilter: "www.reuters.com",
        connected: streamState.connected,
        admitted: streamState.admitted,
        leaseId: streamState.leaseId,
        connectedAtUtc: streamState.connectedAtUtc,
        admittedAtUtc: streamState.admittedAtUtc,
        lastArticleAtUtc: receivedAtUtc,
        lastArticlePublishedAtUtc: newEvent?.observedAt || null,
        lastArticleTitle: newEvent?.headlineSummary || null,
        articlesReceived: streamState.articlesReceived,
        articlesNormalized: streamState.articlesNormalized,
        articlesRejectedByClassifier:
          streamState.articlesRejectedByClassifier,
        reconnectCount: streamState.reconnectCount,
        lastPongAtUtc: streamState.lastPongAtUtc,
        lastError: streamState.lastError,
      },
    },
    events: retained,
    warnings: Array.isArray(current.warnings)
      ? current.warnings.filter(
          (warning) =>
            warning !== "FINLIGHT_NEWS_UNAVAILABLE" &&
            warning !== "MASSIVE_BENZINGA_NEWS_UNAVAILABLE"
        )
      : [],
  };
}

function persistStreamDiagnostics() {
  const current = readExistingNewsFile();

  const output = {
    ...current,
    ok: current?.ok !== false,
    engine: ENGINE25_NEWS_ENGINE,
    source: ENGINE25_NEWS_SOURCE,
    providerDiagnostics: {
      ...(current.providerDiagnostics || {}),
      stream: {
        transport: "WEBSOCKET",
        sourceFilter: "www.reuters.com",
        connected: streamState.connected,
        admitted: streamState.admitted,
        leaseId: streamState.leaseId,
        connectedAtUtc: streamState.connectedAtUtc,
        admittedAtUtc: streamState.admittedAtUtc,
        lastArticleAtUtc: streamState.lastArticleAtUtc,
        lastArticlePublishedAtUtc:
          streamState.lastArticlePublishedAtUtc,
        lastArticleTitle: streamState.lastArticleTitle,
        lastPongAtUtc: streamState.lastPongAtUtc,
        reconnectCount: streamState.reconnectCount,
        articlesReceived: streamState.articlesReceived,
        articlesNormalized: streamState.articlesNormalized,
        articlesRejectedByClassifier:
          streamState.articlesRejectedByClassifier,
        lastError: streamState.lastError,
      },
    },
  };

  atomicWriteJson(OUTPUT_FILE, output);
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(reason = "UNKNOWN") {
  if (stopping || !STREAM_ENABLED) return;

  clearReconnectTimer();

  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(
    RECONNECT_MAX_MS,
    Math.round(reconnectDelayMs * 1.7)
  );

  streamState.reconnectCount += 1;
  streamState.lastError = `RECONNECT:${reason}`;
  persistStreamDiagnostics();

  console.warn(
    `[engine25-finlight-stream] reconnect in ${delay}ms | reason=${reason}`
  );

  reconnectTimer = setTimeout(() => {
    connect();
  }, delay);
}

function startHeartbeat() {
  clearHeartbeat();

  heartbeatTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    try {
      socket.send(
        JSON.stringify({
          action: "ping",
          t: Date.now(),
        })
      );
    } catch (error) {
      streamState.lastError =
        `HEARTBEAT_SEND_FAILED:${error?.message || String(error)}`;
    }
  }, HEARTBEAT_MS);
}

function handleArticle(article) {
  const receivedAtUtc = nowIso();

  streamState.articlesReceived += 1;
  streamState.lastArticleAtUtc = receivedAtUtc;

  const normalized = normalizeFinlightArticle(
    article,
    new Date(receivedAtUtc),
    receivedAtUtc
  );

  if (!normalized) {
    streamState.articlesRejectedByClassifier += 1;
    persistStreamDiagnostics();
    return;
  }

  streamState.articlesNormalized += 1;
  streamState.lastArticlePublishedAtUtc = normalized.observedAt;
  streamState.lastArticleTitle = normalized.headlineSummary;

  const output = buildMergedOutput(normalized, receivedAtUtc);
  atomicWriteJson(OUTPUT_FILE, output);

  console.log(
    `[engine25-finlight-stream] EVENT ${normalized.eventType} material=${normalized.material} severity=${normalized.severity} source=${normalized.source} title="${normalized.headlineSummary}"`
  );
}

function handleMessage(raw) {
  let message = null;

  try {
    message = JSON.parse(raw.toString());
  } catch {
    console.warn("[engine25-finlight-stream] non-JSON message ignored");
    return;
  }

  if (message?.action === "admit") {
    streamState.admitted = true;
    streamState.admittedAtUtc = nowIso();
    streamState.leaseId = message?.leaseId || null;
    streamState.lastError = null;
    reconnectDelayMs = RECONNECT_MIN_MS;

    persistStreamDiagnostics();

    console.log(
      `[engine25-finlight-stream] ADMITTED leaseId=${streamState.leaseId || "none"}`
    );
    return;
  }

  if (message?.action === "pong") {
    streamState.lastPongAtUtc = nowIso();
    return;
  }

  if (message?.action === "sendArticle") {
    handleArticle(message?.data || {});
    return;
  }

  if (message?.action === "error") {
    streamState.lastError =
      `PROVIDER_ERROR:${message?.message || JSON.stringify(message)}`;
    persistStreamDiagnostics();
    console.error(
      "[engine25-finlight-stream] provider error:",
      message?.message || message
    );
  }
}

function connect() {
  if (stopping || !STREAM_ENABLED) return;

  if (!FINLIGHT_API_KEY) {
    streamState.lastError = "MISSING_FINLIGHT_API_KEY";
    persistStreamDiagnostics();
    console.warn(
      "[engine25-finlight-stream] disabled: missing FINLIGHT_API_KEY"
    );
    return;
  }

  if (
    socket &&
    [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)
  ) {
    return;
  }

  clearReconnectTimer();

  streamState.connected = false;
  streamState.admitted = false;
  streamState.leaseId = null;

  console.log("[engine25-finlight-stream] connecting...");

  socket = new WebSocket(FINLIGHT_WS_URL, {
    headers: {
      "x-api-key": FINLIGHT_API_KEY,
    },
  });

  socket.on("open", () => {
    streamState.connected = true;
    streamState.connectedAtUtc = nowIso();
    streamState.lastError = null;

    console.log("[engine25-finlight-stream] CONNECTED");

    socket.send(
      JSON.stringify({
        clientNonce: randomUUID(),
        query: "source:www.reuters.com",
        language: "en",
      })
    );

    startHeartbeat();
    persistStreamDiagnostics();
  });

  socket.on("message", handleMessage);

  socket.on("error", (error) => {
    streamState.lastError =
      `WS_ERROR:${error?.message || String(error)}`;
    persistStreamDiagnostics();

    console.error(
      "[engine25-finlight-stream] websocket error:",
      error?.message || error
    );
  });

  socket.on("close", (code, reasonBuffer) => {
    clearHeartbeat();

    const reason = reasonBuffer?.toString?.() || "";
    streamState.connected = false;
    streamState.admitted = false;
    streamState.leaseId = null;
    streamState.lastError = `CLOSED:${code}:${reason}`;

    persistStreamDiagnostics();

    console.warn(
      `[engine25-finlight-stream] CLOSED code=${code} reason=${reason || "none"}`
    );

    socket = null;

    scheduleReconnect(`CLOSE_${code}`);
  });
}

export function startEngine25FinlightStream() {
  if (started) {
    return getEngine25FinlightStreamStatus();
  }

  started = true;
  stopping = false;
  streamState.started = true;

  if (!STREAM_ENABLED) {
    console.log(
      "[engine25-finlight-stream] disabled by ENGINE25_FINLIGHT_STREAM_ENABLED=false"
    );
    return getEngine25FinlightStreamStatus();
  }

  connect();
  return getEngine25FinlightStreamStatus();
}

export function stopEngine25FinlightStream() {
  stopping = true;
  clearHeartbeat();
  clearReconnectTimer();

  if (socket) {
    try {
      socket.close(1000, "ENGINE25_STREAM_STOP");
    } catch {
      // Best-effort shutdown only.
    }
  }

  socket = null;
  streamState.connected = false;
  streamState.admitted = false;
  streamState.leaseId = null;
}

export function getEngine25FinlightStreamStatus() {
  return {
    ...streamState,
  };
}

export default {
  startEngine25FinlightStream,
  stopEngine25FinlightStream,
  getEngine25FinlightStreamStatus,
};
