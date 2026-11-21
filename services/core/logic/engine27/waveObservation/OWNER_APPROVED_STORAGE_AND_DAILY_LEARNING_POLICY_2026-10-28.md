# Engine 27 V6 / Engine 28 — Owner-Approved Historical Learning Storage Policy

**Decision date:** 2026-10-28 (America/Phoenix)
**Status:** OWNER-APPROVED ARCHITECTURE POLICY. Implementation and production activation are separate.
**Scope:** Engine12 Replay, Engine22 authorized wave publication, Engine27 durable research, Engine28 daily learning.

## Locked decisions

1. **Engine 12 canonical ES Replay remains at 14 Arizona calendar days** (current date plus previous 13). Do not extend or modify Engine12 retention, Replay writer, or immutable canonical files merely to support Engine27.
2. **Engine27 owns compact permanent evidence.** It must ingest new canonical Replay observations within the retention window; preserve original-time source identity and evidence, wave publication/change events, contextual market features, and verified 10/30/60-minute outcomes in Engine27-owned durable storage. **Do not duplicate entire Replay archives by default.**
3. **Engine28 is the read-only daily learning consumer.** It processes newly eligible/completed Engine27 observations and outcomes incrementally, maintains versioned cumulative research results and resumable watermarks, and can reanalyze retained Engine27 evidence when methodology changes. Engine28 must respect its existing ENTRY Replay decision truth and first CLOSED Replay outcome truth contracts for trade research. It never mutates Engine22, Engine27 original records, Engine10 trades, or execution engines.
4. **Permanent data must remain analytically reusable.** Do not retain only wins/losses or final summary scores. Preserve compact, source-grounded features sufficient to reconstruct each published study: timestamps, ES observation and target prices when verified, contract/provenance state, wave version and degree/parent identity, relevant Engine3/4/25/26/29 evidence, hypothesis/reaction state, missingness, and classification logic/version. Feature snapshots and later outcomes must be separate immutable records. Scope and sampling cadence require validation before activation.
5. **No retrospective contamination.** Owner chart anchors are OWNER_RETROSPECTIVE_REFERENCE until original-time source independently verifies them; older Replay interpretations are not rewritten as later Micro W3/Submicro W5. Source approval IDs/times and ES contract identity stay null when not recorded. A contemporary contract resolver does not prove an older price basis.
6. **Read original Replay only until absorbed:** a bounded, resumable read-only consumer lists actual /replay/es/times and reads canonical snapshots; persists source date/time/path/raw-byte SHA256 (only when directly verifiable), source snapshot time, ingestion time, provenance, watermarks and delivery state. Deduplicate and recover across restarts/late delivery. Do not claim an HTTP reserialization SHA as original file bytes.
7. **Storage operations:** proposed journal root /var/data/replay/engine27/wave-observations. This shares the Backend1 100 GB disk, and therefore requires measured quotas, disk-health alarms, restart/crash/corruption tests, and independently verified backup/recovery before any permanence guarantee. Retain original research evidence until explicit owner-approved migration/archive; derived daily summaries are versioned and reproducible.
8. **Owner can extend Engine12 retention later** if a demonstrated research gap requires more history; do not extend it speculatively.
9. **Approval boundary:** this decision authorizes continued isolated architecture, feature-branch development and testing. It does **not** authorize production activation of Engine27 journal writer/poller, Engine28 daily worker, storage mutations, or trading-related changes. Production requires separate owner approval and acceptance evidence.

## Research phases and acceptance

- Phase A: prove isolated append-only journal, distinct source/vs ingestion time, canonical schema checks, original source hash, dedupe, late delivery, restart and crash recovery, plus capped disk use.
- Phase B: persist compact **time-sampled research evidence**, not only wave changes; preserve the feature values *before* future outcomes; capture original Replay missingness and authoritatively published wave state. Exact physical contract must be source-verified or null.
- Phase C: persist separate 10m, 30m, 60m realized market outcomes only after eligible horizons (timestamp tolerance defined, no interpolation). Mark unknown physical-contract comparability; do not present those as validated same-contract performance.
- Phase D: Engine28 daily incremental computation over Engine27 permanent observations, with reproducible versioned study ID, input cohort, sample count, evaluation windows, leakage checks, calibration and explicit UNAVAILABLE when evidence is insufficient.
- Phase E: Wave Learning dashboard reads authorized read-only endpoints; no duplicate Engine22 Fibonacci ladder.

**Critical retention deadlines for initial Oct26–28 research (assuming current Engine12 policy):** Oct26 expires Nov9 ~00:15 AZ, Oct27 Nov10, Oct28 Nov11. Save necessary original evidence before deletion. Neither this decision file nor PR #223 currently preserves actual production files.

**Authority:** Engine22 owns waves; Engine12 owns original Replay; Engine27 owns permanent evidence; Engine28 analyzes read-only; Engine10/8 own actual fills. Never alter counts, execution, account permissions or historical originals.
