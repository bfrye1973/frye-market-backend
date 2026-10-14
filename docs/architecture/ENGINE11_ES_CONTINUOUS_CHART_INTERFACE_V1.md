# Engine 11 — ES continuous research chart-data interface V1

Unmounted library specification and prototype under Issue #130. No Express route, frontend integration, live feed, execution resolver or broker connection.

## Views and immutable versions

- continuousRaw: candidate calendar-selected quarterly contracts, unadjusted original OHLCV.
- continuousAdjustedClose: additive research shifts from paired last-close differences.
- continuousAdjustedSettlement: separately pinned settlement-coefficient variant.
- continuousAdjustedVolumeClose: first-sampled-volume-crossover research selection and last-close variant.
- actualESZ2026: original December2026 contract OHLCV, no adjustment or other contracts. A historical source snapshot, not a live stream or trading authority.

Every dataset has datasetVersion, priceBasisVersion, source archive-vector hash, receipt-vector hash, roll-policy version, row-vector hash and requested range. All outputs are researchOnly / structurally ineligible. The original normalized observation table preserves full provider payload, alias, full-year contract proposal/verification state, source timestamp nanoseconds, source session label, original/V2 receipts, row/body digests and capture time. Chart rows reference every equivalent observation; conflicting observations remain in the source table and unavailable manifest.

## Paging API

`pageDataset(dataset, {datasetVersion, priceBasisVersion, frame, limit, cursor, direction})`

Frames: 5m,10m,1h,4h,1d,1w,1mo. Limit1–5000, default500. DirectionASC/DESC. Request must pin both versions. A deterministic checksum cursor binds dataset/basis/frame/direction/last-row key; mismatch, stale dataset, missing key or tampering rejects. The checksum is a consistency mechanism, not authentication. Cursor does not select another dataset or query a provider. Same pinned inputs produce same results; no timeline expansion by acquiring later data during pagination.

Response: versions, frame/direction, rows, nextCursor, coverage, researchOnly, structuralEligible:false, executionPriceAuthority:false. Row: researchCandleId, sourceObservationIds, sourceContract/providerTicker, exact timestampNs, timestampUtc, nominalPeriodEndUtc, priceBasisVersion, sourceSessionLabel, original-observation references, selectable-view OHLC/settlement/volume, adjustment amount/version, calendarVersion, intervalAlignment, completion and eligibility flags. The millisecond render label retains the exact source nanoseconds separately; no timestamp precision is invented.

## Visible unavailable data

No candle is generated for a missing interval. Coverage distinguishes:
- selected-contract query holes in the preserved archives;
- observed timestamp discontinuities that might be maintenance, holiday, missing data or provider alignment;
- same-start conflicting source observations;
- nominal periods crossing candidate roll boundaries;
- source starts outside their explicit query bounds;
- missing adjustment chains, unsupported/malformed observations and out-of-window samples.

Daily/weekly/monthly interval membership remains unapproved. Nominal periods are only a conservative modeling convention; boundary-spanning periods are quarantined rather than stitched across contracts. No cross-contract aggregation or synthetic gap fill. CompletionUNKNOWN stays UNKNOWN; periods nominally extending beyond capture are explicitly nonfinal. ETH is desired but source coverage/session calendars are unverified, including maintenance/holiday semantics.

## Engine 2B acceptance contract

Source/data/basis versions must match across chart pages and overlays. On timeframe or view change, invalidate stale responses and use a new pinned cursor. Continuous and actual-contract prices must have separate labels and cache keys. No adjusted-to-live concatenation without an approved compatibility policy; current actual contract is explicit ESZ2026, not an auto-selecting resolver. Future trading selection is independently approved.

A research preview may display labeled candles with visible unavailable ranges, plus original owner marks in a separate clearly unverified comparison layer only after separate Engine2B frontend authorization. Source coordinates remain unchanged; verified chart coordinates and all official Fib remain withheld pending accepted source/basis/Engine22 authority. Prototype outputs are not proposed execution prices.

T24–T27 remain later visual acceptance tests: pinned pagination and price-basis consistency, zoom/scroll without unexpected expansion, stale-request/live race protection, and25,000-bar memory behavior. This milestone tests library paging, not browser zoom/scroll, production capacity or frontend memory. No1,000-viewer test or latency approval is claimed. Paging currently scans in-memory rows; indexed/server adapters are a future separately reviewed stage.

## Artifact retrieval and independent replay

Draft PR Actions builds both original archives without new provider calls, verifies SHA256 and per-body evidence, reconstructs all five datasets, proves price/lineage consistency and pagination, and publishes a30-day artifact containing normalized source observations, five full datasets, summary and compressed-file checksums. Permanent private retention/backup transfer remains a separate approval. A report/sample in GitHub does not replace the full archive.
