// routes/stream.js
import express from "express";
import WebSocket from "ws";

// SSE helper
function sseInit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":ok\n\n");
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// Align timestamp to bucket start
function bucketStartSec(sec, tfMin) {
  return sec - (sec % (tfMin * 60));
}

export default function streamRouter() {
  const router = express.Router();

  // Example: /stream/agg?symbol=SPY&tf=10m
  router.get("/agg", (req, res) => {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfStr = String(req.query.tf || "10m").toLowerCase();
    const tfMin = tfStr.endsWith("m") ? Number(tfStr.replace("m", "")) : 1;

    sseInit(res);

    const key = process.env.POLYGON_API_KEY;
    if (!key) {
      sseSend(res, { ok: false, error: "Missing POLYGON_API_KEY" });
      res.end();
      return;
    }

    const ws = new WebSocket("wss://socket.polygon.io/stocks");
    let alive = true;
    let current = null;

    req.on("close", () => {
      alive = false;
      try { ws.close(); } catch {}
    });

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: "auth", params: key }));
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
    };

    ws.onmessage = (ev) => {
      if (!alive) return;

      let arr;
      try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const msg of arr) {
        if (msg?.ev !== "AM" || msg?.sym !== symbol) continue;

        // Polygon sends aggregate start time in ms in field `s`
        const startMs = Number(msg.s);
        if (!Number.isFinite(startMs) || startMs <= 0) continue;

        const startSec = Math.floor(startMs / 1000);
        const bStart = bucketStartSec(startSec, tfMin);

        const o = Number(msg.o),
          h = Number(msg.h),
          l = Number(msg.l),
          c = Number(msg.c),
          v = Number(msg.v || 0);

        if (![o, h, l, c].every(Number.isFinite)) continue;

        if (!current || current.time < bStart) {
          current = { time: bStart, open: o, high: h, low: l, close: c, volume: v };
        } else {
          current.high = Math.max(current.high, h);
          current.low = Math.min(current.low, l);
          current.close = c;
          current.volume = (current.volume || 0) + v;
        }

        sseSend(res, { ok: true, type: "bar", symbol, tf: tfStr, bar: current });
      }
    };

    ws.onerror = (err) => {
      console.error("Polygon WS error:", err);
      sseSend(res, { ok: false, error: "WebSocket error" });
    };
  });

  return router;
}
