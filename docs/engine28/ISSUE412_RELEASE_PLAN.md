# #412 Automatic PAPER Trade Verification — release plan

**Status:** prepared by Claude (lead programmer), for Engine 8 independent review, Engine 10B re-review and owner authorization. Nothing here is enabled.

## 1. What ships

| PR | Base | Contents |
|---|---|---|
| #417 | `main` | Engine 8 producer: receipts, durable fill/Journal evidence, coverage, health, combined producer |
| #419 | #417 | Engine 28A: bounded observers, skip visibility, noninterference + integrated scheduler tests |
| #422 | #419 | Producer F-3 (per-day receipt folders), `SCHEDULER_SKIPPED`, Engine 12 consumer restack + regressions 1–4, per-approval, health, Replay chronology |
| #420 | `main` | Phone page `/paper-verification.html` (display-only) |
| #423 | `main` | One-off evidence preservation script (independent of the rest; time-sensitive) |

PR #402 (Engine 8 eligibility repair) is **not** part of this release.

## 2. Gates before any merge

- [ ] Engine 8 independent review of the exact integrated head (#422)
- [ ] Engine 10B re-review of Journal/ACK matching at the same head
- [ ] Engine 12 review of the restacked consumer
- [ ] All workflows green at that exact head
- [ ] Owner authorization (merge to `main` = production deploy)

## 3. Merge order

1. **#423** first, then run its dry run and `--execute` once (owner-authorized). It doesn't depend on anything else.
2. Retarget #422 to `main` after #417 and #419 are approved. Merge as one release so `main` never holds a half-integrated producer and consumer. Equivalently, merge #417 → #419 → #422 back to back.
3. #420 after #422 (it reads `perApproval`, `observedReplay` and `observerHealth`).

Merging alone changes no behavior: every verification path is off until the flags in section 4 are set. Two small always-on changes ship with the merge: a log line when a slot is skipped (`SLOT SKIPPED ALREADY_RUNNING`), and the bounded observer wrapper, which is inactive while verification is off.

## 4. Switching on (owner-authorized, staged)

**Stage A: record only (no phone yet)**
1. Create the private receipt folder once on the production disk:
   `mkdir -m 700 /var/data/replay/engine8-verification-receipts`
2. Render env on `frye-market-backend-1`:
   - `ENGINE8_PAPER_VERIFICATION_ENABLED=1`
   - `ENGINE8_PAPER_VERIFICATION_DIR=/var/data/replay/engine8-verification-receipts`
   - Optional: `ENGINE28A_OBSERVER_TIMEOUT_MS` (default 2000, max 5000), `ENGINE28A_OBSERVER_MAX_IN_FLIGHT` (default 8, max 32)
3. Watch one trading session. Expect: cycle times unchanged (~50 s), no `ENGINE28A_OBSERVER_EVIDENCE_GAP` lines, a day folder filling with receipts.

**Stage B: protected read surface + phone**
1. Generate a new access key of at least 32 random characters. Store it **only** in Render env:
   - `TRADE_INVESTIGATOR_ENABLED=true`
   - `TRADE_INVESTIGATOR_ACCESS_KEY=<key>`
2. On the phone, open `https://frye-market-backend-1.onrender.com/paper-verification.html` and enter the key once.

**Rollback:** set `ENGINE8_PAPER_VERIFICATION_ENABLED=0` and/or `TRADE_INVESTIGATOR_ENABLED=false`. Trading is unaffected either way. Receipts are kept; nothing is deleted.

## 5. Acceptance in production (Stage A + B, one full Arizona day)

- [ ] Cycle duration and Step 0 timing match the pre-release baseline (Render logs)
- [ ] Every Engine 6 approval appears in `perApproval` with YES or UNKNOWN and its blocker
- [ ] Any PAPER fill appears as YES with the Journal matched
- [ ] Skipped slots show in `receiptCoverage.skippedSlotsObserved` and in the logs
- [ ] The day verdict stays UNKNOWN unless a fill is verified. **NO is not expected yet**: it needs a server coverage attestation that doesn't exist (section 6)
- [ ] The public #412 report shows sanitized counts only

## 6. Known limits at release (stated, not hidden)

- **Day-level NO is not available.** It needs an authentic expected-schedule source: read-only Render API access (a new secret, owner decision) or another independent manifest, plus retention proof. Until then the day verdict is YES or UNKNOWN.
- **The observer delay is bounded, not zero:** with hung storage, the executor exits up to one observer timeout (default 2 s) after the order outcome. Tested: the next cycle and its protective Step 0 still start on time.
- **Shared-disk contention is not proven** under a real slow disk. Recommended: watch the Stage A metrics.
- **The scheduler lock is in memory.** Overlap across a restart is possible (pre-existing). Not changed.
- **Pipeline Doctor exit code still gates Step 4 execution** (pre-existing). Engine 8 recommends separating diagnostic from safety failures; that needs a separate owner-approved change.
- **Health alerts show on the phone page only.** No push notifications, because that would be a new external service.
