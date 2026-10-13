# ENGINE 11 — TWO-YEAR ES CALENDAR COMPLETENESS / FINALITY EVIDENCE V1

Engine 2B Lead Manager: ACCEPT or REVISE requested for isolated verification development. Canonical source acceptance remains on hold.

## Ruling and scope

Authority: [PR #111 Manager approval](https://github.com/bfrye1973/frye-market-backend/pull/111#issuecomment-6136909189). This stage investigates October 12, 2024 onward. PR #111's acquisition findings and older research are preserved. Accepted PR #102/#106 modules, consumers and production remain untouched.

Delivered: an unmounted research-only calendar/completeness/finality verifier, exact-integer source capture for raw trades, local/CI sandbox archive and restore verification, finer authentic January 2025 evidence, explicit per-timeframe unavailability and a separately scoped retention proposal. No code emits structuralEligible=true or publishes canonical OHLCV.

## Authentic source findings

Main probe: **32/32 provider queries completed**, using the existing credential, including minute, second and tick-level ES observations. Follow-up: **2/2 guard-window queries completed**. Successful traversals certify acquisition of the returned snapshot, not exchange completeness, correction authority or finality.

### January 30/31, 2025 — conflict narrowed to source trade labels

The anomaly exists in raw trades, seconds and minutes, not only parent aggregation. A complete bounded trade snapshot from 21:54–22:05 UTC returned 981 trades: 291 labeled January 30 and 690 labeled January 31. Both sets use channel 310.

| Boundary observation | Exchange timestamp as returned | Session label | Sequence / report sequence |
|---|---|---|---|
| Last captured January 30 label | `1738274136387378265` = 21:55:36.387378265Z | 2025-01-30 | 58508574 / 55646808 |
| First captured January 31 label | `1738274136407828355` = 21:55:36.407828355Z | 2025-01-31 | 58508612 / 55646833 |

Both occur on January 30, 2025 UTC. Their timestamp difference is 20,450,090 ns. Sequence increments are observed, not proof of missing ES trades: a channel can contain other messages. There is no observed sequence reset or explicit correction relationship in these two records.

The same second bucket contains two session-labeled source observations. Grouping the captured trades by their **original session labels** reproduces all four conflicted 1m/5m records exactly in OHLC, volume and transaction count. January 30's 5m fragment has volume 219 / 92 trades; January 31's fragment has volume 2,080 / 690 trades. This is arithmetic and source-label evidence, not permission to move timestamps, correct session dates, combine prices or declare a canonical candle.

**Cause remains UNRESOLVED.** Both January 30 and 31 schedule queries return empty results. No claim of DST, exchange closure, source defect or actual session transition is justified by the obtained evidence. Provider clarification or independently dated exchange evidence is required.

### Session filter behavior is endpoint-specific

Both native aggregate requests with `session_end_date=2025-01-30` or `2025-01-31` returned the same 78 minute observations as the unfiltered query. They contained 5 and 73 contrary-session rows respectively. The corresponding trade requests returned only their requested session labels (291 and 690 trades). Thus these tested aggregate requests did not enforce the supplied session filter. This is a reproducible compatibility finding, not a universal assertion about all filters/endpoints/dates.

Keep full raw responses; inspect actual row labels independently. A session-filtered request URL alone is never source-membership proof. The exact integer decoder preserves nanosecond timestamps and large sequence identifiers without JavaScript rounding; original decoded response bytes and SHA-256 receipts are retained.

### Full guard window resolves a 4h comparison limitation

The initial minute query ended at 23:00Z while the native 4h parent labeled 20:00Z extends through 24:00Z. Its January 31 fragment therefore did not match the shorter captured minute subset. The independent 20:00–24:00Z follow-up returned 138 minute records and two 4h records. Both exactly match same-session child OHLCV/transactions:

- January 30: 73 children, volume 379,209, transactions 117,639.
- January 31: 65 children, volume 16,603, transactions 7,254.

This resolves the observed arithmetic mismatch as a capture guard limitation; it does not resolve the original session-label cause, canonical 4h alignment or completed-candle authority. Guard windows must cover the whole source parent, including portions beyond the application request edge.

### ESZ2024 remains independently unbound

December 20, 2024 metadata returns ES/XCME, first trade June 4, 2021 and last trade December 20, 2024, without settlement_date. December 21, March 20, 2025 and the current capture date return empty metadata for ESZ4. The existing V2 binding rejects every probe; it is unchanged. Expiry-date arithmetic and last_trade_date are not substituted for missing settlement evidence.

Direct Actions downloads of CME's roll-date page, expiration calendar and ES rulebook all returned HTTP 403; denial body hashes survive in the authentic archive. Public web retrieval exposes current CME roll rows for 2025 onward, not the needed December 2024 contract-specific record. Dated Globex notices inspected for November 2024, January 2025 and November 2025 did not supply the required holiday schedule tables. No independently verified ESZ2024 expiry/settlement record has been obtained.

## Calendar and finality interpretation

The original 732-date ledger remains authoritative research evidence: 390 outright provider candidates, 332 no-event dates, 2 incomplete dates and 8 unknown transition-policy dates. Fresh checks reproduce early-window absence, the March 18 close-only record, multi-day Thanksgiving event labels and the April 3, 2026 provider early close. No date has been promoted to an approved CME calendar.

Massive's [futures-specific explanation](https://massive.com/knowledge-base/article/how-do-i-get-intraday-bars-for-a-futures-contract) documents that daily/session window_start is a midnight label rather than actual session open, and aggregate absence can reflect no trades. This informs research guards, not an accepted ES holiday calendar. Its futures trades response documents timestamps and session/sequence fields, but the captured records contain no explicit completeness watermark, publication-finality certificate or correction/supersession links. Generic stock aggregation late-trade timing is not imported as an ES finality rule.

Identical repeated historical responses demonstrate reproducibility of that snapshot, **not finality**. Fetch receipt time is not first source-publication time. Future scheduled closes are planned events, not evidence that trading has completed.

## Per-timeframe readiness

Native tail capture at approximately 2026-10-13T02:48Z (October 12 evening Phoenix):

| Timeframe | Tail source rows | Latest native observation status | Canonical completion readiness |
|---|---:|---|---|
| 5m | 334 | Partial provider clock window | UNKNOWN_CALENDAR / UNKNOWN_SOURCE_WATERMARK |
| 10m | 167 | Partial provider clock window | UNKNOWN_CALENDAR / UNKNOWN_SOURCE_WATERMARK |
| 1h | 28 | Partial provider clock window | UNKNOWN_CALENDAR / UNKNOWN_SOURCE_WATERMARK |
| 4h | 9 | Partial provider clock window | UNKNOWN_CALENDAR / UNKNOWN_SOURCE_WATERMARK |
| daily/session | 2 | End boundary not independently verified | UNKNOWN_CALENDAR / UNKNOWN_SOURCE_WATERMARK |
| weekly | 1 | End boundary not independently verified | UNKNOWN_CALENDAR / UNKNOWN_SOURCE_WATERMARK |
| monthly | 2 | End boundary not independently verified | UNKNOWN_CALENDAR / UNKNOWN_SOURCE_WATERMARK |

Counts are this bounded tail probe, not the two-year totals. Intraday partial states use explicit unapproved provider clock-window candidates, not canonical session-open alignment. Higher-period ends cannot be inferred by adding 24 hours to native midnight labels. Engine 22 separately decides origin, warm-up and confirmation sufficiency; none of these observations promotes an anchor, wave or Fibonacci level.

## Prototype contract and tests

New files under `services/core/logic/engine11/finalityResearchV1/`:

- `verify.js`: typed research states for calendar partitions, closures, open-session absence, explicit no-trade proof, interval guards, partial periods, period constituents, scoped watermarks, late-publication evidence and unresolved/explicit corrections. Trust envelopes supplied by fixtures must match full contract, series, raw price basis, resolution, calendar, alignment and dataset versions. No source adapter creates such verified envelopes from the current provider responses.
- `sourceCapture.js`: bounded authenticated read-only pagination, same-origin/path/filter cursor checks, original body receipts, rejection of secrets in URLs/bodies, exact unsafe-integer decoding and explicit denied/incomplete captures.
- `archive.js`: bounded local/CI gzip archive with raw/compressed SHA-256 manifests and exact-byte restore, corruption and unsafe path rejection. No disk/service integration.

New scripts/tests under `services/core/tests/engine11/finalityResearch/`; new workflow `.github/workflows/engine11-two-year-finality.yml`. Authentic regression summaries and retention/restore manifests are compact files under `docs/architecture/evidence/`. Full candle/tick response bodies are **not** copied into the source repository.

**280 local tests pass**: 233 inherited plus 47 new. Explicit verified-calendar, no-trade, late-publication and watermark success cases are **synthetic fixtures**, not observed provider guarantees. Authentic tests cover exact raw trade boundaries, preserved conflicting contents, unsupported aggregate filtering, source clock tail partiality and the inability of repeat responses to prove finality. The live jobs additionally hash/restore original provider data and compare complete guard-window parent arithmetic.

## Exact evidence and restore proof

- Authentic probe SHA `ee0b193bcc4bd8bf36b6800684e70b916fb4aaad`, [run 38338605379](https://github.com/bfrye1973/frye-market-backend/actions/runs/38338605379): regression and authentic jobs passed. [Original evidence/CI restore artifact 11785905749](https://github.com/bfrye1973/frye-market-backend/actions/runs/38338605379/artifacts/11785905749), ZIP SHA `baab318e71d79f57f00c7da368c89d499b6bcd73b78a58ee1b10f3215990da9a`.
- Guard SHA `b4b2ba2d2f2e79385333b48e2f87b22651393c78`, [run 38339185603](https://github.com/bfrye1973/frye-market-backend/actions/runs/38339185603): both jobs passed. [Original guard artifact 11785717719](https://github.com/bfrye1973/frye-market-backend/actions/runs/38339185603/artifacts/11785717719), ZIP SHA `7a709ae39f32dd6a142214afa658308d63b683c2f24eb1d9555075c7257b9384`.
- Local independent restore of the existing two-year raw receipt file: **74,028,287 bytes**, 128 original receipt hashes verified, 55,454,297 decoded source body bytes. Gzip: **9,179,132 bytes**. Restored exact file SHA `174886f9b80a1363dc4bd87262b2a4e5fbe004185157c928b4c42a9535e3b1b9`.
- New authentic CI corpus: 2,198,320 raw bytes; 231,044 gzip bytes; exact restore passed. Neither local nor CI scratch is durable storage.
- Compact evidence: `engine11-finality-authentic-summary-v1.json`, `engine11-finality-guard-summary-v1.json`, `engine11-authentic-archive-restore-v1.json`, `engine11-retention-inventory-v1.json` beside prior evidence. Final review head and final-head CI are recorded in the draft PR submission.

## Manager actions / genuine blockers

1. ACCEPT or REVISE this isolated development milestone.
2. Coordinate provider clarification for the exact January trade-label boundary, aggregate session filter behavior, missing early schedules, multi-day pre_open semantics, finality/watermarks and correction identifiers. Evidence supports precise questions; it does not justify guessing answers.
3. Establish an accessible authoritative December 2024 ES expiry/settlement record. Any alternate identity contract requires separate approval; no lifespan-based fallback was implemented.
4. Review the separate `ENGINE11_ZERO_NEW_SPEND_RETENTION_PROPOSAL_V1.md`, designate an existing authorized private destination and independent backup, and authorize transfer explicitly. The full original candle artifact expires **2026-11-12T01:46:58Z = November 11, 2026, 6:46:58 p.m. Phoenix**. Earliest artifact in the six-run inventory expires at 6:00:11 p.m. Phoenix that day. Existing expiry dates were not changed.

Recommended next isolated scope: provider-response reconciliation, separately accepted calendar/period policy, explicit finality evidence adapters and approved archive transfer/restore. Source-acceptance gates remain independent. No production merge, deploy, storage cutover, chart/Engine 22 integration, adjusted publication, paid commitment, trading or structural modification is requested by this milestone.
