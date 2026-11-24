# Engine 12 Trade Investigator: API contract (PR 1)

`GET /api/v1/trade-investigator`. Authenticated (`X-Trade-Investigator-Access`), GET-only, read-only, bounded and redacted. Off unless `TRADE_INVESTIGATOR_ENABLED=true`.

## Evidence sources

| Source | Nature | Guarantee |
|---|---|---|
| Engine 12 Replay `/var/data/replay/es/YYYY-MM-DD/HHMM.json` | Immutable point-in-time decision evidence | The SHA256 is computed over the exact bytes read for each response. Replay retention is about 14 Arizona days. |
| Engine 28A (`engine28APipelineDoctor`, Strategy 1 only) | Recorded first blocker inside Replay | Trusted only under the same-cycle / same-strategy / known-contract / canonical-gate / registry-date checks. |
| Engine 8 PAPER store `<ENGINE8_PAPER_DATA_DIR>/paper-orders.json`, `paper-executions.json` | **Mutable durable store**: atomic replace + fsync | **No time-based retention guarantee defined in code.** |
| Engine 10 Journal `<TRADE_JOURNAL_DIR>/trade-journal.json` | **Mutable durable store**: temp file + rename | **No time-based retention guarantee defined in code.** |

**Engine 8 / Engine 10 limitation.** These are not immutable archives. Records persist until they are explicitly changed or deleted, or the storage is lost. Completeness for an arbitrary old date is **not** guaranteed.

Every response carries each store's `readAt`, `sha256`, `mutable: true` and `retentionGuarantee: "NONE_DEFINED"`. Missing or unmatched execution or lifecycle evidence returns `lifecycle: "UNKNOWN"`. That is never proof that no order or trade existed. The product must not promise "all historical execution events forever"; that would need a separate immutable execution-evidence archive.

## Authority registry

Authority is asserted only for evidence-proven dates. Currently that is **2026-11-24**, from the real Nov 24 fixture chain. Any other date returns authority `UNKNOWN` and the flag `AUTHORITY_NOT_PROVEN_FOR_DATE`. Rows are closed ranges, and coverage is extended only with new dated evidence.

## Status semantics

Engine `status` is one of `PASS | WAITING | BLOCKED | NOT_REACHED | INFERRED_PROGRESS | UNKNOWN`. `rawStatus` is always returned verbatim.

- **PASS** only when the engine's own stored canonical fields prove it (`gate: PASSED`), or for Engine 10 when a lifecycle record with a `tradeId` is attached.
- **Upstream of a trusted 28A first blocker:** PASS when the engine's own canonical gate is PASSED; otherwise `INFERRED_PROGRESS`. Blocker position alone never produces PASS. 28A stage words are returned verbatim as `engine28aRecordedStage` and never mapped by name.
- **WAITING / BLOCKED** come only from exact mapped values (`statusMap.v1`) or explicit flags. Unmapped values are UNKNOWN.
- **Diagnosis flags** are reported at the result level: `BLOCKER_CONFLICT`, `IDENTITY_CONFLICT`, `AMBIGUOUS`, `ERROR`, `DUPLICATE_BLOCK_RECORDED`, `AUTHORITY_NOT_PROVEN_FOR_DATE`.

## No lookahead

- `knownAtDecision` is built only from the selected Replay snapshot (at or before the requested time).
- Engine 8 and Engine 10 events are split into `priorEvents` and `subsequentEvents` around Engine 8's `evaluatedAt`.
