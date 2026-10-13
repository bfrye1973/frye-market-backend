# Engine 11 — final consolidated compatibility handoff V1

October 13, 2026. Recipient: Engine 2B Lead Manager. Authority: PR #125 comment 6152722880. This is one bounded research handoff and Engine 22 decision packet. No chart implementation, source eligibility promotion, structural reinterpretation, private transfer, merge or deploy.

## Outcome

The 11:52 Phoenix capture establishes the exact source of the published authority-conflict flag, preserves the differing legacy/display publications and confirms the current chart resolver. It does **not** select a canonical Elliott count or certify a Fib model. Historical source acceptance remains independent of the chart preview and remains held. Engine 2B can coordinate the decisions below without additional historical infrastructure work.

## Current deployed code and dated capture

Connected Render before/after inspection:

| Service | Deployed SHA | Relevant fact |
|---|---|---|
| Core `srv-d2ds5nodl3ps73b7i2og` | `0b732012b11341e9a2484a8ca407c3d202863c41` | Live since October 13 18:47:05Z / 11:47:05 Phoenix; teammate PR #126 changed Minute V3 owner shadow to W3, with official/legacy Fibs unchanged |
| Preview API `srv-db5hk3942hec7390imu0` | `a047f02b38d800fd5015f9a326fa0b6c656ccf97` | Live isolated preview server; no trading watcher and no candle route |

Render core SHA was the same before and after the capture. This identifies deployed code, not an atomic runtime-file revision or approved count certificate. No Engine 11 deployment occurred. The preview branch's current adapter differed from its deployed revision; the deployed SHA is the relevant reference.

Capture implementation SHA `1536f88ddea8b33325ce8b93a48c7125bebc4092`, successful Actions run **38450270322**, artifact **11839039553**, ZIP SHA `13e9e89e208977bc213184adb7aa4c92274347ff977babdcb006a6ae3e361fa0`.

| GET | Observed UTC / Phoenix | Status | Body SHA-256 |
|---|---|---:|---|
| Core dashboard snapshot, includeContext=1 | 18:52:34.398 / 11:52:34.398 | 200 | `83b4565a402362637fbb2353da2c0df8dbc9f9a09d3d0e0bb9e3926cac52e06f` |
| Exact preview upstream dashboard snapshot, without includeContext | 18:52:35.576 / 11:52:35.576 | 200 | `83b4565a402362637fbb2353da2c0df8dbc9f9a09d3d0e0bb9e3926cac52e06f` |
| Preview chart-overlays/v1 | 18:52:51.680 / 11:52:51.680 | 200 | `62d1730d7735af8eef5e4159eeec335e52507dc9615a15234e2702dbae39046b` |
| Core futures/ohlc, ES, 10m, limit=3, debug=1 | 18:52:52.086 / 11:52:52.086 | 200 | `e6a317907d70d1055c1af8a49835870e301ca11db405e08ba43586f26ca92995` |

The two snapshot bodies match exactly in this capture. The overlay has an independent cached fetch; it does not emit an upstream full snapshot hash or complete count revision. We do not claim all four responses form an atomic as-of snapshot. Full dashboard/accounts/journal bodies were not archived; only selected Engine 22 structures, overlay payload and three-bar resolver evidence are retained in `evidence/engine11-final-compatibility-v1.json`.

Annotation revision 2 corrects the research timestamp classifier to exclude candidate price fields and `timeframe` labels. This is a derived annotation correction, not a provider/source-record correction. Original selected owner values and HTTP-body hashes remain unchanged. Regression test added; no unchanged external probe repeated.

## Exact paths, source identity and conflicts

Root: `strategies["intraday_scalp@10m"].engine22WaveStrategy`.

| Publication | Observed content | Eligibility |
|---|---|---|
| `degreeStates.minute` | activeWave W2, stage MINUTE_W2_ABC_PULLBACK_ACTIVE_C_DOWN_WATCH; activeFibModel inactive | Candidate legacy publication; owner approval/count/basis UNKNOWN |
| `currentWavelength.degrees.minute` | activeWave W3 | Different display publication; not automatically approved in place of legacy |
| `degreeStates.subminute` | SUBMINUTE_TIMING_CONTEXT_INSIDE_MINUTE_W2_C_DOWN; inactive Fib | Does not supply a replacement approved Subminute model |
| `currentWavelength.degrees.subminute` | activeWave W3 | Owner must specify intended authority/context and valid levels |
| `currentWavelength.degrees.micro` | W3_WATCH; published level list empty | Prior projected references cannot become current approved Fib |
| `degreeStates.intermediate.activeFibModel` | active extension ladder; values reproduce all ten emitted alias lines | Numeric match only; approved count identity and basis UNKNOWN |
| Primary / Minor legacy activeFibModel | inactive | Do not fill from historical target/correction models |
| Submicro in these two legacy/display collections | absent | Explicitly unavailable in this adapter contract; no substitute timeframe/source |

