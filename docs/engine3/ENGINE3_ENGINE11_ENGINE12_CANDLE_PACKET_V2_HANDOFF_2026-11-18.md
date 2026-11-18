# Engine 3 → Engine 12 / Engine 11 — Completed Candle Packet v2
**2026-11-18 | Issue #344 | PREPARATION ONLY; recording OFF**

Contract reviewed against Engine11 draft PR #347 (`engine11.es.completedCandleProvenance.v1`) and Engine12 Manager's ownership acceptance on Issue #344.

## Ownership
- **Engine11:** Original ES physical-contract, provider feed, entitlement, roll/price basis, source availability, receive/finality/clock/revision and calendar-gap attestation. Synthetic preflight is *not* real attestation.
- **Engine3:** Read-only, bounded packet preparation. No provider connection, no signing, no storage/writer/retention/activation decisions.
- **Engine12:** Independent receipt/source verification, separate immutable writer, manifest, quota/backpressure, restart/readback, retention and operational enablement. Its owner-accepted proposed root is `/var/data/replay/engine12-candles/`; canonical `/var/data/replay/es/` stays unchanged.
- **Engine18:** Ironbeam L2 depth recorder only, unchanged.

## Exact packet fields
`engine3.v6.rawBarPacket.preparation.v2` maintains the prior ES candidate/zone, Engine26 authorization, evaluation as-of, Engine22 as-of publication, completed 1m/5m/10m OHLC, SHA256, byte cap and dedupe key.

New fields:
- `engine11ProvenanceSchema`, `engine11ProvenanceReceiptId`, `engine11ProvenanceDigest`, and `provenance` (minimized **untrusted** source metadata and receipt pointer)
- `sourceCountsBeforeFiltering[1m|5m|10m]`, `sourceCountsAfterFiltering[...]`, `sourceFiltering[tf] = {observedCount, completedCount, acceptedCount, rejectedCount, formingCount, truncatedCount}`
- `sourceTimeframeMap[tf]`, `coverage[tf]`, `gapState[tf]`
- `sourceBarReferences[tf][] = {sourceBarId,sourceRevisionId,sourcePayloadDigest,sourceContract,providerEventId,firstReceivedAtMs,availableAtMs,completionObservedAtMs,finality}`

**No unverified source timestamp, receipt ID, sourceBarId, event ID, or finality is invented.** Missing Engine11 receipt yields explicit null/UNKNOWN references and `sourceEvidenceVerified:false`, `calibrationAdmissible:false`. All outputs return `recordingActivated:false`.

If Engine11 envelope is supplied, each bar reference must match exact timeframe, start/end, OHLC and must carry verified claimed arrival/availability/completion no later than packet evaluation and `finality=CONFIRMED`; mismatch returns `ok:false` and an exact reason. Coverage counts must reconcile with supplied raw arrays or packet is rejected. These are **structural matching checks**—not independent origin verification.

The packet's `sha256` proves only integrity of Engine3-prepared bytes; it cannot prove the actual provider sent those values or that Engine3 saw them historically. Engine12 must validate Engine11 raw/source evidence via its own trust root.

## Sandbox acceptance boundary
The companion pure `auditEngine3RawBarPacketForCalibration` now recognizes v2 and rejects incomplete or unknown coverage, missing exact bar references, missing/mismatched Engine11 receipt/digest, and no separately approved independent original-source verification. Even a structurally consistent synthetic envelope is still untrusted.

For Engine12, `ok:true` means **preparation finished** only. It **does NOT mean** source-verified, storable as a calibration-authoritative record, recorded, eligible for historical replay or owner-approved collection. Engine12 must make all of those decisions independently.

## Tests / limitations
Focused GitHub Actions at exact v2 audit revision: Phase3 26/26, Phase2 39/39, Phase1 36/36, syntax PASS.
Tests cover v2 bounded hashes and deterministic output; missing provenance, exact Engine11 IDs/revisions, synthetic envelope references, future availability and provisional bars, count mismatches and source digest. **No real provider attestation or Engine12 writer/readback has been tested here.**

Engine11 source identity/entitlement and original provider receipts are still unverified, and PR #347 is draft. No activation, merge, deployment, storage provisioning, scheduler or Engine3 Phase4 work was authorized.
