# Market Backend (Polygon)

Real-time sector metrics (New Highs / New Lows / ADR%) streamed to your dashboard.

## Quick start

```bash
cp .env.example .env
# put your Polygon key in .env

npm install
npm start
```

### REST
- `GET /api/health`
- `GET /api/market-metrics`

### WebSocket
- Connect to `ws://localhost:5055` and listen for `{ type: "metrics", payload }`

## Config
- `TIMEFRAME_SEC` (default 300 = 5m) affects recompute cadence.
- `LOOKBACK_DAYS` default 20 for NH/NL and ADR windows.
- Edit `data/sectors.json` to change sector constituents.

## Notes
- Uses Polygon aggregate (A.*) WS to update today's daily bars on the fly.
- Nightly job refreshes historical baselines.
- Optional Redis cache if you set `REDIS_URL`.
