# Engine 27 V3 Micro — LIVE SHADOW TEST RELEASE

**Deployment status:** Separate Render preview service created; code startup confirmed LIVE on Render. **Trade-price acceptance: BLOCKED until Polygon futures API credential is set in staging and a real raw T-event trace verified.** No production Backend1/Backend2/frontend changes.

## Owner-authorized scope
Micro first. Read-only, no orders, no broker control. Existing Engine27 A–E/V2 untouched. No 10-minute bars in active V3 price logic.

## Actual isolated preview service
- Name: `engine27-v3-micro-shadow-preview`
- ID: `srv-dbf98oq9lscs7398u5jg`
- Render dashboard: https://dashboard.render.com/web/srv-dbf98oq9lscs7398u5jg
- Protected view URL: https://engine27-v3-micro-shadow-preview.onrender.com/
- Health: https://engine27-v3-micro-shadow-preview.onrender.com/healthz
- Git branch: `engine27-v3-micro-intelligence`, autoDeploy **NO**, Free tier, single instance.
- Start command: `node services/streamer/shadow/microShadowServer.js`
- Render initial deploy `dep-dbf98p29lscs7398u7fg` marked `live`, with application log `Listening, shadow=true; no trading authority` at 2026-10-25T23:45:05Z.
- Follow-up config deploy `dep-dbf98r6gej5s73aceeug` requested after configuring same-instance HTTPS trade URL; verify its final status separately.

## Configured
- `ENGINE27_V3_SHADOW_ENABLED=true`
- Strong Basic Auth username/password provisioned in Render environment (never posted to GitHub; owner retrieves credentials privately).
- Dedicated SSE read token provisioned in Render environment (never posted to GitHub).
- `ENGINE27_V3_SNAPSHOT_URL=https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES`
- `ENGINE27_V3_TRADE_URL=https://engine27-v3-micro-shadow-preview.onrender.com/stream/futures/trades-v3?symbol=ES`

## Blocking credential
Staging `POLYGON_API_KEY` is **not configured by this programmer**, because connected tools do not expose existing secret values and credentials must not be copied in chat. Owner must add a valid Polygon/Massive futures-WebSocket key directly to this preview service under Render **Environment**. Do not expose the key in chat, frontend, logs, or source control. Until set, the view must show `UNAVAILABLE`, not a fake ES trade price.

## Shadow page
- Separate dark Micro-only panel, labeled `ENGINE 27 V3 — MICRO INTELLIGENCE | SHADOW / NOT TRADING`.
- Last source-qualified individual ES trade, resolved contract and feed state.
- Current Engine22 Micro wave, unconfirmed owner state, next provisional Fibonacci reference and live price touch classification.
- Neighboring Submicro/Subminute reads, E25/E29/QQQ/VIX source status, real contract / thesis availability, uncalibrated replay, explicit missing information.
- Basic-Auth HTML and same-origin state JSON; separate protected X-Engine27-V3-Read-Token SSE. No broker/account numbers published beyond masked Micro account identity.
- No production cards overridden.

## Acceptance limitations and safety
- Provider `T` event time is milliseconds; `q` is the unique per-contract sequence, source doc: https://massive.com/docs/websocket/futures/trades. Actual raw q,t sample not yet captured from preview.
- Dedicated staging stream supports one Polygon connection per instance, maximum eight protected internal SSE consumers, and bounded backpressure behavior. Do not expose this endpoint to paying subscriber browsers.
- Consumer maintains bounded dedup ID history, live price continuity resets on reconnect and rollover, and stale source becomes unavailable.
- The screenshot's older Micro card remains unchanged and is separate from new shadow view.
- Engine10 account 6380 REAL open contracts and original immutable `structuralContextAtEntry` not yet verified in staging; Engine9 plan joins and replay calibration still pending. UI must fail closed.
- Render Free preview tier may suspend/idle; prolonged continuous feed acceptance may require owner-approved paid environment.
- Rollback: set `ENGINE27_V3_SHADOW_ENABLED=false`, suspend or delete `srv-dbf98oq9lscs7398u5jg`; no existing production service requires rollback. Feature PR #200 remains draft.

