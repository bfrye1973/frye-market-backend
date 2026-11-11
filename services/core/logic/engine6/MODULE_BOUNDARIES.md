# Engine 6 modular boundaries — scaffolding only

No production integration or authority change. Current owner functions stay in place.

| Folder | Present interface | Later extraction (separate authorization) |
| --- | --- | --- |
| 6a-trade-qualification | Re-export existing Phase 4 evaluator and Engine 3 qualification resolver | Move Phase 4 helper from strategy1PermissionContract.js |
| 6b-market-intelligence | Re-export existing read-only zone rotation evaluator | Relocate buildZoneRotationContext.js without changes |
| 6c-trade-decision | Re-export existing read-only decision evaluator | Relocate evaluateZoneRotationDecision.js without changes |
| 6d-paper-permission | Immutable interface-only declaration, NO GO capability | Move buildEngine6PaperPermission, buildFinalPermissionFromEngine15 fast-lane assembly, rememberEngine6ApprovedPaperPermission, applyEngine6ApprovedPaperPermissionLock from buildStrategySnapshot.js after a separate manager-reviewed diff |

Data order (future only): 6A qualification + 6B owner context → 6C advisory classification → 6D PAPER authority. Engine 27 package never feeds 6B. Engine 7/8/9 unchanged.

The existing snapshot builder and all existing live import paths remain untouched. REDUCE is not activated. No new thresholds.
