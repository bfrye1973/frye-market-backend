import { captureReceipt,verifyReceipt } from '../sourceObservationsV2/evidence.js';
import { proposeHistoricalIdentity } from '../acceptanceResearchV1/historicalBindingProposal.js';
import { hash } from '../acceptanceResearchV1/eligibility.js';
export function createHistoricalEvidenceTier({contract,metadataReceipt,originalUnresolvedReferences=[],expiryEvidence=null}){
 const receipt=verifyReceipt(metadataReceipt);if(receipt.httpStatus!==200||receipt.parseFailure||receipt.nextUrl)throw new Error('METADATA_EVIDENCE_INCOMPLETE');
 const records=receipt.observations.filter(x=>x.payload?.product_code==='ES'&&x.payload.trading_venue==='XCME'&&(x.payload.ticker===contract||x.payload.ticker==='ES'+contract[2]+contract.slice(-1)));
 if(records.length!==1)throw new Error('METADATA_IDENTITY_AMBIGUOUS');
 if(!Array.isArray(originalUnresolvedReferences)||originalUnresolvedReferences.some(x=>!x.observationId||!x.receiptId||x.identityState!=='UNRESOLVED'))throw new Error('ORIGINAL_UNRESOLVED_REFERENCE_REQUIRED');
 const proposed=proposeHistoricalIdentity({contract,metadata:records[0].payload,receiptId:receipt.receiptId,metadataObservedAt:receipt.observedAt,officialExpiryEvidence:expiryEvidence});
 const tier={schemaVersion:'engine11.historical-identity-evidence.research.v1',contract,proposedInstrumentId:proposed.proposedInstrumentId,providerTicker:proposed.providerTicker,
  firstTradeDate:proposed.firstTradeDate,lastTradeDate:proposed.lastTradeDate,settlementDate:proposed.settlementDate,
  metadataReceiptId:receipt.receiptId,metadataObservationId:records[0].observationId,metadataRowDigest:records[0].rowDigest,metadataBodySha256:receipt.bodySha256,
  originalUnresolvedReferences:structuredClone(originalUnresolvedReferences),expiryEvidence:expiryEvidence?structuredClone(expiryEvidence):null,
  confidence:proposed.state==='CORROBORATED_PROPOSAL_AWAITING_MANAGER'?'INDEPENDENT_EXPIRY_CLAIM_SUPPLIED_REQUIRES_REVIEW':'PROVIDER_LIFESPAN_ONLY',
  corroborationState:proposed.state,originalV2IdentityChanged:false,acceptedBinding:false,canonicalEligibility:false,structuralEligible:false,policyApproval:'ADDITIVE_RESEARCH_TIER_ONLY',sourceAcceptance:'PENDING_SEPARATE_GATE'};
 return {...tier,evidenceTierId:'historical-evidence-tier:'+hash(tier)};
}
export function tierFromFinalityMetadata({contract,receipt,originalUnresolvedReferences=[]}){
 const source=captureReceipt({request:receipt.request,body:Buffer.from(receipt.bodyBase64,'base64'),captureId:receipt.captureId,page:receipt.page,observedAt:receipt.observedAt,httpStatus:receipt.httpStatus});
 return createHistoricalEvidenceTier({contract,metadataReceipt:source,originalUnresolvedReferences});
}
export function appendEvidenceTier(ledger,tier){
 if(tier?.schemaVersion!=='engine11.historical-identity-evidence.research.v1'||tier.evidenceTierId!=='historical-evidence-tier:'+hash(Object.fromEntries(Object.entries(tier).filter(([k])=>k!=='evidenceTierId'))))throw new Error('EVIDENCE_TIER_TAMPER');
 if(!Array.isArray(ledger))throw new Error('IMMUTABLE_LEDGER_REQUIRED');
 const prior=ledger.find(x=>x.evidenceTierId===tier.evidenceTierId);return prior?structuredClone(ledger):[...structuredClone(ledger),structuredClone(tier)];
}
