# Engine 27 V3 — Module 27.2 neighboring alignment handoff
Module status: isolated implementation, source contract verified in GitHub, no production wiring. No structural invalidation is ever inferred from opposite wave direction.

Files added:
- contracts/neighboringAlignment.v1.js — engine27.v3.neighboringAlignment.v1.
- neighboringAlignment/evaluateNeighboringAlignment.js — version-specific Engine22 Micro/Submicro/Subminute source selector and parent-wave compatibility.
- tests/neighboringAlignment.test.js — nine normal, opposing-direction, unavailable and mismatch tests.
- .github/workflows/engine27-v3-micro-isolated.yml — expanded isolated CI.

Canonical input: snapshot.strategies['intraday_scalp@10m'].engine22WaveStrategy.currentWavelength.degrees[degree].owner... contract. Micro parentDegree=subminute, Submicro parentDegree=micro, Subminute parentDegree=minute. Opposite directions are CORRECTIVE_MIXED_DIRECTION, not invalidation.

States: UNAVAILABLE, STRUCTURALLY_COMPATIBLE, CORRECTIVE_MIXED_DIRECTION, PARENT_IDENTITY_CONFLICT, NEIGHBOR_EVIDENCE_INCOMPLETE. PARENT_IDENTITY_CONFLICT means owner linkage mismatch, NOT verified structural invalidation. structuralConflictConfirmed always false until Engine22 independently publishes binding structural invalidation confirmation.

No changes to Engine22, existing Engine27, Engine6, Engine8, Engine9, Engine10, front-end or production. Missing dependency: authoritative Engine22 verified failure/reversal lifecycle event for genuine thesis-break conclusion. That belongs to Modules 27.2+27.5 integration, not a fallback inferred from directions.
