# Engine 11 — FINAL P0 Source-Provenance Preflight / No-capture Report
**2026-11-18 | Issue #344 | PR #347 | DRAFT, NO MERGE/DEPLOY | Engine12 conditional custody approval already accepted**

## 1. Disposition
**Sandbox original-byte and issuer-verification PREPARATION: COMPLETE.**
**Real source eligibility/attestation: BLOCKED** by provider-specific rights/entitlement, independent capture-host clock uncertainty, provider finality/revision evidence and protected original source capture. The previously approved one-shot provider test is exhausted. Engine12 permanent recorder remains OFF.

Engine12's **CONDITIONAL** acceptance at #344 comment 6983726949 stands; DO NOT ask again for a storage decision. Existing protected evidence candidate `/var/data/replay/engine11-source-evidence/` on the 100 GB disk is accepted only for future authorized bounded canary, subject to owner-specified safeguards. No directory has been created by this preflight.

## 2. Provider-backed legal/technical materials evaluated (not account entitlement evidence)
- Massive Market Data Terms of Service, updated 2026-11-03: https://massive.com/legal/market-data-terms-of-service . Their personal-use terms **describe a limited right to access, download and store plan-included information for personal noncommercial research**, subject to plan/add-ons, third-party restrictions, secure handling, retention and end-of-license deletion. The terms specifically warn CME provider addenda can require **immediate purge when CME license ends**. This does **NOT** verify the actual plan/entitlement, third-party CME agreement, right to retain full provider raw responses on Render or whether any future research program qualifies as permitted personal use. Do not claim that it does.
- Massive futures REST API overview https://massive.com/docs/rest/futures/overview : futures aggregate `window_start` is **nanosecond UTC** timestamp and `session_end_date` denotes exchange trade date, not a raw event receipt timestamp. CME schedules/maintenance require actual product/calendar sources.
- Massive futures REST aggregate documentation https://massive.com/docs/rest/futures/aggregates : native 1min/5min/10min resolution and window-start interval semantics. This does **not** supply independent original arrival, provider finality, or revision persistence proof.
- Massive aggregation late-bar article https://massive.com/knowledge-base/article/why-am-i-receiving-a-late-aggregate-bar-through-massives-websockets : bars can be rebroadcast on late changes, but its described contexts should NOT be assumed to establish the *futures* REST aggregate finality policy. Need exact Massive Futures written policy / original message examples for 1m/5m/10m.
- Render Persistent Disk docs https://render.com/docs/disks : Render documents encryption at rest of persistent disks/daily snapshots, and a disk is attached to ONE service instance. This is **platform-level documentation**, not independent proof of attached disk encryption posture, private namespace backup/restore correctness, or user-specific crypto configuration.

### Entitlement and licensing evidence required, owner/source provider
1. Provider's official account/plan record or written support statement identifying Massive futures product, physical ES market data, LIVE vs DELAYED/SAMPLE classification, account/channel ID represented by nonsecret fingerprint.
2. Subscriber/CME third-party agreement or written Massive/CME permission specifically addressing original response byte retention in private Render cloud storage, internal strategy research/analysis, independent verifier access, allowable duration and purge duties. Redact account ID and API key from public GitHub.
3. Exact source publication/finality/revision policy for 1min,5min,10min **futures aggs** and any differentiation between historical REST refetch vs realtime aggregate streaming.
**Current evidence state: entitlementMode UNKNOWN, raw-byte retention permission NOT VERIFIED. No provider-backed account entitlement record was obtained by this PR.**

