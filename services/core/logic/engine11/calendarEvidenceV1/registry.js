import { createHash } from 'node:crypto';
import { hash,instant,requireTruth } from '../rawCandles/identity.js';
import { freeze } from '../sourceObservationsV2/evidence.js';
export const byteDigest=body=>createHash('sha256').update(body).digest('hex');
export const researchFlags={purpose:'ISOLATED_RESEARCH_ONLY',structuralEligible:false,calendarProductionAccepted:false};
export function validDate(date) {
 requireTruth(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'CALENDAR_DATE_REQUIRED');return date;
}
export function chicagoLabel(utc) {
 instant(utc);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(utc));
 const get=type=>parts.find(x=>x.type===type).value;return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
export function captureCalendarDocument({url,body,observedAt,evidenceKind='HTTP_BODY_AFTER_CONTENT_DECODE',product='ES',review={state:'BIBLIOGRAPHIC_ONLY'}}) {
 const u=new URL(url);requireTruth(u.protocol==='https:'&&u.hostname==='www.cmegroup.com'&&!u.username&&!u.password&&!u.hash,'CME_DOCUMENT_AUTHORITY_REQUIRED');instant(observedAt);requireTruth(product==='ES','ES_DOCUMENT_SCOPE_REQUIRED');
 requireTruth(['HTTP_BODY_AFTER_CONTENT_DECODE','ARCHIVED_ORIGINAL_BODY','FIXTURE'].includes(evidenceKind),'CALENDAR_EVIDENCE_KIND');
 const bytes=Buffer.from(body);requireTruth(bytes.length>0&&bytes.length<=16*1024*1024,'CALENDAR_DOCUMENT_SIZE');
 requireTruth(['BIBLIOGRAPHIC_ONLY','RESEARCH_REVIEWED'].includes(review.state),'CALENDAR_REVIEW_STATE');
 if(review.state==='RESEARCH_REVIEWED'){
  requireTruth(typeof review.reviewer==='string'&&review.reviewer.length>0&&typeof review.section==='string'&&review.section.length>0,'CALENDAR_REVIEW_PROVENANCE');instant(review.reviewedAt);requireTruth(instant(review.reviewedAt)>=instant(observedAt),'REVIEW_BEFORE_DOCUMENT');
  validDate(review.effectiveFrom);validDate(review.effectiveThrough);requireTruth(review.effectiveFrom<=review.effectiveThrough&&['BASELINE_RULE','DATED_SESSION','DATED_EXPIRY','FIXTURE'].includes(review.coverageType),'DOCUMENT_COVERAGE_SCOPE');
  requireTruth(review.coverageType!=='FIXTURE'||evidenceKind==='FIXTURE','FIXTURE_SCOPE_REQUIRES_FIXTURE_EVIDENCE');
 }
 const content={schemaVersion:'engine11.calendar-document.v1',url:u.toString(),product,observedAt,evidenceKind,bodySha256:byteDigest(bytes),bodyBase64:bytes.toString('base64'),review,...researchFlags};
 return freeze({...content,documentId:'calendar-document:v1:'+hash(content)});
}
export function buildCalendarRegistry({documents=[],rules=[],sessions=[],previousVersion=null,tzdbVersion=process.versions.tz}) {
 requireTruth(typeof tzdbVersion==='string'&&tzdbVersion===process.versions.tz,'TZDB_VERSION_MISMATCH');
 const verified=documents.map(d=>{
  const rebuilt=captureCalendarDocument({...d,body:Buffer.from(d.bodyBase64,'base64')});requireTruth(hash(d)===hash(rebuilt),'CALENDAR_DOCUMENT_TAMPER');return rebuilt;
 });
 const ids=new Set(verified.map(d=>d.documentId));requireTruth(ids.size===verified.length,'DUPLICATE_CALENDAR_DOCUMENT');
 const reviewed=id=>verified.find(d=>d.documentId===id)?.review.state==='RESEARCH_REVIEWED';
 for(const rule of rules){validDate(rule.effectiveFrom);validDate(rule.effectiveThrough);requireTruth(rule.effectiveFrom<=rule.effectiveThrough&&Array.isArray(rule.documentIds)&&rule.documentIds.length>0&&rule.documentIds.every(id=>ids.has(id)&&reviewed(id)),'CALENDAR_RULE_EVIDENCE');}
 for(let i=0;i<rules.length;i++)for(let j=i+1;j<rules.length;j++)requireTruth(rules[i].scope!==rules[j].scope||rules[i].effectiveThrough<rules[j].effectiveFrom||rules[j].effectiveThrough<rules[i].effectiveFrom,'OVERLAPPING_CALENDAR_RULES');
 const dates=new Set();
 for(const session of sessions){validDate(session.tradingDate);requireTruth(!dates.has(session.tradingDate),'DUPLICATE_TRADING_DATE');dates.add(session.tradingDate);
  requireTruth(['COMPLETE_RESEARCH_SESSION_PROOF','BASELINE_ONLY','UNKNOWN'].includes(session.validationState),'SESSION_EVIDENCE_STATE');
  if(session.validationState==='UNKNOWN'){requireTruth(typeof session.reason==='string'&&session.reason.length>0,'UNKNOWN_DATE_REASON');continue;}
  const lo=instant(session.openUtc),hi=instant(session.closeUtc);requireTruth(lo<hi&&hi-lo<=72*3600000,'SESSION_BOUNDS');
  requireTruth(chicagoLabel(session.openUtc)===session.openChicago&&chicagoLabel(session.closeUtc)===session.closeChicago,'SESSION_TIMEZONE_MISMATCH');
  requireTruth(Array.isArray(session.documentIds)&&session.documentIds.length>0&&session.documentIds.every(id=>ids.has(id)),'SESSION_DOCUMENT_DEPENDENCY');
  if(session.validationState==='COMPLETE_RESEARCH_SESSION_PROOF'){
   requireTruth(session.documentIds.every(reviewed),'UNREVIEWED_SESSION_DOCUMENT');
   requireTruth(session.documentIds.some(id=>{const d=verified.find(x=>x.documentId===id),r=d.review;return ['DATED_SESSION','FIXTURE'].includes(r.coverageType)&&r.effectiveFrom<=session.tradingDate&&r.effectiveThrough>=session.tradingDate;}),'DATED_SESSION_PROOF_REQUIRED');
  }
  let cursor=lo;requireTruth(Array.isArray(session.segments)&&session.segments.length>0,'SESSION_SEGMENTS_REQUIRED');
  for(const segment of session.segments){requireTruth(['OPEN','PAUSED','CLOSED','UNKNOWN'].includes(segment.state),'SEGMENT_STATE');const start=instant(segment.from),end=instant(segment.to);requireTruth(start===cursor&&end>start&&end<=hi,'SESSION_PARTITION');cursor=end;requireTruth(typeof segment.reason==='string'&&segment.reason.length>0,'SEGMENT_REASON');}
  requireTruth(cursor===hi,'SESSION_PARTITION_INCOMPLETE');
 }
 const content={schemaVersion:'engine11.es-calendar.v1',registryPolicyVersion:'es-calendar-research.1',exchange:'CME',product:'ES',timezone:'America/Chicago',tzdbVersion,previousVersion,
  documents:verified,rules:[...rules].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)),sessions:[...sessions].sort((a,b)=>a.tradingDate.localeCompare(b.tradingDate)),...researchFlags};
 const times=verified.flatMap(d=>[d.observedAt,...(d.review.reviewedAt?[d.review.reviewedAt]:[])]);
 return freeze({...content,calendarVersion:'calendar:v1:'+hash(content),knowledgeAsOf:times.length?new Date(Math.max(...times.map(instant))).toISOString():null});
}
export function validateRegistry(registry) {
 const rebuilt=buildCalendarRegistry(registry);requireTruth(hash(rebuilt)===hash(registry),'CALENDAR_REGISTRY_TAMPER');return rebuilt;
}
export function selectResearchSession(registry,tradingDate,asOf) {
 const r=validateRegistry(registry);validDate(tradingDate);instant(asOf);
 if(r.knowledgeAsOf&&instant(asOf)<instant(r.knowledgeAsOf))return freeze({state:'UNAVAILABLE',reason:'ASOF_BEFORE_CALENDAR_EVIDENCE',...researchFlags});
 const session=r.sessions.find(s=>s.tradingDate===tradingDate);
 if(!session||session.validationState==='UNKNOWN')return freeze({state:'UNAVAILABLE',reason:session?.reason??'UNKNOWN_CALENDAR_DATE',tradingDate,...researchFlags});
 if(session.validationState!=='COMPLETE_RESEARCH_SESSION_PROOF')return freeze({state:'UNAVAILABLE',reason:'BASELINE_IS_NOT_COMPLETE_SESSION_PROOF',tradingDate,...researchFlags});
 if(session.segments.some(s=>s.state==='UNKNOWN'))return freeze({state:'UNAVAILABLE',reason:'UNKNOWN_SESSION_SEGMENT',tradingDate,...researchFlags});
 return freeze({state:'RESEARCH_SESSION_CANDIDATE',session,calendarVersion:r.calendarVersion,
  evidenceKinds:[...new Set(session.documentIds.map(id=>r.documents.find(d=>d.documentId===id).evidenceKind))],...researchFlags});
}
