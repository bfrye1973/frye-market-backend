import {createHash} from 'node:crypto';
import {captureReceipt} from '../sourceObservationsV2/evidence.js';
import {cumulativeAdjustment} from '../nodeReconciliationResearchV1/reconcile.js';
export const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export const RESOLUTIONS={'5min':'5m','10min':'10m','1hour':'1h','4hour':'4h','1session':'1d','1week':'1w','1month':'1mo'};
const ALIASES={ESZ4:'ESZ2024',ESH5:'ESH2025',ESM5:'ESM2025',ESU5:'ESU2025',ESZ5:'ESZ2025',ESH6:'ESH2026',ESM6:'ESM2026',ESU6:'ESU2026',ESZ6:'ESZ2026'};
const FIELDS=['open','high','low','close'];
export const FRAME_MS={'5m':300000,'10m':600000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export function intervalEnd(start,frame){
 if(frame==='1mo'){const d=new Date(start);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}
 if(!FRAME_MS[frame])throw Error('UNSUPPORTED_TIMEFRAME');return start+FRAME_MS[frame];
}
export function candidateSwitchUtc(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00Z').toISOString().slice(0,10)!==date)throw Error('INVALID_ROLL_DATE');
 const prev=new Date(Date.parse(date+'T00:00Z')-86400000).toISOString().slice(0,10);
 const target=Date.parse(prev+'T17:00Z');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(target)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const shown=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
 return new Date(target+(target-shown)).toISOString();
}
export function rollPolicy(rolls,{kind='CALENDAR',field='close',from='2024-10-12T00:00:00.000Z',to,terminal='ESZ2026'}={}){
 if(!['CALENDAR','SAMPLED_VOLUME'].includes(kind)||!['close','settlement_price'].includes(field)||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>=Date.parse(to)||terminal!=='ESZ2026')throw Error('INVALID_RESEARCH_POLICY');
 const chain=['ESZ2024','ESH2025','ESM2025','ESU2025','ESZ2025','ESH2026','ESM2026','ESU2026'];
 const transitions=chain.map(contract=>{const r=rolls.find(x=>x.old.full===contract);if(!r||rolls.filter(x=>x.old.full===contract).length!==1)throw Error('MISSING_OR_DUPLICATE_ROLL');return {old:r.old.full,next:r.next.full,rollDate:r.rollDate,effectiveUtc:r.rollDate?candidateSwitchUtc(r.rollDate):null,referenceSessionDate:r.referenceSessionDate??null,coefficient:r.coefficients[field],coefficientVersion:r.coefficientVersion,identityState:r.identityState,sourceCalendarApproved:false,tradingViewEquivalent:false};});
 for(let i=0;i<transitions.length;i++)if(!transitions[i].effectiveUtc||(i&&transitions[i-1].next!==transitions[i].old)||transitions[i].next!==(chain[i+1]??terminal)||i&&transitions[i].effectiveUtc<=transitions[i-1].effectiveUtc)throw Error('UNAVAILABLE_SELECTION_CHAIN');
 const offsets=Object.fromEntries([...chain,terminal].map(c=>[c,cumulativeAdjustment(c,rolls,field,terminal,true)]));
 const body={schemaVersion:'engine11.continuous-roll-policy.research.v1',kind,field,from,to,terminal,initialContract:chain[0],effectiveConvention:'RESEARCH_ROLL_LABEL_PREVIOUS_DAY_17_CHICAGO_NOT_EXCHANGE_CERTIFIED',session:'ETH_DESIRED_SOURCE_COVERAGE_UNVERIFIED',calendarVersion:'POST_2024_CHICAGO_ETH_CANDIDATE_UNAPPROVED_V1',transitions,offsets,tradingViewEquivalent:false,structuralEligible:false,executionPriceAuthority:false};
 return freeze({...body,policyVersion:'roll-policy:'+hash(body)});
}
export function selectedContract(policy,timestampMs){
 if(timestampMs<Date.parse(policy.from)||timestampMs>=Date.parse(policy.to))return null;
 let c=policy.initialContract;for(const r of policy.transitions)if(timestampMs>=Date.parse(r.effectiveUtc))c=r.next;return c;
}
export function ingestArchive(archive){
 const observations=[],receipts=[],queryWindows=[];
 for(const r of archive.receipts){const bytes=Buffer.from(r.bodyBase64,'base64');if(hash(bytes)!==r.bodySha256)throw Error('ORIGINAL_BODY_DIGEST');
  const v=captureReceipt({...r,body:bytes});receipts.push({originalReceiptId:r.receiptId,receiptId:v.receiptId,bodySha256:v.bodySha256,observedAt:v.observedAt,request:v.request,parseFailure:v.parseFailure});
  const url=new URL(v.request);if(!url.pathname.includes('/aggs/'))continue;
  const alias=url.pathname.split('/').at(-1),contract=ALIASES[alias],frame=RESOLUTIONS[url.searchParams.get('resolution')];if(!contract||!frame)throw Error('UNRECOGNIZED_REQUEST_CONTRACT_OR_FRAME');
  const start=url.searchParams.get('window_start.gte'),end=url.searchParams.get('window_start.lt');
  if(start&&end&&/^\d+$/.test(start)&&/^\d+$/.test(end))queryWindows.push({contract,frame,fromMs:Number(BigInt(start)/1000000n),toMs:Number(BigInt(end)/1000000n),receiptId:v.receiptId,httpStatus:r.httpStatus,nextUrlPresent:!!v.nextUrl});
  for(const o of v.observations){const p=o.payload;let reason=null;
   if(r.httpStatus!==200||v.parseFailure)reason='RESPONSE_UNAVAILABLE';
   else if(p.ticker!==alias)reason='CONTRACT_ALIAS_CONFLICT';
   else if(typeof p.window_start!=='string'||!/^\d{16,20}$/.test(p.window_start)||typeof p.session_end_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.session_end_date))reason='MALFORMED_IDENTITY';
   else if(start&&end&&/^\d+$/.test(start)&&/^\d+$/.test(end)&&(BigInt(p.window_start)<BigInt(start)||BigInt(p.window_start)>=BigInt(end)))reason='SOURCE_START_OUTSIDE_REQUEST_BOUNDS_UNRESOLVED';
   else if(!FIELDS.every(k=>Number.isFinite(p[k]))||p.high<Math.max(p.open,p.close,p.low)||p.low>Math.min(p.open,p.close,p.high)||!Number.isFinite(p.volume)||p.volume<0)reason='MALFORMED_OHLCV';
   observations.push({observationId:o.observationId,receiptId:v.receiptId,originalReceiptId:r.receiptId,rowDigest:o.rowDigest,bodySha256:v.bodySha256,observedAt:v.observedAt,contractProposal:contract,contractVerification:'RESEARCH_CONTEXT_NOT_INSTRUMENT_SOURCE_ACCEPTANCE',providerTicker:alias,frame,timestampNs:typeof p.window_start==='string'?p.window_start:null,sourceSessionLabel:p.session_end_date??null,raw:structuredClone(p),reason,sourceFinality:'UNKNOWN',calendar:'UNAPPROVED',structuralEligible:false});
  }
 }
 observations.sort((a,b)=>cmp(a.observationId,b.observationId));
 return {observations,receipts,queryWindows,from:archive.from,asOf:archive.asOf};
}
function uncoveredWindows(source,policy,frame,actualContract=null){
 const boundaries=[Date.parse(policy.from),...policy.transitions.map(r=>Date.parse(r.effectiveUtc)).filter(t=>t>Date.parse(policy.from)&&t<Date.parse(policy.to)),Date.parse(policy.to)].sort((a,b)=>a-b),out=[];
 for(let i=0;i<boundaries.length-1;i++){let cursor=boundaries[i];const end=boundaries[i+1],contract=actualContract??selectedContract(policy,cursor),windows=source.queryWindows.filter(w=>w.contract===contract&&w.frame===frame&&w.httpStatus===200).sort((a,b)=>a.fromMs-b.fromMs);
  for(const w of windows){if(w.toMs<=cursor||w.fromMs>=end)continue;if(w.fromMs>cursor)out.push({fromUtc:new Date(cursor).toISOString(),toUtc:new Date(Math.min(w.fromMs,end)).toISOString(),contract,reason:'SELECTED_CONTRACT_NOT_QUERIED_IN_PRESERVED_ARCHIVE',expectedTradingIntervals:'UNKNOWN'});cursor=Math.max(cursor,Math.min(end,w.toMs));}
  if(cursor<end)out.push({fromUtc:new Date(cursor).toISOString(),toUtc:new Date(end).toISOString(),contract,reason:'SELECTED_CONTRACT_NOT_QUERIED_IN_PRESERVED_ARCHIVE',expectedTradingIntervals:'UNKNOWN'});
 }return out;
}
export function buildDataset(source,policy,{sourceArchiveSha256,view='CONTINUOUS_UNADJUSTED'}={}){
 if(!['CONTINUOUS_UNADJUSTED','CONTINUOUS_ADJUSTED','ACTUAL_ESZ2026'].includes(view)||typeof sourceArchiveSha256!=='string')throw Error('VIEW_OR_SOURCE_DIGEST');
 const basis={view,policyVersion:policy.policyVersion,adjustment:view==='CONTINUOUS_ADJUSTED'?'ADDITIVE_RESEARCH':'NONE',actualContract:view==='ACTUAL_ESZ2026'?'ESZ2026':null,tradingViewEquivalent:false,executionPriceAuthority:false};
 const priceBasisVersion='price-basis:'+hash(basis),rows=[],excluded={},unavailable=[],groups=new Map();
 const reject=(o,reason)=>{excluded[reason]=(excluded[reason]??0)+1;if(reason.includes('CONFLICT')||reason.includes('AMBIGUOUS')||reason.includes('BOUNDARY')||reason.includes('ADJUSTMENT'))unavailable.push({observationId:o.observationId,timestampNs:o.timestampNs,frame:o.frame,contract:o.contractProposal,reason});};
 for(const o of source.observations){if(o.reason){reject(o,o.reason);continue;}const start=Number(BigInt(o.timestampNs)/1000000n),end=intervalEnd(start,o.frame);
  const expected=view==='ACTUAL_ESZ2026'?(start>=Date.parse(policy.from)&&start<Date.parse(policy.to)?'ESZ2026':null):selectedContract(policy,start);
  if(!expected){reject(o,'OUTSIDE_REQUESTED_WINDOW');continue;}if(o.contractProposal!==expected){reject(o,'OTHER_OVERLAPPING_CONTRACT_NOT_SELECTED');continue;}
  if(view!=='ACTUAL_ESZ2026'&&policy.transitions.some(r=>start<Date.parse(r.effectiveUtc)&&end>Date.parse(r.effectiveUtc))){reject(o,'NOMINAL_PERIOD_CROSSES_ROLL_BOUNDARY');continue;}
  const key=o.frame+'|'+o.timestampNs;const group=groups.get(key)??[];group.push(o);groups.set(key,group);
 }
 for(const group of groups.values()){
  const semantics=new Set(group.map(o=>hash(Object.fromEntries(Object.keys(o.raw).sort().map(k=>[k,o.raw[k]]))))),labels=new Set(group.map(o=>o.sourceSessionLabel));
  if(semantics.size>1||labels.size>1){group.forEach(o=>reject(o,'AMBIGUOUS_SAME_START_SOURCE_OBSERVATIONS'));continue;}
  const o=group[0],offset=view==='CONTINUOUS_ADJUSTED'?policy.offsets[o.contractProposal]?.offset:0;
  if(!Number.isFinite(offset)){group.forEach(o=>reject(o,'ADJUSTMENT_CHAIN_UNAVAILABLE'));continue;}
  const start=Number(BigInt(o.timestampNs)/1000000n),key=o.timestampNs.padStart(20,'0')+'|'+o.contractProposal+'|'+o.observationId;
  rows.push({researchCandleId:'continuous-research-row:'+hash([priceBasisVersion,group.map(x=>x.observationId),offset]),key,sourceObservationIds:group.map(x=>x.observationId),sourceContract:o.contractProposal,providerTicker:o.providerTicker,frame:o.frame,timestampNs:o.timestampNs,timestampUtc:new Date(start).toISOString(),timestampRenderPrecision:'MILLISECOND_LABEL_EXACT_SOURCE_NS_PRESERVED',nominalPeriodEndUtc:new Date(intervalEnd(start,o.frame)).toISOString(),sourceSessionLabel:o.sourceSessionLabel,prices:Object.fromEntries(FIELDS.map(k=>[k,o.raw[k]+offset])),volume:o.raw.volume,settlementPrice:Number.isFinite(o.raw.settlement_price)?o.raw.settlement_price+offset:null,adjustment:offset,adjustmentVersion:view==='CONTINUOUS_ADJUSTED'?policy.offsets[o.contractProposal].adjustmentVersion:null,priceBasisVersion,session:'ETH_DESIRED_UNVERIFIED',calendarVersion:policy.calendarVersion,intervalAlignment:'PROVIDER_LABELS_AND_NOMINAL_PERIOD_UNVERIFIED',completion:intervalEnd(start,o.frame)>Date.parse(source.asOf)?'NOMINAL_INTERVAL_EXTENDS_BEYOND_CAPTURE':'UNKNOWN',structuralEligible:false,executionPriceAuthority:false});
 }
 rows.sort((a,b)=>cmp(a.key,b.key));const coverage={};
 for(const frame of Object.values(RESOLUTIONS)){const rr=rows.filter(r=>r.frame===frame),gaps=[];
  for(let i=1;i<rr.length;i++){const prev=rr[i-1],p=Date.parse(prev.nominalPeriodEndUtc),s=Date.parse(rr[i].timestampUtc);if(s>p)gaps.push({fromUtc:new Date(p).toISOString(),toUtc:rr[i].timestampUtc,reason:'UNVERIFIED_GAP_OR_SCHEDULE_CLOSURE',expectedTradingIntervals:'UNKNOWN'});}
  coverage[frame]={rows:rr.length,firstUtc:rr[0]?.timestampUtc??null,lastUtc:rr.at(-1)?.timestampUtc??null,queryHoles:uncoveredWindows(source,policy,frame,view==='ACTUAL_ESZ2026'?'ESZ2026':null),observedDiscontinuities:gaps,calendarVerified:false,continuousCoverageVerified:false};
 }
 const manifest={schemaVersion:'engine11.continuous-chart-dataset.research.v1',sourceArchiveSha256,sourceReceiptVectorSha256:hash(source.receipts),policyVersion:policy.policyVersion,priceBasisVersion,basis,requestedFrom:policy.from,requestedTo:policy.to,sourceAsOf:source.asOf,rowCount:rows.length,rowVectorSha256:hash(rows.map(r=>r.researchCandleId)),excluded,coverageComplete:false,structuralEligible:false,executionPriceAuthority:false};
 return freeze({manifest,datasetVersion:'research-dataset:'+hash(manifest),policy,rows,coverage,unavailable});
}
export function pageDataset(dataset,{datasetVersion,priceBasisVersion,frame,limit=500,cursor=null,direction='ASC'}={}){
 if(datasetVersion!==dataset.datasetVersion||priceBasisVersion!==dataset.manifest.priceBasisVersion)throw Error('DATASET_OR_BASIS_MISMATCH');
 if(!Object.values(RESOLUTIONS).includes(frame)||!Number.isInteger(limit)||limit<1||limit>5000||!['ASC','DESC'].includes(direction))throw Error('INVALID_PAGE_REQUEST');
 let after=null;if(cursor){let c;try{c=JSON.parse(Buffer.from(cursor,'base64url'));}catch{throw Error('INVALID_CURSOR');}const {checksum,...body}=c;if(checksum!==hash(body)||c.datasetVersion!==datasetVersion||c.priceBasisVersion!==priceBasisVersion||c.frame!==frame||c.direction!==direction||typeof c.lastKey!=='string')throw Error('CURSOR_CONTEXT_MISMATCH');after=c.lastKey;}
 const ordered=dataset.rows.filter(r=>r.frame===frame);if(direction==='DESC')ordered.reverse();if(after&&!ordered.some(r=>r.key===after))throw Error('CURSOR_ROW_UNAVAILABLE');
 const available=ordered.filter(r=>!after||(direction==='ASC'?r.key>after:r.key<after)),rows=available.slice(0,limit),more=available.length>limit;
 const body={datasetVersion,priceBasisVersion,frame,direction,lastKey:rows.at(-1)?.key??after};
 return {datasetVersion,priceBasisVersion,frame,direction,rows,nextCursor:more?Buffer.from(JSON.stringify({...body,checksum:hash(body)})).toString('base64url'):null,coverage:dataset.coverage[frame],researchOnly:true,structuralEligible:false,executionPriceAuthority:false};
}
