# Engine 22 Wave History V1 — Isolated Proof

Status: **DRAFT / NOT PRODUCTION WIRED**. Owner approved the long-term concept, **not** promotion of the proposed Minor count or production deployment.

## Intended flow

Engine 22 (sole approval and wave authority) → durable event journal → revisioned read API + update notification → Engine 2 read-only chart / master spreadsheet synchronizer.

### First implementation scope

- `services/core/logic/engine22/history/waveHistoryV1.js` validates wave-history events and deterministically replays an ordered stream.
- A repeated identical `eventId` is idempotent; conflicting duplicate IDs, skipped revisions, implicit promotions, and anchor mutation on status-only events fail closed.
- Records explicitly separate `anchor.marketAt` (actual UTC market timestamp, nullable) from `publishedAt` (when interpretation was published). Date/time display can be converted to Arizona without altering the UTC source.
- Research-only counts are preserved but never silently treated as owner-approved.
- `chartNodeFromHistory` **never allows plotting**: Engine 2 still needs explicit contract mapping, timestamp and price-basis verification.

### Not yet implemented (separate review required)

1. Choose reliable durable **multi-writer safe** storage (Render filesystem alone is insufficient if services are distinct, ephemeral, or scale to multiple instances). PostgreSQL with transactional unique event IDs / revision constraints is an option, not yet an approved decision.
2. Append-only persistence, transaction boundaries, recovery backups, state/event checksum verification, and concurrency tests.
3. Full 7-degree parent-node graph checks and model-identity change policy, including new count IDs on recount.
4. Candidate/approval event machine, timestamp provenance, market contract continuity and completed candle validation.
5. Fibonacci anchors/method/raw values and separately append-only authenticated touch events.
6. Read-only paged snapshot/history API, revision cursor, SSE notification, re-fetch after missed events.
7. Export/reconcile the original existing Excel workbook without duplicate master.
8. Engine 2 overlays, as-of historical replay and non-regression testing for 1m/5m/10m/1H/4H candle performance.
9. Owner authorization to activate any production history publishing or change any existing degree selection.

### Protected current behavior

No imports into `buildEngine22WaveStrategy.js` or the existing runtime, no selection revision changes, no execution/trading permissions, and no Render deployment.

### Prototype verification

An equivalent isolated local test run passed **11/11** on November 5, 2026. The GitHub branch test file must be run by CI (and its exact branch head independently verified) before technical acceptance.

### Historical research fixture

Owner-proposed Minor W1: April 30, 2026 17:00 Arizona @ 6485.00 → August 14, 2026 03:00 Arizona @ 7901.75. Minor W2 low ~7325 on November 5 has **UNKNOWN exact time** and must be stored with null marketAt. Neither the Minor recount nor the existing Primary/Intermediate structure is changed by this prototype.
