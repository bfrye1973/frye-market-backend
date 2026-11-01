# Engine 22G → Engine 2D: integration-ready development handoff

**Status: isolated development acceptance passed; no production merge or deployment.**

Backend combined draft PR #241: https://github.com/bfrye1973/frye-market-backend/pull/241
Frontend isolated PR #135: https://github.com/bfrye1973/Frye-Dashboard/pull/135

The dedicated `Engine22 Combined Chart History Acceptance` GitHub Actions run #41274456179 completed SUCCESS on commit `8b3790d7c9f41832a2384cbb30600b856d91e8fb`.

## Where Engine 2D gets the data

Existing strategy snapshot:
- `strategies["intraday_scalp@10m"].engine22WaveStrategy.chartAnchors` — current owner-selected seven-degree read-only chart contract
- `strategies["intraday_scalp@10m"].engine22WaveHistory` — latest captured revision and full latest observation, **only available when durable journal is active**

Authenticated server-side history:
- `GET /api/engine22/wave-history?afterRevision=0&limit=50` — paginated previous revisions
- `GET /api/engine22/wave-history/workbook` — Excel workbook download
- Both require backend `Authorization: Bearer <ENGINE22_WAVE_HISTORY_READ_TOKEN>` (minimum 32 characters); never put this token into browser JavaScript.

## Storage and automatic updates

Owner-approved Render service: `frye-market-backend-1`, 100GB persistent disk mounted at `/var/data/replay`.
Dedicated Engine22 folder: `/var/data/replay/engine22-wave-history/`.
On each successful ES Strategy-card snapshot build, Engine22 checks for changed authoritative wave data; changes append a journal revision and regenerate `Frye_Elliott_Wave_History.xlsx` with current anchors, complete history, change log, before/after changes, Fibonacci history and all seven degree tabs. Repeated identical content is deduplicated.

## Safety and limitations

- Preserve all owner-selected wave models, original Fibonacci prices and evidence. No recalculation or trade-permission changes.
- Keep two Submicro alternatives and separate Subminute WICK/BODY groups.
- `plotAllowed:false`, `priceBasis:"UNVERIFIED"` until independent ES price-basis verification. Missing anchor timestamps cannot be invented.
- Initial journal event is a baseline observation, **not** a historical backtest prediction.
- The dedicated CI is a deterministic combined integration test, **not** a real Render restart/deploy or an authenticated live full-strategy snapshot test.
- Production history API and Excel link do not exist until approved deployment and secret configuration.
- Owner authorization for storage is not authorization to merge or deploy.

## Engine 2D action now

You can proceed immediately with isolated read-only consumer implementation and acceptance using PR #241 and the generated development contract. Do not wait for a production deployment to build the consumer. Defer live polling, permanent history claims and actual plotting until runtime/storage and price-basis gates are accepted.
