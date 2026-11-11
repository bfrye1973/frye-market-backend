# Engine 18 — Claude / GPT-6 Gate 1 Recorder Design Decision Record
**Received:** 2026-11-10. **Status:** Joint architecture agreement, implementation gated by owner's licensing/storage authorization.
**Source:** Claude's direct response, provided by owner. Do not mistake a proposal for an implemented feature.

## Recorder architecture approved in principle
- Raw source-of-truth: append-only gzip JSONL; envelope stores the **exact received message string**, not a parsed/re-serialized market-data object (preserve key order/number representation). Include every market, control, error, unknown, malformed, subscription ACK and heartbeat message **as authorized by feed terms**.
- Required capture envelope fields: `localSeq` (monotonically increasing), `tLocalWallNs`, `tLocalMonoNs`, `streamGeneration`, `msgClass`, `raw`. Add source/instrument identity, session partition identity, schema version, safe error/status classification and nonsecret metadata as needed. Never store URL containing authentication token in raw/status/log files.
- Partition by `provider/physicalContract/CMETradeDate/hour`, where CME ETH trading date is **not simply UTC or civil calendar date**. Version the session calendar, document maintenance halts/weekends, and explicitly distinguish expected market silence from a disconnect.
- Rotate hourly; for every **closed** file write manifest with count, first/last sequence, first/last receive time, and SHA-256. Capture clean-shutdown and crash-recovery semantics, including a potentially incomplete .gz last hour.
- Storage: durable Render persistent disk (after access/permissions and actual service eligibility checked), upload closed files to private S3/R2 object store only after credentials, encryption, retention, data-rights, and cost are reviewed. Do not assume either is already provisioned. Normalized Parquet is downstream versioned, regenerable and **outside milestone 1**.
- Capture before interpretation. Raw capture process should be independent from zone-reader restarts and crashes. Do not reuse the current in-memory `zoneReader` state as the recorder.
- Receipt order is `localSeq`. No derived wall-clock reads, all tick prices use exact integer tick units; stamp parser/config versions. Retain unrecognized and rejected frames for analysis.
- NTP/clock offset samples every 60 seconds using an operationally available, verifiable measurement method. Do **not** fabricate an NTP offset merely from JavaScript wall-clock/monotonic difference.
- Never record/log the Ironbeam WebSocket URL: query params include bearer tokens. Credentials remain in protected environment. Status/exception logs must be sanitized.
- Metrics: frames/s by class, bytes written, last-frame age, recording uptime, active physical contract/session, dropped/write errors, gap count; protect status API and keep market payloads private. Alert when down during market hours only, respecting calendar.
- Milestone acceptance: at least five complete consecutive trading sessions, kill-mid-session recovery preserving files and gap evidence, byte-identical normalized replay twice, and reported storage/session size. **No chart, signal, or trade change.**

## Feed classification — do not prejudge full vs delta
- Existing Ironbeam demo read diagnostic: 93 accepted frames with 10 bid and 10 ask **nonzero** levels. This does not prove snapshot semantics or absence of conflation.
- After licensed raw collection, offline classify frames using level-index `l`, zero-size changes, one-sided vs two-sided, shape anomalies, ETH and RTH timing; **at least five sessions**.
- Explicitly test *conflation / sampling*: distribution of time between depth frames (incl. cash open), messages per second vs synchronized reference MBO, book differences incompatible with single-event changes.
- Ask Ironbeam support in writing whether v2 depth is full-image, incremental, or conflated.

## Coverage and persistent price levels
- Retain immutable historical **evidence** separately from mutable current **status**.
- When price exits 10-level coverage, preserve lastObservedQty, lastObservedAt, coverage bounds at exit, and whether price movement or feed invalidation caused it. Status OUT_OF_COVERAGE, NOT WITHDRAWN.
- Re-entry outcomes: STILL_PRESENT, WITHDRAWN_WHILE_UNOBSERVED, CHANGED. Never infer precise cancellation time while out of coverage.
- Store per-image 10th-depth price bounds (coverage width in ticks is variable).
- Use documented **time-based** hysteresis at the tenth-level boundary to prevent flickering status changes; choose N using recorded data, not an invented threshold.

## Trade matching and confidence
- L2 order-book reduction at best bid/ask cannot always be distinguished from trade, cancellation and replenishment on unsynchronized/conflated feeds; default AMBIGUOUS unless defensibly matched.
- Candidate matching window W is learned/measured from real trade/depth timestamp offsets, not assumed.
- Candidate rule from Claude: trades at price P within ±W >= decrease suggests EXECUTED; zero trades suggests WITHDRAWN; otherwise AMBIGUOUS. **Review this before calling classifications definitive**: adds, deletes, conflated events, latency and report aggregation can cause false positives. Away from touch, WITHDRAWN_OR_MODIFIED remains ambiguous.
- Per-session percentages of EXECUTED / WITHDRAWN / AMBIGUOUS must be reported; no probabilistic trading output during Gate1.

## Roles and next steps
1. GPT-6: maintain this decision record and the successor handoff; build **noncollecting** recorder components and deterministic unit tests in a scoped branch; do not enable raw recorder or cloud upload until owner authorizes licensing and private storage.
2. Owner: confirm Ironbeam data-storage rights for private research, credential rotation after prior exposure, private storage choice/budget. If no rights, seek permission from Ironbeam rather than recording.
3. Claude: review recorder design, define test fixtures for full-image/increment/conflation and deterministic replay; preserve original Gate1 tests I1–I8, Databento T1–T12.
4. After approval, operate recorder for five sessions and publish only anonymized health/diagnostic summaries. Review Gate1 pass/fail before Gate2.
