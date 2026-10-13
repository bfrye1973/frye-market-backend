import { hash,instant,requireTruth,validateProviderAlias } from '../rawCandles/identity.js';
import { verifyReceipt,freeze } from '../sourceObservationsV2/evidence.js';
import { validDate,validateRegistry,researchFlags } from './registry.js';
export function historicalBindingCandidate({contract,ticker,metadataReceipt,expiryCorroboration=null,registry=null,asOf}) {
 const c=validateProviderAlias(contract,ticker),receipt=verifyReceipt(metadataReceipt);instant(asOf);
 requireTruth(instant(asOf)>=instant(receipt.observedAt),'BINDING_ASOF_BEFORE_EVIDENCE');
 const url=new URL(receipt.request),date=url.searchParams.get('date');validDate(date);
 const records=receipt.observations.filter(o=>o.payload?.ticker===ticker&&o.payload.product_code==='ES'&&o.payload.trading_venue==='XCME');
 const base={schemaVersion:'engine11.historical-binding-candidate.v1',method:'PROVIDER_LAST_TRADE_MONTH_YEAR_WITH_LIFESPAN',contract:c.contract,instrumentId:c.instrumentId,ticker,
  metadataReceiptId:receipt.receiptId,metadataEvidenceKind:receipt.evidenceKind,queryDate:date,settlementDate:null,...researchFlags};
 const unresolved=(reason,extra={})=>freeze({...base,...extra,state:'UNRESOLVED',reason,bindingAccepted:false});
 if(url.pathname!=='/futures/v1/contracts'||receipt.httpStatus!==200||receipt.providerStatus!=='OK'||receipt.parseFailure||receipt.nextUrl)return unresolved('INCOMPLETE_METADATA_EVIDENCE');
 if(records.length!==1)return unresolved('AMBIGUOUS_OR_MISSING_METADATA');
 const record=records[0].payload;let first,last;
 try{first=validDate(record.first_trade_date);last=validDate(record.last_trade_date);}catch{return unresolved('MISSING_VALID_LIFESPAN');}
 const details={firstTradeDate:first,lastTradeDate:last,metadataObservationId:records[0].observationId,settlementDate:record.settlement_date??null};
 if(record.date!==date||record.active!==true||first>date||last<date||first>last||last.slice(0,7)!==`${c.expirationYear}-${String(c.expirationMonth).padStart(2,'0')}`)return unresolved('LIFESPAN_OR_DATE_IDENTITY_CONFLICT',details);
 if(!expiryCorroboration||!registry)return unresolved('INDEPENDENT_EXPIRY_CORROBORATION_REQUIRED',details);
 const r=validateRegistry(registry);const proof=expiryCorroboration,doc=r.documents.find(d=>d.documentId===proof.documentId);
 if(!doc||doc.review.state!=='RESEARCH_REVIEWED'||proof.contract!==contract||proof.lastTradeDate!==last||proof.state!=='INDEPENDENT_EXPIRY_RESEARCH_REVIEWED'||typeof proof.section!=='string'||!proof.section.length)return unresolved('EXPIRY_PROOF_MISMATCH',details);
 if(!['DATED_EXPIRY','FIXTURE'].includes(doc.review.coverageType)||doc.review.effectiveFrom>last||doc.review.effectiveThrough<last)return unresolved('DATED_EXPIRY_SCOPE_REQUIRED',details);
 if(instant(asOf)<instant(r.knowledgeAsOf))return unresolved('EXPIRY_PROOF_AFTER_ASOF',details);
 const value={...base,...details,expiryCorroboration:proof,calendarEvidenceVersion:r.calendarVersion,state:'CORROBORATED_RESEARCH_BINDING_CANDIDATE',bindingAccepted:false};
 return freeze({...value,candidateVersion:'binding-candidate:v1:'+hash(value)});
}
