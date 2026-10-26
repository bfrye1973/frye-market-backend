# Engine27 V3 — Micro read-only Shadow preview
Status: development branch only; not deployed when authored.

## Viewer
`services/streamer/shadow/microShadowView.js` is a standalone, dark-mode Micro-only visual test panel. Label `ENGINE 27 V3 — MICRO INTELLIGENCE / SHADOW NOT TRADING`. Refreshes a same-origin protected read-only state endpoint every 2.5 seconds. It shows real trade price only after a source-qualified observation, real current Engine22 owner direction and provisional next Fib reference, neighbor evidence, four market source states, Engine10 availability and unavailable original entry structure.

## Isolated server
`services/streamer/shadow/microShadowServer.js` runs separately from existing Backend1/Backend2 production services with start command:
`node services/streamer/shadow/microShadowServer.js`
Only routes: `/healthz` (no secrets), `/` (Basic Auth), `/shadow/state` (Basic Auth), `/stream/futures/trades-v3` (dedicated header secret). No existing dashboard route, broker route, or legacy Engine27 endpoint imported.

## Exact staging environment
Required to activate live:
- `ENGINE27_V3_SHADOW_ENABLED=true`
- `ENGINE27_V3_SHADOW_USERNAME` and `ENGINE27_V3_SHADOW_PASSWORD` set independently, sufficiently strong, **never** in a URL.
- `ENGINE27_V3_TRADE_READ_TOKEN` 32+ characters, same internal process trade route + consumer, **never** passed in URL.
- `ENGINE27_V3_SNAPSHOT_URL=https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES` (read-only canonical ES snapshot; actual accessibility/shape to verify)
- `ENGINE27_V3_TRADE_URL=https://<actual-staging-host>/stream/futures/trades-v3?symbol=ES`
- `POLYGON_API_KEY` or existing supported production Polygon futures key, with valid futures WebSocket entitlements. Owner must configure this directly in Render secret settings; key MUST NOT be pasted into chat or GitHub.
- Render `PORT` injected by platform.

Run with **autoDeploy off** until acceptance. No privileged trading credentials copied to staging. No Schwab/Engine10 secrets in preview. Strategy Entry Structure and official plan remain unavailable until separately audited and approved for read-only consumption.

## Preview acceptance
Private owner opens Basic Auth view. `/healthz` confirms service. Require one real provider `T` with millisecond `t`, sequence `q`, correct `ESZ6`-style resolved contract, match `SSE -> Micro consumer -> manager -> /shadow/state`, using provider credential exclusively on server. Confirm stale/disconnect/reconnect, market closed, duplicate and roll, then separate Engine10/Engine9 actual records.
No live trade claim until evidence from this instance. Rollback: set `ENGINE27_V3_SHADOW_ENABLED=false` or suspend/delete the isolated service; live Backend1/2 remain untouched.
