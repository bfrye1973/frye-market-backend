# Engine 8D — PAPER Foundation Migration and Crash Recovery Runbook

**Status:** manager-gated, feature-branch development only. No production mutation or deployment authorized.

## Storage authority
- Render service: `frye-market-backend-1`; confirmed mounted 100GB persistent disk at `/var/data/replay`.
- PAPER target: `/var/data/replay/engine8-paper`.
- Historical source (if still present): `/opt/render/project/src/services/core/data` (actual install path should be confirmed read-only).
- Managed files: `paper-orders.json`, `paper-executions.json`, `paper-idempotency-ledger.json`, `engine8-paper-execution-state.json`, `engine8-paper-acceptance-state.json`.
- **Never** include real `trade-journal.json`, Schwab OAuth/private store, broker fill watermarks, or REAL execution files in this migration.

## Pre-deploy inventory — read only
The connected Render service API currently exposes disk configuration but not mounted filesystem reads. No historical production bytes have been inspected.

With explicit Manager authorization for a **read-only** Render Shell audit, execute the following *existing code* on a running service (or an identical read-only checkout with mounted disk):
`node services/core/scripts/auditEngine8PaperStorage.js`

It emits only file presence, record counts and SHA-256 hashes; no order IDs, secrets or account values. It does not modify, migrate, restart or deploy anything. Any invalid JSON, conflicting historical/durable files without a migration manifest, or changed source after migration is a STOP condition. If the new script is not available on production (because deployment is blocked), use a read-only equivalent that only stats/hashes the five listed files, or postpone until Manager approves staging it.

## Migration approval gate
1. Record checksums and record counts for all five historical files before any cutover. Preserve copies/backups on persistent storage under an explicitly Manager-approved, non-conflicting location. No automated production copy is authorized by this runbook.
2. Confirm destination does not contain unrelated historical data. If source and target both exist without the recorded migration manifest, abort. Do not merge JSON arrays blindly.
3. After explicit merge/deploy approval, the PAPER store copies valid historical data to its new persistent target on first access and writes a per-file migration manifest with source SHA-256. It never deletes legacy files. It refuses unreadable/corrupt legacy data and manifest mismatches.
4. Verify exact record counts, identities, and SHA-256 before accepting the migration. Confirm all five files remain after a separately authorized service restart. **Do not initiate a restart as part of inspection.**
5. Keep the verified historical backup and log the approval/deploy SHA. New PAPER entries are disabled until acceptance checks complete.

## Crash recovery
- A per-instruction lock and one shared JSON mutation lock are created atomically on the persistent disk. Different processes cannot simultaneously commit conflicting PAPER idempotency ledgers.
- Hard process death leaves an unreleased lock. **Never auto-expire or automatically delete such locks.**
- Authenticated read-only `GET /api/trading/paper/recovery-status?idempotencyKey=...` returns classification without creating an execution or altering a Journal.
- `NO_RESERVATION_FOUND`: do not infer a fill exists; verify the lock before deciding any subsequent operation.
- `RESERVED_WITHOUT_RECORDED_FILL` / `PARTIAL_OR_UNACKNOWLEDGED_FILL_RECORDING` / `AMBIGUOUS_FAIL_CLOSED`: stop. Preserve files and investigate with Engine 8A; no automatic resubmission.
- `JOURNAL_ONLY_RETRY_ELIGIBLE`: original order+fill identities are present. After a Manager-authorized resolution of any stranded lock, use admin-only `POST /api/trading/paper/retry-journal` supplying only the existing idempotencyKey; it resends the stored original Journal event, never a new simulated fill.
- `JOURNAL_COMPLETE`: requires Engine 10 acknowledgment with tradeId. Repeat retry must return the same identity.
- Engine 10 is authoritative for tradeId, contractId, FIFO and realized P&L. Never synthesize these during recovery.
- **Stranded-lock removal is not automated in this PR.** Require Manager approval, evidence that prior process is dead, preservation of all source files, and explicit documented reconciliation before any manual unlock.

## Rollback
Before deployment: close PR #98 or revert its commits; production is unchanged.
After a separately approved migration: stop new PAPER orders, preserve target and migrated source/manifest/backups, revert application code only with Manager approval. Do not delete or overwrite durable files; old code must not silently resume writing ephemeral records. Reconcile journal-pending identities before resuming trading.

## Acceptance limitation
Tests on disposable GitHub runners demonstrate simulated migration/restart/crash recovery and duplicate prevention, **not** the contents of the mounted production disk. Production historical migration and restart verification remain deployment-gated and unverified.
