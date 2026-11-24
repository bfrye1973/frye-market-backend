# Engine 3 v6 Phase C — isolated, main-based offline research (NOT production)

**Status:** Draft PR #389. No runtime import from production, no Engine 3 v5 behavior change,
no Engine 4/6/8 permissions, no broker, no recording, no Replay modification.
The seven acceptance topics are covered by focused reducer tests and the ported
causal Phase2/3 test suite, but original Nov 17–24 v6 trade results are **NOT VERIFIED**.

## Included

- `services/core/logic/engine3/v6/`: pure Phase1 held-direction reducer,
  post-Engine26-authorization completed-bar Phase2 control/geometry,
  Phase3 offline fixture runner and causal trace.
- `attestCompleted5mBreakout.js`: a postauthorization, time-bounded, full-body
  completed 5m breakout check with prior-zone-interaction requirement. It does
  **not** turn a wick or partial body into a valid break.
- Reclaim: later fully completed candle body back beyond the broken edge
  invalidates the held v6 direction to NEUTRAL; opposite establishment is
  deferred (not a same-evaluation flip).
- Retest: completed bar probing the broken edge and closing on the breakout
  side reports a **diagnostic**, never a new entry permission.
- Candidate **and zone** identity change clears old state and breakout metadata.
- CI tests include LONG/SHORT symmetry, future/incomplete/preactivation
  rejection, no duplicate rewind and no Engine6/8 authority.
- `phaseAHarness.core.js` is a verbatim copy of Claude's PR #390 exploratory
  scoring core, so the same scoring rule can be used once inputs are available.

## Comparison runner — SAFE OFFLINE ONLY

The runner **does not fetch** a live endpoint. An authorized research process
must supply a local JSON packet list with original Engine12 snapshot receipts,
as-of Engine26 authorization metadata and completed 1m/5m bars available at
each evaluation time. Do not add raw licensed bars to a public repository.

```sh
node scripts/research/phaseC/runPhaseC.mjs \
  --packets /approved/private/phaseC_packets.json \
  --bars /approved/private/phaseA_exact_5m.csv \
  --bars-sha256 d10bc2d5d1cde76c70bd1847e4d698e49ef8e1e93f924fd5dd2dd375cde0b53a \
  --out /approved/private/phaseC_comparison.json
```

Packet shape: `{"rows":[{"replay": { "day":"2026-11-24",
"tm":"0746", "snap":"2026-11-24T14:45:59Z", "e3":"NEUTRAL",
"price":7206.75, "zid":"...", "zlo":7138, "zhi":7210.75, "elig":true },
"fixture": { "normalizedZoneInput": {...},
"engine26LocationCandidate": {...}, "engine26ReactionHandoff": {...},
"bars1m": [...], "bars5m": [...],
"evaluationTimeMs":179552?? }, "asOfReplayVerified":true}]}.
**The timestamp above is illustrative only; supply exact real ISO and matching
epoch milliseconds from the original Replay file. Never infer them.**

The runner:
1. Validates the exact market-bar SHA256 from Phase A PR #390.
2. Computes the original v5 score from the recorded as-of decision rows.
3. Replays v6 pure research state, requiring the Engine26 authorization contract
   to be `AUTHORITATIVE_TIMESTAMP_VALID` for every row.
4. Only publishes a v6 aggregate when **all** packet inputs are admitted.
   Otherwise writes `status=INCOMPLETE_MISSING_CAUSAL_EVIDENCE`, `v6=null`
   and exits code 2, listing gaps, rather than advertising a fictional zero-call
   or winning strategy.
5. Labels REST bars as retrospective even with a matching SHA; this is
   exploratory, never Section 6 promotional acceptance.

## Work that remains before Manager review for promotion

1. Engine12 + PM furnish as-of authorization timestamps, input bar availability
   and verified Replay packets for Nov24 07:30–08:25 and Nov17–24 episodes.
   **No substituted current timestamps or postfacto historical bar finality.**
2. Claude's PR #390 currently omits the files named
   `data/snapshot_ids.json` and `data/bars_manifest.json` in its README.
   Engine3D requested their correction directly on PR #390.
3. Owner handles market-data licensing/any new recording separately;
   no recording was activated here.
4. Run exact v6 Nov24 fixture result and an identical-window 128-call vs v6
   count/R comparator, with and without the +15.24R outlier.
5. Review PR #389 exact-head CI, downstream consumer contract, Engine26 live
   persistent authorization clock and source attestation. **No merge/deploy
   unless the Manager and owner separately authorize it.**

This branch is an isolated shadow engineering/research candidate only. v5 remains canonical.