The overlay adapter at deployed SHA maps:

- `overlay.snapshot.authorityConflict` directly from `currentWavelength.canonicalWaveStateConflict`.
- Micro degree conflict from the same boolean, with currentWavelength as its source.
- Non-Micro active Fib lines from only `degreeStates[degree].activeFibModel` when active.
- Micro prior projected W1/W2 references separately as reference/context, not official current levels.

Observed source flag **true**, output flag **true**, `sourceMode:OVERRIDE_DISPLAY_INTELLIGENCE`; no explicit conflict reason field in the selected publication. The flag origin is proven; its structural resolution is reserved to Engine 22. Existing differences are not caused by Engine 11 candles or automatically by a provider defect.

Candidate Intermediate unique numeric values: 8369.50, 8903.25, 9582.25, 10332.00, 11544.75. The original alias keys are preserved. These are **not certified authoritative levels** by this handoff. Actual source path includes `.activeFibModel.levels.<key>` whereas emitted trace labels omit `.levels`; both paths are recorded without rewriting owner-controlled code.

`countId`, `sourceCountId`, full contract identity and price basis were null in the selected displayed degree publications. Overlay sourceCountId remains null. A Micro shadow canonical reference and hashed V3 branches do not fill those fields or supply approval. No node/anchor promotion occurs.

## Chart source and timestamp precision

The current core OHLC debug route returned ESZ6, ES root, native 10min resolution, three bars and `env_contract_override`. The short ticker and environment override do not independently certify ESZ2026 full-year lineage or compatibility with protected anchor prices. Existing production route normalization/deduplication and chart behavior are untouched.

The earlier preview 404 is explained by its actual deployed `services/core/preview/engine2bPreviewServer.js`: it mounts only `/api/health` and `/api/v1/engine2/chart-overlays/v1`. It fetches the core snapshot with a 15-second cache. It mounts no futures/ohlc route. Engine 2B owns confirming the chart's actual candle endpoint/proxy, route permissions and environment; Engine 11 did not add a route or repeat that unchanged failing request.

Overlay `ES_INDEX_POINTS` is a units label. Actual anchor/raw-versus-adjusted basis relative to the resolved contract remains UNKNOWN. Do not offset levels to fit a contract.

Captured original precision: 7 date-only values, 12 timezone-naive timestamp values and 3 numeric time fields. Original types/values and exact paths are retained; no inferred normalization. Example Minute W1 is `2026-09-23` (date only); Minute A is `2026-09-24 14:30` (timezone naive); Micro W1 confirmed bar time is numeric `1791525600`. The deployed adapter treats unzoned time-bearing strings as Phoenix -07:00 and emits integer Unix seconds; date-only inputs are unresolved rather than fabricated midnight. Engine 22 must confirm the applicable timezone/unit/precision contract, and Engine 2B must preserve approved precision and unresolved handling.

## Single Engine 22 Manager decision packet — route through Lead Manager

Please return a durable record ID, exact approved source payload/model hash, count/sequence identity and revision, and per-degree ruling. Do not accept a draft, visible level or shadow field as a certificate.

| Decision needed | Concrete evidence/question | Required owner response |
|---|---|---|
| Authority conflict | `currentWavelength.canonicalWaveStateConflict=true`; Minute legacy W2 versus display W3, differing Subminute context | Specify official source/count per degree and whether each displayed candidate is allowed, context-only or unavailable. Resolve or explicitly retain the conflict; no automatic preference between collections |
| Official count identity | Displayed degree sourceCountId/countId absent; Micro shadow reference exists | Provide complete approved identity/revision and authoritative source path, or declare unavailable. Shadow identifiers cannot be silently promoted |
| Price basis | Chart resolves ESZ6 via environment override; overlay says ES_INDEX_POINTS only | Certify original approved anchor/Fib basis and its permitted relation to this exact chart contract/series, or decline preview eligibility. No automatic adjustment/snapping |
| Valid levels | Only Intermediate legacy active model; Micro prior contexts; other active models absent/inactive | List permitted degree/model/level keys with exact prices and model hashes; identify reference-only values. Do not invent missing Fib levels |
| Time semantics | Date-only, naive Phoenix-convention strings and numeric times coexist | Confirm timezone and numeric units by field, retained precision and date-only policy. Intraday anchor times cannot be invented |
| Preview certificate scope | Payload lacks complete upstream revision binding and authority certificate | Approve a bounded source/count/basis-pinned preview contract or identify missing evidence. Engine 2B retains rendering acceptance |