## Test results
- [V3 isolated validation including UI and shadow server syntax PASS](https://github.com/bfrye1973/frye-market-backend/actions/runs/40246072666)
- [Legacy V2 validation PASS on preceding tested commit](https://github.com/bfrye1973/frye-market-backend/actions/runs/40246061934)
- Actual staging service started, independently verified by Render deployment metadata and application log.
- Actual live ES trade source -> protected SSE -> Micro Manager -> UI evidence: **NOT YET VERIFIED**.

**PRODUCTION STATUS: BLOCKED.** Shadow preview itself is isolated and started, but live trade source and private journal evidence incomplete.


## Micro Market Evidence adapter milestone — October 26, 2026 00:54 UTC
Verified directly in current production Backend1 source **code**, not a private runtime dump:
- `snapshot.engine25Context` is explicitly attached to ES snapshot root by `buildStrategySnapshot.js`.
- `snapshot.engine27Strategies.engine27UnifiedMarketContext.tactical` is a read-only derived Engine29 summary with `available, fresh, dataDegraded, timestamp, overallState`. Treat as valid only with explicit summary source identity/freshness, and independently check timestamp in V3.
- `snapshot.engine27Strategies.engine27CrossMarketLevels` canonical `engine27.crossMarketSource.v1`, with QQQ and VIX separate instrument identities.
- `snapshot.engine27Strategies.engine27LiveCrossMarketReactions` canonical `engine27.liveCrossMarketReactions.v1`, with completed hourly reaction events.
- `snapshot.engine27Strategies.engine27EsInstitutionalContext` canonical ES zone context.

V3-only source adapter `marketConfirmation/assembleSnapshotMarketSources.js` passes strictly validated fields into existing V3 `evaluateMarketConfirmation`, and shadow runner `readInputs()` now includes these independent source objects. This **does not** change Engine22, update Engine25/29, aggregate ES prices or invent QQQ/VIX events. Equity-market freshness must still satisfy each source policy; when closed/stale/unavailable, UI stays explicit instead of inferring neutral participation.

**Tests:** all six new field-mapping/fail-closed tests added to V3 isolation workflow, passed. Live Render preview deploy `dep-dbfa99g473hc73cdnj80` verified **LIVE** on feature-branch commit `19cb1519d9944ea71dfc01e26f68c3383416b584`.

**Acceptance boundary:** field *paths and code* verified; actual runtime Engine25/29/QQQ/VIX qualified values NOT independently captured from protected shadow state yet. No claim all 4 sources are CURRENT, and the preview's underlying ES-trade streaming remains independent. Engine10 original immutable entry thesis and official Engine9 plans remain unverified; read-only journal audit is next.

## Observed live protected staging market-source read — 2026-10-26T00:57:06Z
After deploying `dep-dbfaaglg1s2s73f1subg`, I inspected the **single sanitized actual Render application log**, generated on receipt of a valid live ES trade by the Micro Manager. It recorded:
- Engine25: **CURRENT** — `NEUTRAL_CHOP_WITH_RATE_PRESSURE`, no source reason code.
- Engine29: **UNAVAILABLE** — `ENGINE29_SOURCE_UNAVAILABLE` (canonical snapshot-derived tactical source did not qualify; do not replace with guessed neutral).
- QQQ: **PARTIAL / REACTIONS_STALE** — `REACTION_CANDLE_STALE`.
- VIX: **PARTIAL / REACTIONS_STALE** — `REACTION_CANDLE_STALE`.
- Engine1 ES zones: **PARTIAL / ZONE_GEOMETRY_ONLY**. No confirmed reaction inferred.

Only enumerated states/reasons were logged, no raw trade values or account/journal records. This is real staging evidence, not a fixture. Qualified ES trade -> manager callback is confirmed since the log is emitted by `onObservation`; detailed original Engine10 contract provenance and official Engine9 joins remain separately unverified. V3 source freshness correctly fails closed on QQQ/VIX during equity nontrading windows. Further Engine29 source audit should inspect the canonical persisted runtime file and read-only summary endpoint, not fake freshness in V3.
