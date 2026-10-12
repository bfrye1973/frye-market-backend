# Engine 8D — New PAPER Store / No Historical Migration

**Owner instruction:** Do NOT migrate historical PAPER records. The code on PR #98 must not import, read, copy, merge, overwrite, or delete legacy PAPER files as a side effect of new PAPER execution.

**Status:** Feature branch only. No production deployment, merge, restart, PAPER trade, or REAL broker action authorized.

## Storage decision

- The new PAPER executor uses only `/var/data/replay/engine8-paper` on the existing Render persistent disk.
- The five independent new-store files are `paper-orders.json`, `paper-executions.json`, `paper-idempotency-ledger.json`, `engine8-paper-execution-state.json`, and `engine8-paper-acceptance-state.json`.
- Existing historical PAPER files under `services/core/data` are **never imported or modified**. No migration manifests are created.
- Missing new-store files represent a new, empty PAPER store; corrupted existing new-store files fail closed instead of being silently reset.
- No REAL Engine 10 Journal, Schwab OAuth, broker-watermark, or REAL execution file is moved or touched.
- The read-only `scripts/auditEngine8PaperStorage.js` may be used only to verify that the target is clean if specifically requested; its execution is NOT needed for a historical migration, because none will occur.

## Production gate (future Manager approval required)

1. Inspect *only* the new target directory read-only. If it already has records or orphan locks, **stop**; do not overwrite, discard, or initialize across an ambiguous state.
2. With separate authorization, take a backup of the new target before the first production release and preserve it after release. This backup must not change legacy files.
3. Only after Manager approves the PR and deployment, activate the new PAPER storage path. Review atomic writes and the Engine 8 administration requirement.
4. Before accepting any user-directed PAPER instruction, verify new-store persistence, unique idempotency identities, Engine 10 Journal-only retry, and that REAL Schwab behavior is unchanged.
5. Perform an authorized restart persistence test only after separate approval.

## Crash and stranded-lock handling

- Every manual PAPER instruction is protected by a global persistent-disk mutation lock and a per-idempotency-key lock.
- Hard process death intentionally retains the lock and blocks new execution: **never auto-expire it**.
- Authenticate and query `GET /api/trading/paper/recovery-status?idempotencyKey=...`. Preserve original lock, ledger, order, execution and Journal records.
- States `RESERVED_WITHOUT_RECORDED_FILL`, `PARTIAL_OR_UNACKNOWLEDGED_FILL_RECORDING`, and `AMBIGUOUS_FAIL_CLOSED` require reconciliation. Never create a replacement fill automatically.
- For a verified `JOURNAL_ONLY_RETRY_ELIGIBLE` event, request Engine 8A approval to resolve any stranded lock, then use the admin-only `POST /api/trading/paper/retry-journal` with the original key. Engine 10 must acknowledge the original event with a tradeId before `JOURNAL_COMPLETE`.
- An operator must verify the original process is dead, preserve evidence, and obtain Engine 8A approval before clearing a lock. No unlock endpoint or automatic lock deletion is implemented.

## Rollback

Before production: reject or close PR #98; current deployment and historical files are unchanged.

After a separately authorized deployment: stop new PAPER execution, preserve and back up new-store files/locks and all Engine 10 identities, then roll back code only with Manager acceptance. Never delete new-store data and never resume writing to the old ephemeral ledger.

## Evidence boundary

GitHub simulations prove independent new-store behavior and restart safety, but do not prove that the actual production directory is empty. Read-only target inspection remains a future deployment checkpoint. No migration of historical PAPER data is authorized or required.
