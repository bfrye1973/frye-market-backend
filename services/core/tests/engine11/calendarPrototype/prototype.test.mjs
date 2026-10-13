import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureCalendarDocument,buildCalendarRegistry,selectResearchSession,chicagoLabel } from '../../../logic/engine11/calendarEvidenceV1/registry.js';
import { historicalBindingCandidate } from '../../../logic/engine11/calendarEvidenceV1/historicalBinding.js';
import { researchIntervals,sourceMembership } from '../../../logic/engine11/analyticalIntervalResearchV1/membership.js';
import { captureReceipt } from '../../../logic/engine11/sourceObservationsV2/evidence.js';
import { doc,registry,session,sourceDataset,asOf,observedAt } from './fixtures.mjs';
const plan=(timeframe='4h',r=registry())=>researchIntervals({registry:r,tradingDate:'2026-09-10',timeframe,asOf});
const member=(d=sourceDataset(),r=registry(),extra={})=>sourceMembership({registry:r,sourceDataset:d,observation:d.rows[0],tradingDate:'2026-09-10',timeframe:'5m',asOf,...extra});
test('document digest and original byte provenance survive serialization',()=>assert.equal(buildCalendarRegistry(JSON.parse(JSON.stringify(registry()))).documents[0].bodyBase64,doc.bodyBase64));
test('document authority excludes non-CME URLs and credential forms',()=>{
 for(const url of ['https://evil.example/x','http://www.cmegroup.com/x','https://user:pass@www.cmegroup.com/x'])assert.throws(()=>captureCalendarDocument({...doc,url,body:Buffer.from('x')}));
});
test('document mutation cannot masquerade as immutable evidence',()=>{const d=JSON.parse(JSON.stringify(doc));d.bodyBase64=Buffer.from('changed').toString('base64');assert.throws(()=>buildCalendarRegistry({documents:[d]}));});
test('reviewer and section provenance required for reviewed evidence',()=>assert.throws(()=>captureCalendarDocument({...doc,body:Buffer.from('x'),review:{state:'RESEARCH_REVIEWED'}})));
test('unknown dates explicitly unavailable rather than generated weekdays',()=>assert.equal(selectResearchSession(registry(),'2020-03-03',asOf).state,'UNAVAILABLE'));
test('explicit unknown-date reason remains visible',()=>assert.equal(selectResearchSession(registry([{tradingDate:'2020-03-03',validationState:'UNKNOWN',reason:'HOLIDAY_ARCHIVE_MISSING'}]),'2020-03-03',asOf).reason,'HOLIDAY_ARCHIVE_MISSING'));
test('baseline never establishes complete session proof',()=>assert.equal(plan('4h',registry([session({validationState:'BASELINE_ONLY'})])).intervals.length,0));
test('reviewed baseline rule cannot masquerade as a full dated holiday/session schedule',()=>{
 const d=captureCalendarDocument({...doc,body:Buffer.from(doc.bodyBase64,'base64'),review:{...doc.review,coverageType:'BASELINE_RULE'}});assert.throws(()=>buildCalendarRegistry({documents:[d],sessions:[session({documentIds:[d.documentId]})]}));
});
test('dated session proof cannot certify a date outside reviewed evidence coverage',()=>{
 const d=captureCalendarDocument({...doc,body:Buffer.from(doc.bodyBase64,'base64'),review:{...doc.review,effectiveThrough:'2026-09-09'}});assert.throws(()=>buildCalendarRegistry({documents:[d],sessions:[session({documentIds:[d.documentId]})]}));
});
test('unknown internal segment prevents interval membership',()=>{
 const s=session();s.segments[0].state='UNKNOWN';assert.equal(plan('4h',registry([s])).reason,'UNKNOWN_SESSION_SEGMENT');
});
test('gaps and overlapping session partitions rejected',()=>{
 const a=session();a.segments[0].from='2026-09-09T23:00:00Z';assert.throws(()=>registry([a]));
 const b=session();b.segments.push({...b.segments[0]});assert.throws(()=>registry([b]));
});
test('invalid trading dates and duplicate sessions rejected',()=>{assert.throws(()=>registry([session({tradingDate:'2026-02-31'})]));assert.throws(()=>registry([session(),session()]));});
test('Chicago labels must match supplied actual UTC instants',()=>assert.throws(()=>registry([session({openChicago:'2026-09-09T18:00:00'})])));
test('calendar versions pin exact rule/session evidence and append revision',()=>{
 const a=registry(),b=buildCalendarRegistry({documents:[doc],sessions:[session({segments:[{...session().segments[0],reason:'AMENDED_FIXTURE'}]})],previousVersion:a.calendarVersion});assert.notEqual(a.calendarVersion,b.calendarVersion);assert.equal(b.previousVersion,a.calendarVersion);assert.equal(a.sessions[0].segments[0].reason,'FIXTURE_ORDINARY_SESSION');
});
test('calendar as-of refuses future document/review evidence',()=>assert.equal(selectResearchSession(registry(),'2026-09-10','2026-10-12T23:00:00Z').state,'UNAVAILABLE'));
test('timezone database version mismatch fails explicitly',()=>assert.throws(()=>buildCalendarRegistry({tzdbVersion:'made-up'})));
test('UTC spring/fall changes retain local session-open clock',()=>{
 assert.match(chicagoLabel('2020-03-06T23:00:00Z'),/T17:00:00$/);assert.match(chicagoLabel('2020-03-08T22:00:00Z'),/T17:00:00$/);assert.match(chicagoLabel('2020-11-01T23:00:00Z'),/T17:00:00$/);
});
test('effective-dated June 2021 boundary selects non-overlapping registry rules',()=>{
 const r=buildCalendarRegistry({documents:[doc],rules:[{scope:'ES_PAUSE',effectiveFrom:'2020-03-01',effectiveThrough:'2021-06-27',documentIds:[doc.documentId],pause:true},{scope:'ES_PAUSE',effectiveFrom:'2021-06-28',effectiveThrough:'2026-10-13',documentIds:[doc.documentId],pause:false}]});assert.equal(r.rules.find(x=>x.effectiveFrom<='2020-03-10'&&x.effectiveThrough>='2020-03-10').pause,true);assert.equal(r.rules.find(x=>x.effectiveFrom<='2021-06-28'&&x.effectiveThrough>='2021-06-28').pause,false);
});
test('overlapping rules and unknown rule documents rejected',()=>{
 const x={scope:'ES_PAUSE',effectiveFrom:'2020-03-01',effectiveThrough:'2026-10-13',documentIds:[doc.documentId]};assert.throws(()=>buildCalendarRegistry({documents:[doc],rules:[x,x]}));assert.throws(()=>buildCalendarRegistry({rules:[x]}));
});
test('rules cannot extend evidence coverage backward to unreviewed history',()=>{
 const d=captureCalendarDocument({...doc,body:Buffer.from(doc.bodyBase64,'base64'),review:{...doc.review,effectiveFrom:'2021-06-28',coverageType:'BASELINE_RULE'}});
 assert.throws(()=>buildCalendarRegistry({documents:[d],rules:[{scope:'ES_PAUSE',effectiveFrom:'2020-03-01',effectiveThrough:'2026-10-13',documentIds:[d.documentId]}]}));
});
test('different session labels cannot authorize overlapping exchange matching segments',()=>assert.throws(()=>registry([session(),session({tradingDate:'2026-09-11'})])));
for(const [tf,count] of [['5m',276],['10m',138],['1h',23],['4h',6]])test(tf+' uses session-open elapsed-time boundaries without OHLCV publication',()=>{
 const p=plan(tf);assert.equal(p.intervals.length,count);assert.equal(p.intervals[0].startUtc,'2026-09-09T22:00:00.000Z');assert.ok(p.intervals.every(x=>x.ohlcv===null&&!x.structuralEligible&&x.sourceFinality==='UNKNOWN'));assert.ok(p.evidenceKinds.includes('FIXTURE'));
});
test('23-hour session retains three-hour terminal 4h partial',()=>{const p=plan();assert.equal(p.intervals.at(-1).elapsedMs,10800000);assert.equal(p.intervals.at(-1).terminalPartial,true);});
test('pause is masked without compressing or restarting elapsed grid',()=>{
 const s=session();s.segments=[{from:s.openUtc,to:'2026-09-10T00:00:00Z',state:'OPEN',reason:'FIXTURE'},{from:'2026-09-10T00:00:00Z',to:'2026-09-10T00:15:00Z',state:'PAUSED',reason:'FIXTURE'},{from:'2026-09-10T00:15:00Z',to:s.closeUtc,state:'OPEN',reason:'FIXTURE'}];const p=plan('4h',registry([s]));assert.equal(p.intervals[0].openMs,14400000-900000);assert.equal(p.intervals[1].startUtc,'2026-09-10T02:00:00.000Z');
});
test('early-close terminal partial is explicit',()=>{
 const s=session({closeUtc:'2026-09-10T17:15:00Z',closeChicago:'2026-09-10T12:15:00'});s.segments[0].to=s.closeUtc;assert.equal(plan('4h',registry([s])).intervals.at(-1).terminalPartial,true);
});
test('future interval remains incomplete even with known calendar',()=>{
 const earlyDoc=captureCalendarDocument({...doc,body:Buffer.from(doc.bodyBase64,'base64'),observedAt:'2026-09-01T00:00:00Z',review:{...doc.review,reviewedAt:'2026-09-01T00:00:00Z'}});const s=session({documentIds:[earlyDoc.documentId]});const r=buildCalendarRegistry({documents:[earlyDoc],sessions:[s]});const p=researchIntervals({registry:r,tradingDate:s.tradingDate,timeframe:'4h',asOf:'2026-09-10T00:00:00Z'});assert.equal(p.intervals[0].state,'INCOMPLETE_CLOCK_PERIOD');
});
test('weekly monthly and substituted timeframes not implemented',()=>{for(const tf of ['1d','1w','1mo','30m'])assert.throws(()=>plan(tf));});
test('source membership validates receipt-bound snapshot before using key',()=>{assert.equal(member().state,'SOURCE_START_MEMBERSHIP_CANDIDATE');assert.equal(member(undefined,undefined,{sourceDataset:null}).reason,'SOURCE_DATASET_EVIDENCE_REQUIRED');});
test('unbound source retained but membership quarantined',()=>assert.equal(member(sourceDataset({binding:false})).reason,'UNVERIFIED_CONTRACT_SOURCE_KEY'));
test('source session mismatch never snapped to calendar',()=>assert.equal(member(sourceDataset({date:'2026-09-09'})).reason,'SOURCE_SESSION_LABEL_MISMATCH'));
test('source timestamp outside label session quarantined',()=>assert.equal(member(sourceDataset({timestamp:'1788984000000000000'})).reason,'SOURCE_CLOCK_OUTSIDE_LABELLED_SESSION'));
test('source snapshot mutation rejected',()=>{const d=JSON.parse(JSON.stringify(sourceDataset()));d.rows[0].payload.close=1;assert.equal(member(d).state,'QUARANTINED');});
test('overlapping quarterly contracts retain distinct receipt-bound sources',()=>{const a=sourceDataset(),b=sourceDataset({ticker:'ESZ6',contract:'ESZ2026'});assert.notEqual(member(a).sourceKey,member(b).sourceKey);});
test('elapsed interval never upgrades source finality or structural eligibility',()=>{const m=member();assert.equal(m.extentVerified,false);assert.equal(m.structuralEligible,false);assert.equal(m.sourceFinality,'UNKNOWN');});
const metadataRecord={ticker:'ESH0',product_code:'ES',trading_venue:'XCME',date:'2020-03-10',active:true,first_trade_date:'2018-12-21',last_trade_date:'2020-03-20'};
const metadata=record=>captureReceipt({request:'https://api.massive.com/futures/v1/contracts?ticker=ESH0&date=2020-03-10',body:Buffer.from(JSON.stringify({status:'OK',results:[record]})),captureId:'historical-fixture',observedAt,evidenceKind:'FIXTURE'});
const candidate=(record=metadataRecord,extra={})=>historicalBindingCandidate({contract:'ESH2020',ticker:'ESH0',metadataReceipt:metadata(record),asOf,...extra});
test('historical lifespan without independent expiry stays unresolved and no settlement is invented',()=>{const b=candidate();assert.equal(b.reason,'INDEPENDENT_EXPIRY_CORROBORATION_REQUIRED');assert.equal(b.settlementDate,null);assert.equal(b.bindingAccepted,false);});
test('wrong decade, product or query-date coherence cannot upgrade historical identity',()=>{
 assert.equal(candidate({...metadataRecord,last_trade_date:'2030-03-20'}).state,'UNRESOLVED');assert.equal(candidate({...metadataRecord,product_code:'NQ'}).state,'UNRESOLVED');assert.equal(candidate({...metadataRecord,date:'2020-03-11'}).state,'UNRESOLVED');
});
test('corroborated expiry can produce only research candidate, never accepted global binding',()=>{
 const b=candidate(metadataRecord,{registry:registry(),expiryCorroboration:{documentId:doc.documentId,contract:'ESH2020',lastTradeDate:'2020-03-20',state:'INDEPENDENT_EXPIRY_RESEARCH_REVIEWED',section:'FIXTURE_NOT_EXCHANGE_PROOF'}});assert.equal(b.state,'CORROBORATED_RESEARCH_BINDING_CANDIDATE');assert.equal(b.bindingAccepted,false);assert.equal(b.structuralEligible,false);
});
test('wrong independent expiry record remains unresolved',()=>assert.equal(candidate(metadataRecord,{registry:registry(),expiryCorroboration:{documentId:doc.documentId,contract:'ESH2020',lastTradeDate:'2020-03-19',state:'INDEPENDENT_EXPIRY_RESEARCH_REVIEWED',section:'fixture'}}).state,'UNRESOLVED'));
test('authentic archived 2020 metadata explains blocker without becoming expiry proof',()=>{
 const e=JSON.parse(readFileSync('docs/architecture/ENGINE11_ES_2020_METADATA_EVIDENCE_V1.json','utf8'));const record=e.metadata.find(x=>x.label==='ESH0-date').returnedMetadata[0];assert.equal(candidate(record).state,'UNRESOLVED');assert.equal(record.last_trade_date,'2020-03-20');assert.ok(!Object.hasOwn(record,'settlement_date'));
});