## 3. Real proposed capture host clock preflight
Only existing Backend1 `frye-market-backend-1`, whose Render disk is attached, is the *candidate source-capture host*; GitHub runner time cannot be substituted. Record original host:
- UTC wall timestamps at request dispatch, response first headers/byte when observable, last byte, decoded original body flush;
- monotonic timestamps/elapsed for same points and process/host identity;
- independent synchronized time measurement **from the actual host** with UTC offset bound (NTP/chrony/PTP or another independently reviewed source) with measurement timestamp, source, uncertainty and staleness. Linux host may not expose chrony/PTP to unprivileged Node; `Date.now()` vs `performance.now()` is **not** independent UTC offset proof.
- `captureClockStatus=VERIFIED` only after an authenticated, separately recorded reference and a conservative maximum uncertainty proof; otherwise `RECEIPT_CLOCK_UNVERIFIED` and no original Engine3 as-of calibration.
No clock sample or independent offset from this actual host has been obtained, so **clock bound UNKNOWN**.

## 4. Source identity/finality/correction and physical roll
From current `services/core/routes/futuresOhlc.js`, actual source is Massive/Polygon `/futures/v1/aggs/{physicalContract}`, request `window_start` in UTC nanoseconds. Existing code resolves product root `ES` from an environment override or nearest unexpired settlement in provider snapshot with a 2-minute cache; that is **not** independent roll decision lineage.
Prior authorized trial at run 44336350771 observed ESZ6 45×1m, 9×5m, 5×10m, with correct temporary byte SHA readback; no protected originals remain, no entitlement/clock/finality established.
For a future authorized canary bind each original response to: provider + feed account ID fingerprint, exact provider physical contract, snapshot resolver selection and observedAt, source path+sanitized parameters, original response bytes SHA, UTC/mono receive clocks+offset sample, provider event/response ID only if actually present, session calendar revision, each 1m/5m/10m bar start/end, versioned source bar ID/revision/correction history, per timeframe observed/accepted/rejected counts and missing/late/out-of-order counts. Revisions do not retroactively overwrite a prior as-of observation. UNKNOWN finality or roll identity fails closed.

| Frame | Provider native resolution | Previous one-shot observed | Provider original finality | Clock/entitlement | Gap/roll state |
|---|---|---:|---|---|---|
| 1m | 1min | 45 | UNKNOWN | UNKNOWN | need CME calendar and independently observed revisions |
| 5m | 5min | 9 | UNKNOWN | UNKNOWN | need CME calendar and independently observed revisions |
| 10m | 10min | 5 | UNKNOWN | UNKNOWN | need CME calendar and independently observed revisions |

No completed-looking REST candle becomes `CONFIRMED` just because `window_start + duration <= now`. The first HTTP fetch of an old bar after an Engine3 evaluation is `HISTORICAL_REFETCH` relative to that evaluation and cannot be marked historical as-of available.

## 5. Independent no-network, sandbox receipt preflight now tested
Implemented PURE `services/core/logic/engine11/candleProvenanceV1/inspectOriginalSourceReceipt.js`:
- Engine12 receives read-only *original* bytes from a future approved private store and independently recomputes SHA/length (metadata-only does not suffice).
- Signature checked against an independently supplied public key (Ed25519); issuer key **not trusted from caller envelope**. The signed message covers receipt ID, feed, physical contract, source URL path, original bytes SHA/size, original/refetch mode, parser/config, UTC+monotonic timing, and explicitly signed clock/entitlement/finality claims.
- Fails closed on tampering, wrong issuer, digest mismatch, changed contract, empty raw source, receipt later than evaluation, refetch presented as original availability, missing clock reference/uncertainty, unknown entitlement/retention rights and unverified provider finality.
- `verificationMode:SYNTHETIC_SANDBOX_ONLY`, `independentProviderTrustEstablished:false`, `calibrationAdmissible:false` even for self-consistent synthetic signed receipts. Only a separate independently verified real-source trust anchor plus real provider evidence could permit future Engine12 trust promotion.
- 12 new synthetic original-byte/issuer tests plus 11 prior strict v1 contract tests; isolated CI 23/23 PASS, no write/network/import of recorder. These tests DO NOT establish real provider permission or clock truth.

No production signer key, protected provider bytes or trust anchor were provisioned. Engine12 owns final verifier/security integration and the accepted PR #349 writer.

