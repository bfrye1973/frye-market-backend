# Engine 11 — Massive Futures Support Inquiry (DRAFT, NOT SENT)

To be routed by Engine 2B Lead Manager after explicit external-send authorization. Existing account only; no plan upgrade request. Full original responses are in Actions runs 38338605379 and 38339185603. `evidence/engine11-provider-request-ledger-v1.json` records all 32 main request IDs, receipt hashes and capture times.

## Proposed message

We are validating native ES futures data for October 12, 2024 onward. Please clarify the following reproducible observations before we accept analytical intervals. We preserve all originals and have applied no corrections or price adjustments.

**1. Session labels switch inside a second on January 30, 2025.**

For ESH5, raw trades queried over 21:54–22:05 UTC returned 981 records. The last record labeled January 30 is timestamp `1738274136387378265`, channel 310, sequence 58508574, report sequence 55646808. The next captured record is timestamp `1738274136407828355`, channel 310, sequence 58508612, report sequence 55646833, labeled January 31. The gap is 20,450,090 ns. Both occur at 21:55:36 UTC on January 30.

The same second/minute/native parent buckets contain distinct session-labeled records. Captured trade subsets reproduce both 1m and 5m fragments exactly; the January 31 5m fragment has 690 transactions and volume 2,080. A full 20:00–24:00 guard also reproduces both 4h fragments from minute records.

Please identify the origin and semantics of that session-label boundary: exchange message field, instrument/session reset, historical ingestion policy, or corrected source history? Please provide authoritative session membership and any source correction/reference identifiers. We are not assuming a cause.

**2. Aggregate session filters are not listed in the current aggregate API documentation.**

Both requests below returned the same 78 rows, including mixed labels; the contrary-label counts were 5 and 73. Trade endpoint session filters returned the requested labels only. We recognize that aggregate `session_end_date` is not documented as a query parameter; please confirm whether it is unsupported, ignored, or available under another documented mechanism.

```text
GET /futures/v1/aggs/ESH5?resolution=1min&window_start.gte=1738267200000000000&window_start.lt=1738278000000000000&sort=window_start.asc&limit=50000&session_end_date=2025-01-30
GET /futures/v1/aggs/ESH5?resolution=1min&window_start.gte=1738267200000000000&window_start.lt=1738278000000000000&sort=window_start.asc&limit=50000&session_end_date=2025-01-31
```

Unfiltered minute request ID: `9dde8c2f0674bb1e0cf75ad05b4eddd9`; body SHA-256: `f7d855f3c412c36a9daf8842ff9661357b4a0596925f386efbc3360df4cdf1c4`. The ledger provides the filtered/trade IDs and exact scoped URLs without credentials.

**3. Historical Schedules are incomplete under the existing entitlement.**

ES/XCME range October 12, 2024–October 13, 2026 returned 2,448 events on three pages, including calendar-spread product names. After outright scoping and conservative transition checks: 390 provider-candidate dates, 332 dates with no events, two incomplete dates and eight unknown transition-policy dates. No-event days are not assumed closed.

Exact-date queries for October 14, 2024, January 30/31, 2025 and March 10, 2025 return no events. January 21 has an open only; March 18 has a close only. November 27, 2025 is empty under that label, with its events carried under November 28. Several multi-day holiday labels include pre_open while the preceding event state is open, without an explicit close.

Please confirm actual historical coverage/retention, missing-event semantics, outright versus spread identifiers, all event meanings, whether pre_open ends matching, maintenance boundaries, multi-day trading-date conventions, and whether schedules describe intended or actual trading interruptions. Please identify any dated immutable schedule revision source.

**4. ESZ4 contract metadata before March 2025 lacks settlement_date.**

December 20, 2024 metadata supplies ES/XCME, first_trade_date June 4, 2021 and last_trade_date December 20, 2024, without settlement_date. Later queries return empty rows. Please provide a full-year authoritative instrument identifier and dated expiry/settlement record, or the documented historical identity source. We preserve last trade and settlement as different fields.

**5. Completion, corrections and native interval boundaries.**

Please identify explicit finality/completeness watermarks, source publication/correction timestamps, supersession/cancellation identifiers and applicable guarantees for ES seconds, minutes, hours, sessions, weeks and months. How are clock buckets clipped by sessions and holidays, and which guard ranges establish full parent coverage? Are historical responses atomic as-of snapshots or independently observed latest records? Identical re-fetches and planned future closes are not being treated as finality evidence.

We can supply original response bodies and manifests through an authorized private channel. Please advise within the existing entitlement; no purchase or plan change is authorized.

## Internal evidence confidence

Observed request/response arithmetic and raw labels: authentic and reproducible. Exchange interpretation, corrected-record relationships, calendar completeness and finality: UNKNOWN. This inquiry is a prepared escalation deliverable; no support ticket, email or external message has been sent.
