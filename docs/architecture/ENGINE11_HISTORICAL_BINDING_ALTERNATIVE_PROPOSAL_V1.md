# Engine 11 — Historical Contract Binding Alternative Proposal V1

**PROPOSAL ONLY — separate Engine 2B acceptance required.** Existing PR #102/#106 identity and metadata rules remain unchanged. ESZ2024 is still unaccepted.

## Purpose

The existing V2 identity requires a provider settlement_date matching the full expiration year/month. Authentic ESZ4 metadata omits that field, although its ticker, ES/XCME product and first/last trade dates are present. Substituting last_trade_date into settlement_date would misrepresent evidence. The alternative proposes a distinct historical-source identity tier that preserves the missing settlement field.

## Proposed versioned evidence tier

`engine11.historical-binding.PROPOSAL.v1` records full proposed contract `ESZ2024`, proposed instrument `CME:ES:2024-12`, original provider ticker, metadata receipt/time, firstTradeDate, lastTradeDate, **settlementDate:null**, independently sourced contract-specific expiry evidence (if obtained), policy version and deterministic proposal hash.

`LIFESPAN_CANDIDATE_OFFICIAL_EVIDENCE_MISSING` means only a provider lifespan candidate exists. `CORROBORATED_PROPOSAL_AWAITING_MANAGER` additionally requires a dated CME contract-specific expiry document, full matching contract/date, source URL and immutable body hash. Both remain acceptedBinding=false, sourceEligibility=false and structuralEligible=false. An expiry document does not manufacture a settlement date or price.

Reject a mismatched product/venue, malformed/reversed lifespan, wrong quarter/year, conflicting settlement field, mismatched short alias or evidence for another contract. ESZ4's reuse in 2034 cannot bind the 2024 lifespan. Do not extrapolate a quarterly expiry rule into an independently verified 2024 record.

After schema acceptance, any implementation still requires a separate namespace/evidence lookup. It must not overwrite existing V2 bindingVersion, sourceKey, sourceRevisionId, observation identity or preserved UNRESOLVED state. Proposed `historicalIdentityEvidenceRef` would coexist with the original unresolved V2 observation; canonical/source eligibility requires its own gate. No compatibility shim is installed by this prototype.

## Authentic current evidence and requested ruling

Provider observation: ESZ4 / ES / XCME; first trade 2021-06-04; last trade 2024-12-20; settlement absent. Exact metadata receipt: `finality-receipt:0a14953e0c405d0547f2cb2bab369348862ad20e11a714828e29c4afeba0a218`, observed 2026-10-13T02:48:03.661Z. Other dated probes and direct CME retrieval failures are preserved in PR #114.

No accessible dated contract-specific CME expiry/settlement document has been obtained. Current CME HTML gives 2025 onward roll/expiry rows, which cannot verify the December 2024 contract. The proposal documents an alternative for review without declaring that missing source evidence resolved.

Engine 2B should ACCEPT or REVISE the alternate tier/schema and identify the authoritative corroboration source. Acceptance of the proposal is not approval to retrofit protected V2 modules or supply canonical candles. Independent regressions verify alias-year isolation, preserved null settlement, conflicting-field rejection and continued ineligibility even when synthetic official evidence is supplied.
