# Engine 11 — V2 source-observation identity prototype

Authorization: Engine 2B Lead Manager, PR #103 comment 6134654700:
https://github.com/bfrye1973/frye-market-backend/pull/103#issuecomment-6134654700
Prototype branch: `engine11-source-observation-v2-prototype`, based on approved proposal
commit `a471e1401d9bdb8d9b140a5bf54dce3e702dfe99`. Separate stacked draft PR targets the
existing research branch; no accepted V1 module or production wiring is changed.

## Delivered modules

New folder: `services/core/logic/engine11/sourceObservationsV2/`.

- `evidence.js`: exact decoded HTTP response-body bytes/digest/base64, lossless timestamp
  parsing, original UTF-8 row byte offsets/digests, occurrence IDs, immutable receipts,
  full-year contract binding from preserved metadata. Duplicate JSON keys, invalid UTF-8
  and malformed JSON preserve receipt bytes but produce no parsed identity. Unknown
  unsafe numeric values retain original numeric lexemes. Response bytes are after HTTP
  content decoding, not packet/transport/compressed bytes. Archived body text and fixtures
  have separate evidence-kind labels.
- `dataset.js`: verified metadata dependencies, contract lifespan guards, timestamp/
  session/resolution/contract-discriminated research keys, byte-level source revisions,
  repeat occurrence retention, equivalent-parsed/different-byte classification, unresolved
  changed-content candidates, frozen versioned snapshots and explicit V1 correspondence.
  Distinct session labels never become revisions of one key. No canonical analytical
  interval is derived. Missing metadata leaves occurrence evidence with null source key.
- `reader.js`: rebuild/validate snapshot integrity, HMAC-signed version/as-of/purpose/
  page-size pinned research cursors, deterministic full-composite sorting and timestamp
  tie traversal, idempotent retries, no latest fallback, no execution/structural use.
  As-of predating any source or metadata dependency is rejected. Historical replay uses
  the immutable dataset captured for that as-of; newer datasets cannot masquerade as old.
- `provider.js`: bounded authenticated HTTPS acquisition, exact body-byte capture,
  provenance, safe cursor origin/path/query checks, cycles/page/row budgets, explicit
  denial/incomplete states. No credential URLs, success-body credential archival or
  error-body logging. Partial receipts remain research evidence, not complete coverage.

All dataset/page/source outputs are research-only, finality UNKNOWN and structurally
ineligible. Coverage remains false and analytical intervals null. Metadata matches
are research bindings, not final source acceptance or Elliott authority. No corrected
revision is automatically accepted, no latest-row winner and no approved anchor changes.

## Verification

New test path: `services/core/tests/engine11/sourceV2/prototype.test.mjs`.
30 tests cover byte fidelity, UTF-8 offsets, malformed/duplicate-key capture, unknown
numeric lexemes, source identity, competing revisions, equal repeats, metadata/decade/
lifespan ambiguity, snapshot restart and tampering, timestamp-tie paging, signed cursor
drift/tampering, as-of restrictions, V1 one-to-many aliases and provider failures/budgets.
Authentic archived 2020/2026 body tests are explicitly labelled; other fixtures are
not provider or exchange proof. The V1 and earlier research suites run alongside V2.
Initial local total: 156 passing tests (126 prior + 30 V2).

Bounded live script: `services/core/tests/engine11/sourceV2/livePrototype.mjs`.
It captures four point-in-time metadata lookups and six narrow aggregate windows:
2020 H/M 5m and H 1h/4h, plus September 2026 U/Z 4h. It preserves all actual response
bytes in the JSON snapshot/artifact, verifies one-record paging and repeats, and reports
matching timestamp/session cases and unavailable older bindings. HTTP unavailable
states are retained; workflow success does not certify calendar or source acceptance.
Existing credentials only; no paid commitment or infrastructure provisioning.

Workflow: `.github/workflows/engine11-source-observation-v2.yml`.
Fixtures run on branch pushes/selected PR changes. Authentic bounded acquisition runs
only on intentional `[source-v2-live]` commits. No deployment or production commands.

## Limitations and remaining acceptance conditions

This is an unmounted, in-memory immutable snapshot prototype, not an approved production
store, server route or provider backfill job. JSON snapshots are reproducible research
exports; durable storage topology and provider redistribution rights remain deferred.
Eight-MiB response capture and 50,000 parsed rows per response are prototype limits;
larger successful responses are unavailable with explicit failure, never truncated as
accepted evidence. Provider retries and streamed response-size enforcement are not
implemented; transport failures remain explicit and bounded by the request timeout.

Source semantics, correction indicators and full historic contract metadata still need
verification. The provider's source-session label differentiates records, not validated
exchange intervals. Effective-dated CME ES holiday/session calendars, intraday alignment,
weekly/monthly membership, no-trade/gap classification and completion policy remain
unresolved. No canonical interval or adjusted continuous history is published.
Existing authentic seven-degree investigation in PR #103 remains the coverage baseline;
this prototype does not repeat the full March 2020–present backfill or silently stitch
quarters. Each degree remains independently unavailable for structural source use.

V1 readers/modules/datasets remain untouched. Correspondence reports are candidate
records only, permit one-to-many/unresolved and never migrate old IDs. Engine 22 V3
provisional IDs remain aliases; no Engine 22 or frontend adapter is connected. Separate
scope and acceptance are required before canonical alignment or consumer integration.
Formal Engine 22 Manager structural ratification remains pending.

## Development acceptance request

Engine 2B Lead Manager: ACCEPT or REVISE this isolated source-observation milestone.
Please assess byte/source evidence retention, ambiguity handling, revision separation,
metadata binding guards, snapshot integrity and signed research paging. Do not interpret
development acceptance as source/calendar/finality, structural integration or production
approval. Execution, accounts, stops/targets, sizing, risk, journals, Replay, live routes,
streams and approved Elliott/Fibonacci remain unchanged. No merge/deployment occurred.
