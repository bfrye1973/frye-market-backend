# Engine11 Real-Source Attestation Gate — Evidence Inventory and Next Acceptance
**2026-11-18 · Issue #344 · Follow-up to Engine12 PR #349 head ba8ed6c99e9feaf3ed7c975cc95d794f4efb200f**

## Disposition
Engine12's no-overwrite source-versus-packet sandbox gate is accepted (19/19). It does **not** establish provider origin, original reception time, entitlement or live finality. Engine11 PR #347 remains a DRAFT specification and fail-closed *synthetic* preflight (11/11); **not an approved independent original provider trust verifier**. Recording remains OFF. Nothing should be deployed or scheduled from this document.

## Evidence already available and what it proves

| Source | Positive evidence | Still unproven / inadmissible claim |
|---|---|---|
| `services/core/routes/futuresOhlc.js` | Massive/Polygon REST aggs for exact resolved futures symbol, price and `window_start`; debug resolver rule, contract and checkedAt | Original as-of Engine3 reception/completion; provider entitlement; provider-payload raw receipt trust; finality |
| `services/streamer/routes/futuresStream.js` | Existing Polygon futures websocket and 1m streaming path; possible event-time fields, stream resolver | Durable original raw-event receipt, independent clock quality. Some paths may use local `Date.now()` fallback when source timestamp is missing |
| `services/core/scripts/captureEngine11Oct30Esz6.mjs` | Source-specific ESZ6 authenticated Massive original response bytes at **time of fetch**, SHA, observation IDs and capture receipt; separate research receipt manifest, no production changes | Capturing historical Oct12–30 data *after Oct30* DOES NOT establish Engine3 knew those bars at a past evaluation |
| Engine11 2020+ private unadjusted archive | Verified original historical chart dataset and physical contract columns, including 1m? NO: dedicated 5m/10m/1h/4h/day/week/month chart series | Not a complete per-evaluation original 1m/5m/10m provider-reception history; not proof of contemporaneous availability |
| Engine3 packet v2 PR #345 + Engine12 PR #349 | Exact packet/archive/source-envelope structural identity and independent hash/readback checks | Cannot upgrade synthetic or caller-supplied trust to `REAL_SOURCE_ATTESTED` |

## Required NEW Engine11 evidence — no shortcuts

1. **Real provider identity.** Identify the exact Massive/Polygon vendor endpoint, product feed channel/account-scoped entitlement (LIVE vs delayed/sample), approved physical ES contract and official resolution, provenance source configuration and parser SHA. Do not print or persist API keys; owner/manager should verify entitlements with provider in a credential-safe manner.
2. **Original point-in-time capture.** Use a vetted, separately approved collection of genuine incoming provider messages, with raw immutable bytes, provider event ID or documented lack thereof, source-event timestamp and independently measured receive/available/completion timestamps. Do not backdate historical REST fetches. Clock quality must include UTC receipt time source, bound/error, and any monotonic linkage. A local `Date.now()` fallback cannot masquerade as provider event time.
3. **Per-bar finality source.** For each completed 1m/5m/10m, bind provider message(s), first receipt, completion observation and allowed late-correction/finality window. If no provider finality signal exists, publish `UNKNOWN` until a validated documented cutoff policy is tested. Retain revisions rather than overwrite after a correction.
4. **Contract / roll / basis.** Bind `ESZ6` (or actual) per bar, contract epoch and resolver selection receipt. Store roll event effective time and observed-at; never silently stitch contracts or map continuous adjusted prices to physical raw bars. Source session calendar / Chicago DST and Arizona UTC−7 rules must be versioned.
5. **Coverage / gaps.** Report expected intervals from the real CME session calendar, observed/rejected/accepted counts before filtering, duplicate/out-of-order/late/correction counts, gap ranges and outage/entitlement status. `UNKNOWN` or nonzero undeclared gaps fail calibration eligibility.
6. **Trust anchor.** Engine11 must provide an independently verifiable protected digest/signature over original raw-source payloads and a stable receipt ID. Engine12's `trustVerifier({provenance,packet})` must validate this against independently obtained protected evidence, not `provenance.signatureOrDigest.signatureStatus` or an Engine3-supplied boolean. `verificationMode=REAL_SOURCE_ATTESTED` only if both external trust and exact bar identity pass.
7. **End-to-end fixture.** Provide genuine, independently reviewed one-session ES 1m/5m/10m evidence and one case each for late/out-of-order, missing bar/outage, a rollover, source-timezone conversion (Chicago DST versus Phoenix), and a revision. Tests should prove exact packet/receipt digest/physical contract and as-of eligibility; a historical refetch must be rejected as an earlier original availability claim.

## Explicit STOP and safe sequencing

- This document and PR347 are **design/sandbox only**. Do not invoke the production recorder or even create an Engine12 production archive directory.
- No existing source is suitable for retroactively proving when original Engine3 evaluations saw provider bars unless original contemporaneous receipts already exist and can be verified.
- If a genuine provider-trace capture needs to run, obtain *separate explicit owner authorization* for scope, credentials, session, timestamp quality, byte cap, retention, storage and stop switch. Engine12 recording remains OFF independently.
- Do not switch `trustVerifier` to a caller-controlled `verified:true` flag. Preserve `SYNTHETIC_SANDBOX_ONLY` and `REAL_SOURCE_ATTESTED` as distinct statuses.
- Engine11 Manager must review the real source capture and signer/trust-anchor design before any genuine source can be called trusted. Engine12 Manager then independently verifies, Engine3 checks packet interface and only later a separate owner can consider activation.

## Outstanding API evidence needed from the source owner

- Is Massive ES endpoint truly *live entitled* for this deployment, and what lag/SLA and revision semantics are documented?
- What is the actual provider message/finality event available for the source of 1m, 5m and 10m completed bars?
- Which original raw source bytes/receipts are already durably preserved, and what were their real capture timestamps (not nominal candle starts)?
- Where is the approved signing key/trust anchor protected, and how is independent Engine12 validation performed without sharing writable credentials?
- Is there an existing authorized, verified clock sample/clock monitoring output for the host that received each event?

No answers should be invented. Until these are proven, Engine11 source attestation stays **BLOCKED**, even though the Engine12 writer is correct.