## 6. P0 safety correction: obsolete one-shot capture PR trigger removed
**Important disclosed procedural defect:** The previous one-time source trial workflow was included in draft PR347 with a `pull_request` trigger matching its modified source files. Because GitHub evaluates the PR's cumulative changed files, a subsequent change to the draft caused the exhausted one-shot provider trial to run again without new owner approval. Run `44348788441` returned SUCCESS and made four additional bounded Massive requests at `2026-11-18T16:34:31Z`; it labeled entitlement/clock UNKNOWN, produced metadata-only output, deleted raw temporary bodies and reported no storage/Engine12 recording. This was **not authorized** under the latest STOP instruction and is not presented as a new accepted trial.
The PR347 branch has now **deleted** both `.github/workflows/engine11-approved-one-shot-source-trial.yml` and `services/core/scripts/engine11OneShotMassiveEsSourceTrial.mjs`. Subsequent PR commit `8710def...` showed only isolated synthetic CI, with no source capture job. Do not restore a PR-triggered data collector. Further capture must require a standalone explicit approval gated outside PR CI and disabled without approval.

## 7. Engine12 conditional custody guards (already accepted; not retried)
Candidate protected namespace `/var/data/replay/engine11-source-evidence/`, hard initial **<=1 GB** canary, stop at **>=70% whole-disk used**, owner-only access dir `0700`/files `0600`, no-overwrite exclusive files, fsync, independent SHA/readback, immutable receipt, read-only verifier and private raw bytes, no canonical Replay touching. Encryption: Render documentation supports general disk-at-rest encryption, but independent host/backup evidence remains incomplete. Backup and owner retention details must be agreed. ENOSPC/EACCES/backpressure/crash/orphan/duplicate/conflicting hash must fail closed and cannot mark `RECORDED_VERIFIED`.

## 8. Proposed NEXT canary — not authorized
After the missing source licensing/clock/finality and Engine12 verifier-custody signoff, propose ONE narrowly owner-approved **1–5 minute** protected original ES 1m/5m/10m source collection on the source-owning host (exact window to be approved), at most **1 GB** source-evidence bytes, hard **70% whole-disk stop**, no credentials in receipts, original-body byte readback, exact receipt issuer signature, monitored UTC clock reference, aborted on missing permission/quota/clock or contract mismatch. Independent Engine12 reads originals under verified private boundary and checks bar-finality/availability by the contemporaneous Engine3 evaluation. Stop switch immediate and namespace-specific. Never delete, overwrite or alter canonical `/var/data/replay/es`. Proposed 1–5 min session may yield fewer than one *final* 5m or 10m candle: this is diagnostic only; no claim of full coverage or calibration until independently established. No automatic provider requests/scheduler; permanent Engine12 switch remains OFF and Phase4 not authorized.

## 9. Final checklist
- Existing conditional Engine12 storage acceptance: **ACCEPTED** as candidate only.
- Provider futures API clock/contract semantics: **DOCUMENTED** from official references.
- Provider actual account feed entitlement and licensed private retention: **UNKNOWN / BLOCKING**.
- Real capture-host independent UTC uncertainty sample: **UNKNOWN / BLOCKING**.
- Futures aggregate finality/revision and original source correction semantics: **UNKNOWN / BLOCKING**.
- Actual original protected bytes + independent private Engine12 readback: **NOT CAPTURED / BLOCKING**.
- Sandbox cryptographic byte/issuer preflight: **23/23 PASS**; not real source truth.
- Engine12 PR349 sandbox: **19/19 accepted** separately.
- Real source attestation: **NOT VERIFIED**.
- Persistent recording: **OFF**; no merge/deploy/production disk mutation/Phase4.

**Exact next owner/source dependency:** obtain signed/licensed plan or official provider permission and verified original clock/finality evidence; Engine12 review a concrete read-only issuer trust-anchor and private verifier. Only afterward request a new owner decision for the limited protected canary. Do not claim success now.