Engine 11 requests no Elliott changes, new official Fibonacci calculations or formal ratification by proxy. Any previously unresolved formal Engine 22 Gate 1 ratification remains unverified; this packet does not assume it.

## Short Massive escalation questions — prepared, not sent

1. **Session assignment:** Explain ESH5 January 30, 2025 at 21:55:36 UTC: records 1738274136387378265 / 1738274136407828355 carry Jan30 / Jan31 labels. Which exchange/provider field assigns membership, and what evidence distinguishes legitimate fragments from corrected records?
2. **Calendar completeness:** Under existing entitlement, why are October 14, 2024, Jan30/31 and March 10, 2025 empty, Jan21 open-only, March18 close-only and eight holiday transitions ambiguous? Provide dated outright ES event semantics/coverage, maintenance/early-close interpretation and actual-versus-planned interruption evidence. Empty results are not closure proof.
3. **ESZ4 identity:** Supply independent full-year instrument/expiration/settlement corroboration for the preserved Dec20, 2024 metadata. `last_trade_date` is present; `settlement_date` is absent and must remain null.
4. **Finality/revisions:** Identify immutable completion/correction watermarks and supersession identifiers for each native interval, including session/week/month guards. Re-fetch equality and arithmetic reproduction are not finality certificates.
5. **Aggregate filters:** `session_end_date` is not documented as an aggregate query filter; both requested labels returned the same mixed 78 rows. Confirm supported filtering semantics without assuming a provider defect.

Reproduction index: `evidence/engine11-provider-request-ledger-v1.json`, original runs 38338605379 / 38339185603; unfiltered minute request ID `9dde8c2f0674bb1e0cf75ad05b4eddd9`, body SHA `f7d855f3c412c36a9daf8842ff9661357b4a0596925f386efbc3360df4cdf1c4`. Full approved wording remains `ENGINE11_PROVIDER_SUPPORT_INQUIRY_DRAFT_V1.md`. Lead Manager can route through an authorized private support channel. No email/support ticket sent, source purchase or provider plan change.

## Historical and storage conditions — unchanged evidence, no repeated probes

October 12, 2024 onward remains immediate priority; March 2020 work preserved/deferred. 276,604 authentic sampled observations across seven native frames are not exhaustive continuous acquisition. Fully verified canonical candles remain **0**. Calendar, contract, source finality, period guards and per-degree structural sufficiency are independent. Stable arithmetic does not override unresolved fields. ESZ2024 additive tier keeps settlement null and original V2 UNRESOLVED. No research output supplies engines or chart candles.

Named primary candidate remains owned Library `/Frye Dashboard 2`, folder ID `6a4ff35787748191b77c8aac9fc6884f`. Remaining capacity >=100MiB, private access matrix/custodian, retention/restore policy and provider rights are not verified. **No independently located private backup has been verified.** Sandbox/Actions copies do not qualify. Render Replay disk excluded. A second location must be named and verified by Lead Manager before destination approval/owner permission and actual transfer. No private bytes moved.

Original corpus artifact expires November 12 01:46:58Z / November 11 18:46:58 Phoenix. Earliest inventoried research artifact expires November 11 18:00:11 Phoenix. This is a deadline for preservation approval, not permission to use an unverified destination. Manifest, hashes and restore verification already exist; repeating unchanged capacity/source probes cannot close these external gates.

## Validation and acceptance boundary

350 automated tests: 342 inherited + 8 new comparison/precision tests. New tests preserve original structures/prices, exclude accounts/journals, keep candidate approval UNKNOWN, distinguish captures from corrections, trace the flag without interpreting Elliott authority, retain date-only/naive/numeric precision and exclude non-time fields. Authentic four GET capture succeeded separately; no browser rendering or T24–T27 execution is claimed.

Exact additive paths:

- `services/core/logic/engine11/finalCompatibilityResearchV1/comparePublications.js`
- `services/core/tests/engine11/finalCompatibilityResearch/{comparison.test,liveComparison}.mjs`
- `.github/workflows/engine11-final-compatibility.yml`
- This report and `docs/architecture/evidence/engine11-final-compatibility-v1.json`.

Protected #102/#106 modules, live routes/streamer/frontend, Elliott/Fib, execution/accounts/Journal/Replay/Engine26 are unchanged. No source acceptance, publication, adjusted series, cutover, merge or deploy.

Request Engine 2B **ACCEPT or REVISE** for this consolidated handoff, and coordination of the single Engine 22 decision packet and external evidence/storage gates. Chart preview work belongs to Engine 2B and need not wait for the two-year source system. T24–T27 (zoom/scroll, pinned paging, stale/live races, 25,000-bar memory, exact Fib/source/basis parity and independent rollback) remain its acceptance requirements.
