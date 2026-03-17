import WebSocket from 'ws';
import { CONFIG } from '../config.js';

/**
 * Subscribe to Polygon aggregate (A.*) messages for provided symbols.
 * Calls onAgg({ symbol, time, open, high, low, close }) per update.
 */
export function startPolygonWS({ symbols, onAgg, onError }) {
  const url = `wss://socket.polygon.io/stocks`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    ws.send(JSON.stringify({ action: 'auth', params: CONFIG.key }));
    if (symbols?.length) {
      const channels = symbols.map(s => `A.${s}`).join(',');
      ws.send(JSON.stringify({ action: 'subscribe', params: channels }));
    }
  });

  ws.on('message', (raw) => {
    try {
      const arr = JSON.parse(raw.toString());
      for (const msg of arr) {
        if (msg.ev === 'status') continue;
        if (msg.ev === 'A') {
          onAgg?.({
            symbol: msg.sym,
            time: Math.floor(msg.e / 1000), // end time ms -> s
            open: msg.o, high: msg.h, low: msg.l, close: msg.c
          });
        }
      }
    } catch (e) { onError?.(e); }
  });

  ws.on('error', onError);
  ws.on('close', () => setTimeout(() => startPolygonWS({ symbols, onAgg, onError }), 2000));

  return () => { try { ws.close(); } catch {} };
}
