# Engine 27 V3 — Submicro Degree Architecture

Manager-approved architecture change dated 2026-10-11.

## Locked structural hierarchy

The Elliott structure now has seven tracked structural wavelengths:

1. Submicro
2. Micro
3. Subminute
4. Minute
5. Minor
6. Intermediate
7. Primary

Micro and Submicro are separate. The fast blue intraday sequence that had been labeled Micro is being reclassified as Submicro.

## Trading accounts remain six

There is no seventh brokerage strategy account.

| Strategy account | Planned structural owner | Immediate parent context |
| --- | --- | --- |
| INTRADAY | Submicro | Micro |
| SUBMINUTE | Subminute | Minute |
| MINUTE | Minute | Minor |
| MINOR | Minor | Intermediate |
| INTERMEDIATE | Intermediate | Primary |
| PRIMARY | Primary | none |

The existing capital plan remains unchanged.

## Migration rule

Engine 27 V2 remains frozen during migration.

The new additive V3 contract is:

`snapshot.engine27Strategies.engine27TraderIntelligenceV3`

V3 reclassifies the existing fast intraday sequence from the legacy Micro presentation to Submicro without recalculating any structural prices.

The true parent Micro structure is not yet published in V3. It must be mapped and published by Engine 22 before V3 can become authoritative for all seven degrees.

Until then:

- V2 remains the production frontend contract.
- Strategy-account routing remains unchanged.
- Engine 13 Micro alerts remain unchanged.
- No account owner is migrated.
- No permission, sizing, management, execution, or journal authority changes.
- No structural price is invented.

## Ownership

- Engine 22 owns all Elliott wave counts, anchors, structural Fibonacci prices, lifecycle, confirmation, failure, and invalidation.
- Engine 27 owns read-only trader interpretation and presentation.
- Engine 2B owns read-only chart rendering.
- Engine 9 remains management authority.

## Acceptance gates before routing INTRADAY to Submicro

1. Engine 22 publishes the true Micro parent structure.
2. Submicro -> Micro -> Subminute nesting is numerically and visually accepted.
3. Replay proves source identity/freshness and live/replay equivalence.
4. Engine 27 V3 frontend is reviewed.
5. Engine 10 entry-context capture includes the accepted seven-degree hierarchy.
6. Engine 13 alert semantics are migrated deliberately.
7. Manager explicitly approves account-routing migration.

No silent migration is permitted.
