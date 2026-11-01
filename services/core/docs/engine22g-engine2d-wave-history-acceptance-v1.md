# Engine 22G → Engine 2D / Engine 22F — Automatic Wave History V1 Acceptance

**Draft PR:** #240 (development only; do not merge or deploy without owner approval).
**Authoritative input:** The ES `intraday_scalp@10m` Engine 22 Strategy card publication, including its seven-degree `authorizedWorkingStructure`, source `currentWavelength`, and sibling `sevenDegreeInvalidations`.

## Automatic update flow

1. Existing `buildStrategySnapshot.js` rebuilds the ES Strategy card.
2. After publishing `result.strategies["intraday_scalp@10m"]`, it reads that card's `engine22WaveStrategy` and captures the selected seven-degree source models, source anchors, Fib arrays, evidence and lifecycle.
3. Hash-linked journal checks the entire existing history, rejects corruption, and appends only a changed publication.
4. The Excel exporter generates `Frye_Elliott_Wave_History.xlsx` atomically from verified journal revisions, with 12 tabs: Current Anchors, Complete History, Change Journal, Change Details, Fibonacci History, and seven degree tabs.
5. The existing snapshot publishes `strategies["intraday_scalp@10m"].engine22WaveHistory` with `latestRevision`, `contentHash`, `latestObservation`, `workbookStatus` and explicit unavailable reasons.
6. Engine 2D's authenticated server-side consumer can read all previous revisions from `GET /api/engine22/wave-history?afterRevision=0&limit=50` or download the Excel from `GET /api/engine22/wave-history/workbook`.

## Render storage — owner authorized

The owner approved using the existing 100 GB disk of `frye-market-backend-1` (service `srv-d2ds5nodl3ps73b7i2og`), mounted at `/var/data/replay`. The journal uses only `/var/data/replay/engine22-wave-history/` and must not touch Engine 12 files.

The mount guard checks actual Linux mount metadata and refuses journal writes if the disk is absent or the journal path escapes its dedicated folder. File-based history is **single-writer only**.

## Authentication and release

The history API requires a separate server-side `ENGINE22_WAVE_HISTORY_READ_TOKEN` (at least 32 characters). Do not expose this token in browser JavaScript or commit it to GitHub. The existing dashboard should proxy authenticated access through a subscriber/owner authorization layer.

The initial event is labeled `INITIAL_OBSERVATION_NOT_HISTORICAL_RECONSTRUCTION`. Old dates in owner charts do not imply old publication times.

PR #239 contains the separate chart anchor adapter. It is **not merged into PR #240**. Engine 2D must not assume both fields exist on the same live snapshot until a combined isolated integration test passes.

## Acceptance evidence and remaining gates

Dedicated CI verifies append-only history, hash integrity, corruption/partial-write handling, lock contention, deduplication, independent process restart, 12-tab XLSX ZIP/XML validity, and missing mount protection.

Before production release: verify an actual Render persistent-volume restart/redeploy, authenticated full Strategy-card runtime publication, integration with PR #239 and Engine 2D PR #135, and owner-approved release. These tests cannot be represented as passed merely because CI passed.
