# Engine 27 V3 — Micro-first isolated development
Read-only shadow architecture. No production wiring, no order permissions, no changes to Engine 22 or V2.
Module 27.1 is a fail-closed scaffold, not yet accepted as a canonical Engine 22 adapter. Level ordering, freshness windows, owner identity and confirmation rules must be audited before claiming next objectives or confirmed holds/failures.
Run isolated tests from services/core with: node --test logic/engine27/v3/tests/priceActionFib.test.js
Planned modules: manager, priceActionFib, neighboringAlignment, marketConfirmation, positionIntelligence, entryThesisMemory, historicalValidation, contracts, tests.
