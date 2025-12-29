// src/services/streamer/polygonPump.js
// Polygon WebSocket → in-memory last-bar per symbol → fan-out to SSE clients
//
// Purpose: provide SAME-DAY intraday bars via backend-2, since Polygon REST may block "today" AGGs.
// This module does NOT serve HTTP. It only feeds streamRouter with bars.

import WebSocket from "ws";

const KEY =
  process.env.POLYGON_API_KEY ||
  process.env.POLYGON_API ||
  process.env.POLY_API_KEY ||
  "";

const DEFAULT_SYMBOLS = ["SPY", "QQQ"];

// Polygon Stocks WS endpoint
const WS_URL = "wss://socket.polygon.io/stocks";

// Simple helpers
const nowIso = () => new Date().toISOString();

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export function startPolygonPump({
  symbols = DEFAULT_SYMBOLS,
  onAggBar,          // function(bar) where bar = {symbol, time, open, high, low, close, volume}
  log = console.log,
} = {}) {
  if (!KEY) {
    log("[polygonPump] Missing POLYGON_API_KEY — pump not started");
    return { stop() {} };
  }

  let ws = null;
  let stopped = false;
  let reconnectTimer = null;

  const subs = symbols.map((s) => `AM.${String(s).toUpperCase()}`).join(",");

  function connect() {
    if (stopped) return;

    log(`[polygonPump] connecting WS ${WS_URL} …`);
    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      log("[polygonPump] WS open");
      // auth
      ws.send(JSON.stringify({ action: "auth", params: KEY }));
      // subscribe to minute aggregates
      ws.send(JSON.stringify({ action: "subscribe", params: subs }));
      log(`[polygonPump] subscribed: ${subs}`);
    });

    ws.on("message", (buf) => {
      const msg = safeJsonParse(buf.toString("utf8"));
      if (!msg) return;

      // Polygon sends arrays of events
      if (Array.isArray(msg)) {
        for (const ev of msg) handleEvent(ev);
      } else {
        handleEvent(msg);
      }
    });

    ws.on("close", (code, reason) => {
      log(`[polygonPump] WS closed code=${code} reason=${String(reason || "")}`);
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      log(`[polygonPump] WS error: ${err?.message || err}`);
      try { ws.close(); } catch {}
    });
  }

  function handleEvent(ev) {
    // Status / auth messages
    if (ev?.ev === "status") {
      // e.g. {ev:"status", status:"auth_success", message:"authenticated"}
      log(`[polygonPump] status: ${ev.status || ""} ${ev.message || ""}`.trim());
      return;
    }

    // Aggregate Minute event: ev === "AM"
    if (ev?.ev === "AM") {
      // fields: sym, s (start ms), o,h,l,c,v
      const sym = String(ev.sym || "").toUpperCase();
      const tMs = Number(ev.s);
      if (!sym || !Number.isFinite(tMs)) return;

      const bar = {
        symbol: sym,
        time: Math.floor(tMs / 1000), // seconds
        open: Number(ev.o),
        high: Number(ev.h),
        low: Number(ev.l),
        close: Number(ev.c),
        volume: Number(ev.v ?? 0),
      };

      // sanity
      if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) return;

      try {
        onAggBar?.(bar);
      } catch {}
      return;
    }

    // If you ever want second bars: ev === "A"
  }

  function scheduleReconnect() {
    if (stopped) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      try { ws?.terminate?.(); } catch {}
      ws = null;
      connect();
    }, 2500);
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { ws?.close?.(); } catch {}
      ws = null;
      log(`[polygonPump] stopped ${nowIso()}`);
    },
  };
}
