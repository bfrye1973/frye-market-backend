# Engine 11 → Engine 12: Private Original-Byte Evidence Custody and Independent Verification
**Issue #344 · 2026-11-18 · DESIGN ONLY, NOT STORAGE APPROVAL · Engine 12 final custody decision required**

## Decision and boundaries

The owner directed us to select **one existing private storage candidate**, obtain Engine 12's acceptance or rejection, agree on independent verification, **then** seek separate owner approval for any additional capture. No new provider requests, trial runs, database/resource provisioning, writes to the production persistent disk, merge, deployment, raw-data public artifact, recorder activation, Engine18 coupling, or Phase4 work are authorized.

**Candidate (not yet approved):** the existing persistent Render disk `dsk-d6a9f9fgi27c73affbdg`, attached exclusively to `frye-market-backend-1` / service `srv-d2ds5nodl3ps73b7i2og`, mounted `/var/data/replay` and sized 100 GB, as confirmed by a *read-only connected Render service inspection*. The raw source-evidence candidate root would be `/var/data/replay/engine11-source-evidence/` (separate from canonical `/var/data/replay/es/` and Engine12's proposed `/var/data/replay/engine12-candles/`). This is **only a path design**. Directory does not exist by action of this design. Mount capacity is not free-space evidence, and the same volume has correlated-failure and accidental-quota-exhaustion risk.

**Engine 12 must ACCEPT or REJECT this single candidate explicitly** before it is used. Acceptance requires documented actual free space, strict independent byte cap/alert thresholds, sole writer process ownership, no sharing across Render services, mount permission tests, file permissions/UID, retention and backup/restore, whether the vendor license permits retaining raw bytes, source-verifier read-only access, and proof canonical Replay hash/schedules/retention are unaffected. If Engine12 rejects it, return the precise blocker for a new owner storage decision; do not quietly switch storage providers or provision a resource. This does not propose using a separate Engine18 recorder disk.

### Security and accountability checklist

| Requirement | Proposed control / validation still required |
|---|---|
| Data classification | Restricted licensed Massive/Polygon ES original responses; never store in public GitHub, public Actions artifact, issue attachment, plaintext logs or web-served directory |
| Access control | Writer service's distinct, non-web-exposed mount subdirectory; mode `0700`; original files `0600`; no status endpoint to serve raw data; explicit nonsecret receipt IDs in diagnostics only |
| Credentials | Provider API secret stays in protected environment managed by existing service owner; no API keys or Authorization headers in stored request URLs/receipts/logs; independent verifier uses separate read-only credentials/access only if actually supported |
| Encryption in transit | Provider HTTPS/TLS with redirect disabled; internal verifier must use local read-only mount or approved TLS channel; check upstream TLS origin and avoid credential in query |
| Encryption at rest | **Unverified for candidate**; independently validate Render platform disk protection / add approved application-layer encryption only if necessary after Engine12 security review. Do not claim compliance from assumption |
| Physical contract | Capture the exact resolved `ESZ6` or other provider contract, original contract selection and evidence of each rollover; root `ES` is insufficient |
| Capacity and quota | Set explicit hard namespace byte ceiling *well below verified free space*, backpressure before Replay saturation; Engine12 owner chooses numbers from measured use and trial size. No invented size/threshold |
| Retention and deletion | Default no automatic cleanup of committed evidence without separately approved retention; bounded trial has explicit authorized deadline and custody/deletion receipt; canonical Replay deletion policy unchanged |
| Backup/restore | No verified independent backup presently established for this candidate; Engine12 must define protected encrypted backup and independent byte-identical restore proof BEFORE evidence acceptance |
| Audit trail | Exclusive immutable file claims, SHA-256 readback receipts, source provider/request/contract/time and parser metadata, read-only verifier access logged, failures and deletion authorization journaled separately |
| Engine12 owner | Engine12 manager approves/rejects root, account costs, quota and retention; Engine11 owns source receipt/verifier format, Engine3 consumes independently verified provenance only |

### Why the November 18 one-shot trial is insufficient

Run `44336350771` captured 45×1m, 9×5m, 5×10m recent Massive ESZ6 bars in ephemeral GitHub-runner `/tmp`, reopened/rehashed raw bytes, published only metadata, then deleted originals. We cannot independently replay original bytes now. Its request/HTTP response clocks are **runner fetch-time measurements**, not provider event transmission time, original production Engine3 availability or verified NTP error bound. It proved source access, not historical point-in-time attestation.

## Immutable original-byte evidence envelope v1

Schema candidate: `engine11.es.originalSourceByteEvidence.v1`.

**Immutable contents and receipt linkage (all fields explicit, do not invent):**

```json
{
  "schema": "engine11.es.originalSourceByteEvidence.v1",
  "sourceMode": "ORIGINAL_CAPTURE",
  "physicalContract": "ESZ6",
  "providerId": "MASSIVE_POLYGON",
  "feedId": "UNKNOWN",
  "accountChannelIdHash": null,
  "providerEntitlement": "UNKNOWN",
  "request": {
    "method": "GET",
    "origin": "https://api.massive.com",
    "path": "/futures/v1/aggs/ESZ6",
    "queryWithoutSecrets": {},
    "requestId": null,
    "requestIdStatus": "UNKNOWN"
  },
  "response": {
    "status": 200,
    "providerResponseId": null,
    "rawByteLength": null,
    "rawSha256": null,
    "contentEncoding": "HTTP_DECODED_BYTES",
    "bodyFileId": null
  },
  "clock": {
    "requestStartedAtUtcMs": null,
    "firstByteReceivedAtUtcMs": null,
    "bodyCompletedAtUtcMs": null,
    "monotonicRequestStartedNs": null,
    "monotonicFirstByteNs": null,
    "monotonicBodyCompletedNs": null,
    "independentClockSampleId": null,
    "maxClockUncertaintyMs": null,
    "clockStatus": "UNVERIFIED"
  },
  "identity": {
    "parserVersion": "UNKNOWN",
    "configDigest": "UNKNOWN",
    "resolverVersion": "UNKNOWN",
    "sourceFingerprint": "UNKNOWN",
    "sessionCalendarVersion": "UNKNOWN",
    "rollEvidenceId": null
  },
  "sourceClaims": {
    "sourceEventId": "UNKNOWN",
    "providerFinality": "UNKNOWN",
    "originalEngine3AvailableAtMs": null,
    "asOfVerified": false
  },
  "integrity": {
    "receiptId": null,
    "receiptDigest": null,
    "issuerKeyId": null,
    "issuerSignature": null,
    "issuerSignatureStatus": "UNVERIFIED"
  }
}
```

All values shown are *illustrative, not actual source receipts*. The previous REST responses are **HISTORICAL_REFETCH** for any Engine3 as-of before this fetch, even if fetched from Massive's original endpoint. The label `ORIGINAL_CAPTURE` means raw bytes captured upon actual request arrival; it **does not itself** prove original upstream bar generation/finality or Engine3 production availability. Preserve both `captureMode` and `asOfAdmissible` separately.

Use byte-level request origin/path, physical ticker and provider HTTP status, provider event/response IDs if actually furnished, raw **HTTP-decoded** bytes (explicitly record encoding/decoding policy and original content encoding), byte count/digest, parser/resolver versions, request/headers/last-byte clocks, monotonic clock correlation and independently measured clock uncertainty. Never infer provider finality or LIVE entitlement from aggregate timestamp or response arrival.

### Independent verifier and custody protocol (design)

1. Check named candidate storage has received Engine12 **written acceptance** and an explicitly authorized limited trial ID; reject if not. Validate private path against canonical Replay and public web trees. Never create files on a design-only invocation.
2. The source owner writes the *original received bytes*, not reserialized JSON, in an exclusive no-overwrite immutable file. Record separately the exact request, response, contract selection and UTC/monotonic receipt fields. Flush + fsync data and containing directory and independently read it back. Protect raw data from public logs/artifacts; enforce quota before writing.
3. Engine11 issues an immutable versioned receipt with body length/SHA and source-capture identity. Signature trust must be anchored to an independently protected signing key or equivalent approved authority. Self-reported SHA or a caller boolean is not trusted.
4. Engine12's **separate verifier**, using read-only original bytes, recomputes byte SHA/count, verifies issuer and request/provider/physical contract identity, validates that each derived 1m/5m/10m OHLC came from the referenced raw body, and checks source revision IDs, roll lineage, provider event time, and availableAt/finality evidence. It independently cross-checks Engine3 packet bars and evaluation time (the PR #349 writer already has the exact packet-vs-envelope gate).
5. A trusted source receipt must never assert historical `availableAtMs` from `window_start` or a later REST fetch. If provider source arrival/finality, entitlement or clock is still UNKNOWN, return `SOURCE_UNVERIFIED`; no `REAL_SOURCE_ATTESTED` promotion. Keep `SYNTHETIC_SANDBOX_ONLY` separate.
6. Simulate failures only in temporary **synthetic** test directories: corrupt bytes, mismatched digest/signature, old/unknown contract, late/revised bar, unavailable original, out-of-order response, missing provider event ID, outage, wrong as-of, missing clock sample, missing entitlement, restart/readback, quota and permission failures. No licensed provider bodies in public CI.
7. Release only a **metadata-only** report (hash/count/status/synthetic test outcomes), and retain the raw evidence in the approved private location if and only if future trial authorization permits it. Deletion and backup/restore are separate Engine12-controlled auditable actions.

## Source coverage, rollover, and finality matrix

| Source TF | Proposed native provider resolution | 11/18 temporary trial observation | Calendar/coverage & roll evidence required | Finality / as-of status |
|---|---|---|---|---|
| 1m | `1min` | 45 results, ESZ6 | Per-minute expected vs observed; maintenance/holiday calendar; physical contract and resolver epoch; duplicate/revisions/late/unknown count | **UNKNOWN** provider finality and original Engine3 receipt |
| 5m | `5min` | 9 results, ESZ6 | Per-five-minute expected vs observed and source revisions; same contract epoch; cross-check native versus aggregate dependency if any | **UNKNOWN** provider finality and original Engine3 receipt |
| 10m | `10min` | 5 results, ESZ6 | Per-ten-minute expected vs observed; exact interval start/end and independent coverage; contract/roll provenance | **UNKNOWN** provider finality and original Engine3 receipt |

A requested 45-minute REST lookback with 5×10m rows does not establish that all five bars were **final/complete** at response or originally available during past evaluations. A response cannot be retroactively used as proof of a previous day's or minute's production Engine3 knowledge. No rollover event, gap-free completion, independently measured clock uncertainty, or source entitlement has been accepted yet.

## Exact blockers to `REAL_SOURCE_ATTESTED`

- Engine12's written acceptance of existing disk candidate and security/cost/quota/retention/backup responsibilities.
- Actual Massive ES feed account/entitlement (LIVE/DELAYED/SAMPLE) and allowed raw storage/replay terms, verified with provider.
- Protected original bytes available for independent readback and issuer verification; the one-shot's originals were deleted.
- Authenticated provider source-event/finality and revision model or a separately evidenced completion/finality policy; no inferred `CONFIRMED`.
- Independent UTC clock synchronization/uncertainty and local monotonic correlation on **the actual capture host**, not another GitHub runner.
- Exact physical futures contract/roll epoch and per-timeframe gaps/calendar and before/after counts; evidence of when Engine3 could have seen each value.
- Separate owner approval for *any* additional provider capture or storage writes; a verified rollback/stop plan.

**Engine11 disposition:** delivers this design for Engine12 APPROVE/REJECT and Engine3 review. Source attestation remains **BLOCKED**. PR #347 is DRAFT. Engine12 PR #349's 19/19 sandbox acceptance stands; recording OFF; Phase4 unauthorized. No live source capture was run or requested by this document.
