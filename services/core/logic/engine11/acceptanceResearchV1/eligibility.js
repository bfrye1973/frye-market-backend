import { createHash } from 'node:crypto';
export const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export const frames={'5m':300000,'10m':600000,'1h':3600000,'4h':14400000,'1d':null,'1w':null,'1mo':null};
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export function classifyObservation({row,timeframe,contract,bindingState,receipt,calendarState='UNAPPROVED',alignmentState='UNAPPROVED',sourceFinality='UNKNOWN',collision=false,periodConstituents=false,evidenceTier='AUTHENTIC',priceBasis='RAW_CONTRACT'}){
 if(!Object.hasOwn(frames,timeframe)||!['AUTHENTIC','FIXTURE'].includes(evidenceTier))throw new Error('UNSUPPORTED_FRAME_OR_EVIDENCE');
 const reasons=[];const value={schemaVersion:'engine11.eligibility-research.v1',evidenceTier,contract,timeframe,priceBasis,state:'UNKNOWN',reasons,structuralEligible:false,publishedCanonical:false};
 const ns=typeof row.window_start==='string'&&/^\d+$/.test(row.window_start)?BigInt(row.window_start):null;
 const goodPrice=[row.open,row.high,row.low,row.close].every(x=>Number.isFinite(x)&&x>0&&Math.abs(x*4-Math.round(x*4))<1e-7);
 if(ns===null||!goodPrice||row.low>Math.min(row.open,row.close)||row.high<Math.max(row.open,row.close)||row.low>row.high||!Number.isSafeInteger(row.volume)||row.volume<0||!validDate(row.session_end_date))reasons.push('MALFORMED_SOURCE_ROW');
 if(priceBasis!=='RAW_CONTRACT')reasons.push('UNAUTHORIZED_PRICE_BASIS');
 if(!/^ES[HMUZ]\d{4}$/.test(contract)||![contract,'ES'+contract?.[2]+contract?.slice(-1)].includes(row.ticker))reasons.push('INCOMPLETE_CONTRACT_IDENTITY');
 if(collision)reasons.push('SESSION_BUCKET_MAPPING_UNRESOLVED');
 if(reasons.length){value.state='QUARANTINED';return value;}
 if(bindingState!=='MATCHED_EXISTING_V2_RESEARCH')reasons.push('FULL_YEAR_BINDING_UNACCEPTED');
 if(!receipt?.receiptId||!/^[a-f0-9]{64}$/.test(receipt.bodySha256??'')||!Number.isFinite(Date.parse(receipt.observedAt)))reasons.push('RECEIPT_PROVENANCE_UNAVAILABLE');
 if(calendarState!=='ACCEPTED_RESEARCH_INPUT')reasons.push('CALENDAR_UNAPPROVED');
 if(alignmentState!=='ACCEPTED_RESEARCH_INPUT')reasons.push('ALIGNMENT_UNAPPROVED');
 if(sourceFinality!=='EXPLICIT_SCOPED_COMPLETENESS_EVIDENCE')reasons.push('SOURCE_FINALITY_UNKNOWN');
 if(!frames[timeframe]&&!periodConstituents)reasons.push('PERIOD_CONSTITUENTS_UNVERIFIED');
 if(frames[timeframe]&&receipt?.observedAt){const end=ns+BigInt(frames[timeframe])*1000000n;if(end>BigInt(Date.parse(receipt.observedAt))*1000000n){reasons.push('PARTIAL_SOURCE_CLOCK_WINDOW');value.state='PROVISIONAL';}}
 if(!reasons.length)value.state='COMPLETE';
 // COMPLETE means supplied research conditions are accounted for, never source/structure authorization.
 return value;
}
export function compareParent({parent,children,stepNs,fromNs,toNs}){
 const start=BigInt(parent.window_start),end=start+BigInt(stepNs);if(start<BigInt(fromNs)||end>BigInt(toNs))return {state:'UNKNOWN_GUARD_EDGE',childCount:0};
 const rows=children.filter(x=>x.ticker===parent.ticker&&x.session_end_date===parent.session_end_date&&BigInt(x.window_start)>=start&&BigInt(x.window_start)<end).sort((a,b)=>BigInt(a.window_start)<BigInt(b.window_start)?-1:1);
 if(!rows.length)return {state:'UNKNOWN_CHILD_ABSENCE',childCount:0};if(new Set(rows.map(x=>x.window_start)).size!==rows.length)return {state:'QUARANTINED_CHILD_IDENTITIES',childCount:rows.length};
 const derived={open:rows[0].open,high:Math.max(...rows.map(x=>x.high)),low:Math.min(...rows.map(x=>x.low)),close:rows.at(-1).close,volume:rows.reduce((n,x)=>n+x.volume,0),transactions:rows.reduce((n,x)=>n+x.transactions,0)};
 return {state:Object.keys(derived).every(k=>derived[k]===parent[k])?'OBSERVED_PARENT_PARITY_ONLY':'UNKNOWN_SNAPSHOT_PARITY',childCount:rows.length};
}
