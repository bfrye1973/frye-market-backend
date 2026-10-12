# Engine 11 isolated ES raw candle foundation

Date: October 12, 2026. Phase: Section 22 isolated development. Base:
`aa7689dc73a32c5145454ad01ecabebc37622097`.

## Authorization and ownership

The Project Owner and Engine 2B Lead Manager explicitly authorized isolated
development, automated tests, corrections, a feature branch and a draft PR.
This supersedes the earlier coding hold for this bounded scope only.
Formal Engine 22 Manager ratification has not been independently documented;
it is not represented as received. Engine 22 owns all structural decisions.
Engine 11 owns shared candles; Engine 2B is the Lead Manager and chart owner.

No production merge, deployment, consumer migration, infrastructure purchase
or paid-provider change is authorized. Existing routes, stream behavior,
snapshot builders, engine outputs, trading/permissions/sizing/risk, accounts,
Journal, Replay, manual zones, anchors and Fibonacci are unchanged.

## Continuity

This is the raw evidence foundation of the existing joint architecture:
[joint blueprint at pinned #89 head](https://github.com/bfrye1973/frye-market-backend/blob/729bf65a6acaea615355a8949ad86f30c8595c8d/docs/architecture/JOINT_HISTORICAL_ES_CANDLE_CONTRACT_DRAFT.md).
The Engine 2B historical adapter is research-only. This does not establish a
second history owner. PR #97 structural detection and its provisional IDs are
not changed or promoted; later reconciliation remains Engine 22-owned.

## Added modules

All modules live in `services/core/logic/engine11/rawCandles/` and use Node
builtins only. They have no import-time network, persistence, timers or
consumer wiring. The repository's existing server imports none of them.

| File | Responsibility |
| --- | --- |
| identity.js | Explicit full-year quarterly ES identities, verified alias relation, UTC half-open ranges, strict resolutions, exact nanoseconds, canonical hashing and typed errors |
| calendar.js | Validate an explicit evidence-bearing full interval plan; assess closures, missing/unknown intervals, verified no-trades and incomplete periods |
| normalize.js | Strict native OHLCV/ticker/tick/session validation, raw content lineage, immutable revision IDs, conflict versus identical duplicate handling |
| provider.js | Explicit-contract acquisition, safe provider pagination, bounded retries/timeouts/abort, budget/cycle checks, no partial publishable records |
| store.js | Explicit isolated local root, content-addressed immutable dataset/receipt objects, exclusive durable publication manifest, corruption detection and asOf protection |
| reader.js | Research-only pinned read envelope, deterministic keyset paging, signed cursor pins, typed mismatch/unavailability and explicit incomplete coverage |

No Express route, server mount, dependency/package change, latest pointer,
cron, production disk or live resolver is added. The read service is an
in-process boundary for isolated tests; public HTTP integration is a later gate.

## Identity and revision rules

Canonical contracts are `ESH2026`, `ESM2026`, `ESU2026`, `ESZ2026`, etc.
Short aliases such as `ESZ6` are accepted only alongside an explicit full year.
They never define identity alone. Other roots, spreads and nonquarterly ES
months are rejected in this ES-only stage.

The source key includes provider, full instrument identity, native resolution,
exact source timestamp and alignment rule version. The raw revision adds the
canonical raw payload hash. Equal evidence preserves IDs; a correction keeps
the source key and creates a new revision. Simultaneous quarterly contracts
remain distinct. Retrieval time is not part of candle identity.

Provider numeric `window_start` nanoseconds are preserved as decimal strings
before JSON parsing; they are not routed through an unsafe JS number.
OHLCV stays raw and unadjusted. Unknown volume is null, never invented zero.
Recorded native fields include ticker, exact timestamp, OHLCV, trading date,
settlement price, transactions and dollar volume. Last-trade close is kept
separate from settlement. Native metadata is content hashed.

## Calendar and completion boundaries

The caller must supply an explicit versioned interval plan with calendar,
alignment and evidence identifiers. OPEN intervals carry session ID, trading
date, close convention and finality evidence reference. Expected closures are
separate intervals. The plan must partition the complete requested range;
uncovered periods are not silently treated as closed.

This stage does not claim to implement or approve a full CME holiday calendar.
The interval plan, calendar acceptance and source finality remain independently
verified later. A caller's elapsed wall clock alone never marks provider bars
complete: a source watermark and evidence-bearing interval are required.
Missing source watermark produces UNKNOWN finality. All records/datasets remain
`ISOLATED_RESEARCH_ONLY` with `structuralEligible=false`, even when mechanical
coverage checks pass. Structural, execution, journal and risk read purposes are
rejected, rather than inferred from the raw price basis.

Verified no-trades requires an independent source-activity evidence reference;
otherwise an absent interval is UNKNOWN_SOURCE_ABSENCE. No flat candles or
synthetic session/week/month bars are generated. Weekly/monthly are deliberately
unsupported in this raw foundation; they never default to 1m.

## Acquisition and failure behavior

Only HTTPS `api.massive.com` and `api.polygon.io` are allowed. A next page must
remain on the same origin, exact contract path and immutable query when filters
are present. Unexpected/authentication query parameters, userinfo, fragments,
cross-origin links, cursor cycles and nonmonotonic rows fail closed.
Credentials go in a request authorization header, not persisted URLs/errors.
Receipts contain sanitized request hashes, page counts, exact revision IDs,
first observed time, source watermark and typed failure, not provider bodies
or secrets.

All provider pages are followed within explicit page/row/time/retry budgets.
429/transient failures retry within the budget. Entitlement errors do not retry.
An interrupted/malformed/conflicting acquisition returns INCOMPLETE and zero
publishable records. A successfully traversed but gapped acquisition can be
retained as labeled research with incomplete coverage; it cannot gain source
eligibility. Provider-snapped rows outside `[from,to)` are counted and excluded.

## Isolated durability and reads

`IsolatedRawStore` requires an absolute root plus `isolated:true`. Production
paths under `/var/data` and `/opt/render` are forbidden, as are symlink redirects.
Temporary writes are fsynced, atomically linked without replacement, then the
directory is fsynced. A complete dataset and receipt must precede publication.
Reads require a valid publication manifest and both content hashes. Orphan
data after a publication failure is unavailable until idempotent retry commits
the manifest. Existing revisions are never overwritten. No production latest
pointer or store has been established.

The reader pins dataset, series, timeframe, basis, range, asOf, calendar,
alignment, purpose and completed/provisional selection. HMAC cursors carry that
pin and the last composite bar key. Retries produce identical bars/ETag.
Invalid/tampered pins fail; unavailable versions never switch to latest.
Requests cannot imply coverage beyond the published range. Point-in-time reads
reject evidence observed after the requested clock and later source watermarks.
This is a local proof store; scale, backup/restore and production storage remain
later acceptance gates, not certified capabilities.

## Verification

Run from repository root:

```sh
node --test services/core/tests/engine11/*.test.js
```

Local development result: 99 tests passed, 0 failed, using Node 24. CI runs
Node 20. Tests cover identity/correction/overlap, numeric/UTC validation, full
calendar plans, finality/absence, provider pagination and failure, safe cursors,
durable restart/concurrency, tamper detection, publication-crash recovery,
asOf isolation and no production imports.

Fixture parity is not authentic provider proof. The separately named
`liveProviderParity.mjs` reads a bounded September 10, 2026 10m overlap sample
from explicit ESU2026/ESZ2026 via the existing entitled provider. It compares
unaltered native OHLCV and exact timestamps with normalized raw records.
Its research interval plan is not an accepted exchange calendar, and source
finality deliberately stays UNKNOWN. It does not write a dataset or touch
consumers. Logs disclose authentic success versus typed unavailable failure;
neither proves multi-year coverage or structural sufficiency.

The new GitHub workflow runs fixture/integration tests on this branch/PR and
the bounded authentic read-only probe on branch pushes with the existing
`POLYGON_API_KEY` repository secret. It has `contents:read`, no dependency
installation, no write/deploy step and no credentials persisted by checkout.
Missing credentials are a failed authentic proof, not a passing simulated test.
Existing branch/path workflow and Render configuration were checked before
creating this branch; its additions do not trigger existing data-writing jobs.

## Next acceptance gate

Engine 2B Lead Manager reviews the isolated raw foundation and exact CI head.
Approve/revise its schema, interval evidence contract, validation and query
boundary. Establish authentic full-depth coverage and accepted calendar/finality
before any Engine 22 or chart source integration. Roll schedule/adjustment,
weekly/monthly, production persistence, 1,000-viewer capacity, chart regression,
consumer cutover and production authorization remain separate later gates.
Formal Engine 22 Manager ratification remains undocumented; reserved structural
work stays blocked. Rollback at this stage is nonadoption: no consumer or
production route references these modules.
