# Engine 25 — October 29, 2026 at 08:00 Arizona historical acceptance

**Gate:** ENGINE25_REPLAY_TECHNICAL_ACCEPTANCE_PASS (research only)  
**Historical cutoff:** `2026-10-29T15:00:00.000Z` (08:00 America/Phoenix)  
**PR:** [#232](https://github.com/bfrye1973/frye-market-backend/pull/232) — draft, no merge/deploy authorization  
**Acceptance workflow:** [run 41246517960](https://github.com/bfrye1973/frye-market-backend/actions/runs/41246517960), success, 2026-10-31 22:05 UTC  
**Acceptance source SHA:** `1e67f0e56138af7db41458fd26f6652f8c5f30ab`  
**Evidence artifact:** `engine25-oct29-0800-acceptance` (artifact ID `13058608825`, attached to workflow run; archived source JSONs and final packet)  
**CI:** [run 41246522709](https://github.com/bfrye1973/frye-market-backend/actions/runs/41246522709), success

## Reconstructed 08:00 trade-permission *research* result

| Component | 08:00 estimate | Provenance |
|---|---:|---|
| ES Master V2 | **37.80**, bear | `RETROSPECTIVE_RECONSTRUCTION`; only completed ESZ6 bars |
| ES standalone 4H light | **42.45**, bear | `RETROSPECTIVE_RECONSTRUCTION`; last ES 4H window completed by cutoff |
| Reconstructed EOD | **50.10**, MIXED | `RETROSPECTIVE_RECONSTRUCTION`; Oct 28 equity session only |
| **65/20/15 shadow score** | **40.58**, `BEARISH_SHORTS_FAVORED` | **RETROSPECTIVE_ESTIMATE_ONLY** |

Calculation: `37.80 × 0.65 + 42.45 × 0.20 + 50.10 × 0.15 = 40.575` (rounded to `40.58`).

**Interpretation restriction:** This is **not** proof the combined 40.58 score or a warning was published, displayed, sent, or available to the owner at 08:00 October 29. It is a retrospective calculation from bars/events that had completed before the cutoff using provisional, uncalibrated weights. Do not rewrite trade history to treat this score as an actual contemporaneous decision signal.

## Originally published Engine 25 equity evidence available before the cutoff

Commit history establishes two equity publications **before 15:00 UTC**, independently of this reconstruction:

- **1H:** [commit `72dee4f`](https://github.com/bfrye1973/frye-market-backend/commit/72dee4fa10c071b298050bc6abc7cb45a88d70b7), committed **14:07:20 UTC**; source updated **14:07:17 UTC**; 1H overall **43.64, bear**, breadth **71.46**, momentum **73.02**, bearish SMI **23.12**.
- **Equity 4H:** [commit `70fc08c`](https://github.com/bfrye1973/frye-market-backend/commit/70fc08c71686bd7e0480512dd6e999b8dc92d23c), committed **14:09:52 UTC**; source updated **14:09:51 UTC**; 4H overall **52.00, neutral**, breadth **79.26**, momentum **72.52**. Timing reasons included a 4H EMA10 decision zone and cooling SMI.

These archived 1H/4H equity readings are **not the same series** as the ES standalone 4H research light above. They demonstrate why strong stock internals can coexist with a bearish short-term market trend. Whether the owner actually saw an alert is not verified.

## Data coverage / limitations

- EOD reconstruction processed **33 weekday sessions** from grouped historical stock aggregates ending October 28, 2026, with **4,740/5,470 symbols (86.65%)** meeting the required 22-bar history and final-session test. Failed/missing symbols were excluded and coverage was published; no zero-filled stock scores were invented. Sector universe files may reflect later constituents (**survivorship bias**).
- The previous historical EOD job was canceled after 30 minutes and emitted zeroes because a literal backslash preceded the Polygon Actions secret. The isolated branch now corrects that workflow input and replaces per-symbol REST requests with completed-session grouped aggregates. This acceptance run finished all steps successfully.
- The pre-08:00 original 10-minute fast-participation archive is **not authenticated**: `SOURCE_10M_UNAVAILABLE` / `FAST_PARTICIPATION_ARCHIVE_UNAVAILABLE`. Never fabricate it, and do not confuse retro ES 10m OHLC with originally published equity 10m participation.
- Engine 22 original 07:00–12:00 wave states are **not yet authenticated**: `ENGINE22_HISTORICAL_STATE_NOT_VERIFIED`. No historical D UP or October 31 wave model is substituted.
- The exact broker timestamps of all MES entries are **not verified against this cutoff**. The 08:00 replay cannot be called a **pre-entry** warning for a trade that actually filled earlier than 08:00. Reconcile each broker fill before any entry-time conclusion.
- No source from the October 29 cash equity session was used for reconstructed EOD. The 10/28 source timestamp represents session completion, **not the date the reconstruction was published**.
- A numeric retrospective score is allowed only with required source timestamps, provenance, completed 4H bar and valid prior completed EOD session. Otherwise the code fails closed with `score=null / INSUFFICIENT_DATA`.
- New read-only route rejects `?asOf=` rather than querying live data and relabeling it historical. Existing Engine 25 formulas, Engine 22 counts, Engine 27 behavior and trading/broker permissions are unchanged.

## Acceptance checks passed

Exact 65/20/15 formula; required-input fail-closed behavior; missing/invalid historical timestamp rejection; inconsistent provenance rejection; incomplete/unverifiable 4H rejection; same-day EOD rejection; unchanged provisional thresholds; cutoff limits for all required research inputs; original-publication status explicitly false for reconstructed EOD; missing 10m warning; Engine 22 historical state remains unverified; research artifacts uploaded.

**Gate boundary:** Engine 25 historical **technical** replay is accepted. Cross-engine historical conclusions and production/integration approval remain **HOLD** pending authenticated Engine 22 original publications, exact broker fill timing and separate owner approval.
