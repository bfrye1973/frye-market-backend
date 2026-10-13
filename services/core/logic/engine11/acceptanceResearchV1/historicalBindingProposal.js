import { hash } from './eligibility.js';
const months={H:3,M:6,U:9,Z:12};
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function proposeHistoricalIdentity({contract,metadata,receiptId,metadataObservedAt,officialExpiryEvidence=null}){
 const match=/^ES([HMUZ])(\d{4})$/.exec(contract);if(!match||!receiptId||!Number.isFinite(Date.parse(metadataObservedAt)))throw new Error('PROPOSAL_CONTEXT');
 const year=Number(match[2]),month=months[match[1]],alias='ES'+match[1]+match[2].slice(-1);
 if(metadata.ticker!==alias&&metadata.ticker!==contract)throw new Error('ALIAS_MISMATCH');
 if(metadata.product_code!=='ES'||metadata.trading_venue!=='XCME'||!validDate(metadata.first_trade_date)||!validDate(metadata.last_trade_date)||metadata.first_trade_date>metadata.last_trade_date||metadata.last_trade_date.slice(0,7)!==`${year}-${String(month).padStart(2,'0')}`)throw new Error('LIFESPAN_CONFLICT');
 if(metadata.settlement_date!==undefined&&metadata.settlement_date!==null&&(!validDate(metadata.settlement_date)||metadata.settlement_date.slice(0,7)!==`${year}-${String(month).padStart(2,'0')}`))throw new Error('SETTLEMENT_CONFLICT');
 const corroborated=officialExpiryEvidence?.kind==='CME_CONTRACT_SPECIFIC_EXPIRY_RECORD'&&officialExpiryEvidence.contract===contract&&officialExpiryEvidence.expiryDate===metadata.last_trade_date&&/^https:\/\/(?:www\.)?cmegroup\.com\//.test(officialExpiryEvidence.url??'')&&/^[a-f0-9]{64}$/.test(officialExpiryEvidence.bodySha256??'')&&validDate(officialExpiryEvidence.publicationDate);
 const result={schemaVersion:'engine11.historical-binding.PROPOSAL.v1',policyVersion:'SOURCE_LIFESPAN_PLUS_INDEPENDENT_EXPIRY_PROPOSAL_V1',contract,proposedInstrumentId:`CME:ES:${year}-${String(month).padStart(2,'0')}`,providerTicker:metadata.ticker,firstTradeDate:metadata.first_trade_date,lastTradeDate:metadata.last_trade_date,settlementDate:metadata.settlement_date??null,metadataReceiptId:receiptId,metadataObservedAt,
  officialExpiryEvidence,state:corroborated?'CORROBORATED_PROPOSAL_AWAITING_MANAGER':'LIFESPAN_CANDIDATE_OFFICIAL_EVIDENCE_MISSING',acceptedBinding:false,sourceEligibility:false,structuralEligible:false,requiresSeparateManagerApproval:true};
 return {...result,proposalId:'historical-binding-proposal:'+hash(result)};
}
