# Engine 27 V2 — Compatibility Matrix

Status: additive implementation only. Existing Engine 27A–27E contracts remain frozen.

| V2 field | Canonical owner | Current production source | Existing Engine 27 field | Trading consumer risk | V2 treatment |
|---|---|---|---|---|---|
| Active Wave | Engine 22 | `engine22WaveStrategy.currentWavelength.degrees[*].activeWave` when published; otherwise `engine22Display` / `degreeStates` | `engine27WaveIntelligence[*].currentWave` | Medium | Read-only presentation; do not replace A yet |
| Wave Direction | Engine 22 | `engine22Display.degrees[*].direction` / `degreeStates[*].direction` | `engine27WaveIntelligence[*].currentLegDirection` and structural direction fields | High | Display separately from Strategy 1 direction |
| Current Condition | Engine 22 | Micro completion state / current wavelength state / published degree stage | `engine27WaveIntelligence[*].stage`, maturity | Medium | Preserve Engine 22 wording/state; never promote candidate to confirmed |
| Potential Completion | Engine 22 | `currentWavelength.degrees[*].levels` / `engine22Display.degrees[*].levels` | `engine27FibIntelligence[*]` | Medium | Read-only display of Engine 22 published levels |
| Confirmation Needed | Engine 22 | `confirmationStatus`, `confirmationRule`, `confirmationNote`, Micro 5m evidence | Distributed across A/B/D/E | High | Separate from Fib destination |
| Invalidation | Engine 22 | current wavelength invalidation / degree internal invalidation / display invalidation row | `engine27WaveIntelligence[*].invalidationLevel` | Medium | Read-only structural invalidation |
| Parent Context | Engine 22 | `degreeStates[*].parentDegree/parentWave` / published display parent row | 27A parent degree/wave + 27C compatibility | Medium | Explain only; no new parent count |
| Trader Read | Engine 27 V2 | Explanation of Engine 22 facts | 27D story / 27E action | Low if read-only | New additive presentation language |
| Structural Source | Engine 22 | source path used by V2 | none unified | None | New provenance field |
| Confirmation Status | Engine 22 | current wavelength / completion state | none unified | High | New provenance field; exact published status |
| Evidence Freshness | Engine 22 / snapshot | evidence source timestamp or snapshot timestamp | none unified | None | New provenance field |
| Strategy 1 Direction | Engine 26A / trading chain | `engine26LocationCandidate.currentObservationDirection/direction` | 27E Minute direction may mirror | High | Minute-only readiness section; never derived from wave direction |
| Expected Reversal | Engine 26A / E3/E4 observation | candidate expected reversal, then reaction/participation observation | not canonical Elliott field | High | Watch-only label |
| E3 Reaction | Engine 3 | `confluence.context.reaction.paperScalpReaction` | 27E readiness mirror | High | Display only |
| E4 Participation | Engine 4 | `confluence.context.volume.engine4AuthorizedReactionParticipation` | 27E readiness mirror | High | Display only |
| E6 Permission | Engine 6 | `permission.paper` | 27E readiness mirror | Critical | Display only; never created by V2 |
| E26B Geometry | Engine 26B | `engine26ProposedGeometry` | 27E planner mirror | Critical | Display only |

## Six-degree coexistence rule

Current production Engine 27A–27E remains five-degree:

`Subminute → Minute → Minor → Intermediate → Primary`

Engine 27 V2 adds Micro only inside the new additive presentation contract:

`Micro → Subminute → Minute → Minor → Intermediate → Primary`

No existing five-degree field is renamed, removed, retyped, or repurposed.

## Protected production contracts

The V2 implementation must not alter:

- `engine27WaveIntelligence`
- `engine27FibIntelligence`
- `engine27Alignment`
- `engine27MarketStory`
- `engine27TraderDecision`
- Engine 26 candidate identity or location
- Engine 26B geometry
- Engine 3 reaction truth
- Engine 4 participation truth
- Engine 6 permission
- Engine 7 sizing
- Engine 9 management
- Engine 8 execution
- Engine 10 journal

## Acceptance invariant

A change in Engine 27 V2 narrative must not change candidate identity, Strategy 1 direction, Engine 6 permission, or Engine 8 execution.
