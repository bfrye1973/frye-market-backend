import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cron from 'node-cron';
import { CONFIG } from './config.js';
import { buildRouter } from './api/routes.js';
import { loadSectors } from './data/constituents.js';
import { bootstrapHistory } from './jobs/bootstrapHistory.js';
import { computeMetrics } from './jobs/refreshMetrics.js';
import { startPolygonWS } from './polygon/ws.js';
import { Store } from './data/store.js';

const app = express();
app.use('/api', buildRouter());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const sockets = new Set();

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
});

function broadcast(payload) {
  const msg = JSON.stringify({ type: 'metrics', payload });
  for (const ws of sockets) { try { ws.send(msg); } catch {} }
}

(async function main() {
  const sectors = loadSectors();
  const allTickers = [...new Set(Object.values(sectors).flat())];

  console.log(`[boot] sectors=${Object.keys(sectors).length}, tickers=${allTickers.length}`);

  // 1) History bootstrap (for ADR & NH/NL)
  await bootstrapHistory(allTickers);

  // 2) First compute + broadcast
  computeMetrics(sectors, broadcast);

  // 3) Polygon WS: aggregate updates updating today's daily bar
  const stopWS = startPolygonWS({
    symbols: allTickers,
    onAgg: ({ symbol, time, open, high, low, close }) => {
      Store.setTodaySample(symbol, { t: time, o: open, h: high, l: low, c: close });
    },
    onError: (e) => console.error('Polygon WS error', e?.message || e)
  });

  // 4) Recompute & broadcast every minute
  setInterval(() => computeMetrics(sectors, broadcast), 60_000);

  // 5) Nightly full refresh at 10:30pm UTC (adjust as desired)
  cron.schedule('30 22 * * 1-5', async () => {
    await bootstrapHistory(allTickers);
    computeMetrics(sectors, broadcast);
  });

  server.listen(CONFIG.port, () => {
    console.log(`Market backend up on http://localhost:${CONFIG.port}`);
  });

  process.on('SIGINT', () => { stopWS?.(); process.exit(0); });
})();
