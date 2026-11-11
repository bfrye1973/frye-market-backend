# Engine 18B — Post-PR301 Engineering Readiness

**Status:** PR #302 on manager-created clean branch `engine18-manager-post301-clean-20261111`, **NOT merged/deployed**. The manager has already merged approved PR #301 into the isolated Engine 18 foundation. All subsequent work belongs in **PR #302 only**, with the manager owning final merge.

## Work completed without rebuilding the recorder

### Verified inventory cache — focused operational efficiency
- `engine18Phase5S3Coordinator.js` retains the verified, AES-GCM-authenticated hash-chain inventory **in memory only** after one full reconciliation on worker startup.
- Normal 30-second backup scans do not list or download the remote inventory when there are no new completed archives. Already acknowledged, size+mtime-unchanged local gzip/manifest pairs are not rehashed on every scan.
- New sealed hours preserve archive SHA-256, original manifest and sequence continuity; after immutable upload, only the **new** encrypted inventory entry is read and authenticated. The proven head is extended locally.
- A configurable full reconciliation (15 minutes by default) re-lists the remote inventory, checks all sequence ranges/hash links, and rehashes local sealed archives; restart forces a new full read regardless of previous process memory.
- Any remote high-watermark regression, changed head at the same sequence, changed previously acknowledged local archive, missing original manifest or stale rotation race remains fail-closed. Full certified restores **always** reconcile remote inventory against an independent pinned lastSeq. This is a cache optimization, **not a replacement for durable independent remote proofs or an external lastSeq pin**.
- Unit tests verify fewer remote GET/list calls during no-op scans, a single newly authenticated entry on rotation, periodic reconciliation, restart, and missing final inventory detection.

### Independent Ironbeam v2 recorder connection rehearsal
- `engine18IronbeamV2RecorderRehearsal.js` is a **synthetic-only injected connection**, locked to `https://synthetic.ironbeam.invalid`. It **cannot** open actual `demo.ironbeamapi.com` or use live credentials. It mirrors the existing v2 auth → stream create → quote/depth/trade subscribe calls without changing the production Ironbeam monitor.
- The existing approved Phase3 supervisor records per-connection generation, subscription SUCCESS/FAILED, physical ES contract, safe stream ID, source interruptions/FEED_GAP, exact UTF-8 or binary raw, and original receipt clocks. Each delayed old-socket frame keeps its original generation. Token-bearing WebSocket URL is not persisted in recorded event/control data.
- Actual live service still requires separately approved private worker transport, credential injection/rotation, stream-ID entitlement confirmation, session calendar, verified Chrony/PTP and safe recording start/stop gates.
- **Never assume that an Ironbeam depth frame is a complete order-book image**. Zero-size, `l`, implied quantities and possible conflation remain for Claude to establish from authorized recordings.

### Read-only institutional/Engine22 research context
- `engine18ReadOnlyResearchContext.js` extracts exact published `structures_sticky` institutional ES zones and `engine22WaveStrategy.currentWavelength.degrees.micro/submicro` from existing source snapshots, without rewriting wave nodes, owner-approved Fibonacci calculations, strategy cards, chart overlays or trading logic.
- Immutable copies preserve all published fields. No fabricated zone or liquidity price is returned; `bookLiquidity` remains `null` until independent real market-book reconstruction is validated.
- Point-in-time and price-basis gates prevent retroactive owner revisions from being projected into prior sessions. Future context-source connectors must validate authoritative revision timestamps and physical/continuous ES contract reconciliation.

## Shortest safe path to first controlled recording

1. **Manager independently audits and merges PR #302** after exact-head CI. PR #301 is already merged; do not repeat its work or create another duplicate PR.
2. Accept the independent synthetic Ironbeam v2 connection rehearsal: explicit WebSocket OPEN before subscribe, immutable generation, exact raw depth/quote/trade/binary preservation, denied/failed subscriptions and FEED_GAP. This is **not** a real authorized source adapter; the separate private-worker credential/transport configuration remains an activation gate.
3. Apply the dedicated 19-check private controlled-trial gate in `engine18ControlledTrialReadiness.js`, and follow `docs/engine18b/PR302_CONTROLLED_RECORDING_TRIAL.md`: private destination, encrypted backup and externally pinned inventory, protected credentials, host clock, CME calendar, worker capacity, supervisor and shutdown drill. Do not provision infrastructure without manager's separate approval.
4. Authorize one tightly supervised real Ironbeam ES recording trial. Capture all raw depth/quote/trade frames and subscriptions, reconcile source events to durable sequence, and complete a verified restore.
5. Claude validates full/delta/conflated depth semantics, level-index/zero-size/implied fields and vendor time provenance. Only then build tested liquidity persistence/depletion/replenishment and price-contact labels; afterward compare institutional zones and Micro/Submicro/Fib context read-only, without hindsight.

## Safety and budget

No Render service, S3/R2 bucket, paid worker/disk, licensed raw recording, LIVE chart, Engine 11/22, trading system or existing `/var/data/replay` 100 GB backend disk changed.

**Owner priority is engineering completion.** The conditional ~$22/month estimate is not a live activation authorization, and actual outbound bandwidth/compute should be checked briefly at the provisioning decision, not optimized before finishing the recorder. The separate manager approval gate will resolve cost if the safe design exceeds the initial estimate.

## PR #302 verification and merge boundary

The updated `.github/workflows/engine18b-post301-readiness.yml` now targets `engine18-manager-post301-clean-20261111`, runs UTC and Arizona CI, and includes the full prior Gate 1–5 regression suite and the PR302 integration tests. `engine18ControlledTrialReadiness.js` only reports missing readiness evidence and **never enables live capture**. The existing LIVE chart, Ironbeam research monitor, Engine 11, Engine 22, broker and execution systems are not modified.

Exact-head GitHub Actions evidence must be referenced in PR #302's final review handoff. The manager alone merges. Approval of the synthetic PR does not authorize deployment, paid storage or real Ironbeam raw recording.
