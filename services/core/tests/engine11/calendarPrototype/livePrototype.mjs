import { mkdir,writeFile } from 'node:fs/promises';
import { captureCalendarDocument,buildCalendarRegistry,selectResearchSession } from '../../../logic/engine11/calendarEvidenceV1/registry.js';
import { historicalBindingCandidate } from '../../../logic/engine11/calendarEvidenceV1/historicalBinding.js';
import { researchIntervals } from '../../../logic/engine11/analyticalIntervalResearchV1/membership.js';
import { acquireSourceObservations } from '../../../logic/engine11/sourceObservationsV2/provider.js';
const apiKey=process.env.POLYGON_API_KEY;if(!apiKey)throw new Error('Existing provider credential required');
const documents=[],documentFailures=[];
const sources=[
 ['pause_notice','https://www.cmegroup.com/content/dam/cmegroup/notices/ser/2021/06/SER-8788R.pdf'],
 ['es_applicability','https://www.cmegroup.com/content/dam/cmegroup/notices/electronic-trading/2021/06/cme-equity-index-futures-options.pdf'],
 ['current_rulebook','https://www.cmegroup.com/content/dam/cmegroup/rulebook/CME/IV/350/358/358.pdf']
];
for(const [name,url] of sources){
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!response.ok){documentFailures.push({name,url,reason:'HTTP_'+response.status});continue;}
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.subarray(0,5).toString()!=='%PDF-'){documentFailures.push({name,url,reason:'EXPECTED_PDF_NOT_RECEIVED'});continue;}
  const observedAt=new Date().toISOString();
  const review=name==='current_rulebook'?{state:'BIBLIOGRAPHIC_ONLY'}:{state:'RESEARCH_REVIEWED',reviewer:'Engine11 research interpretation; not production acceptance',reviewedAt:observedAt,
   coverageType:'BASELINE_RULE',effectiveFrom:'2021-06-28',effectiveThrough:new Date().toISOString().slice(0,10),section:name==='pause_notice'?'SER-8788R section 5 pause-removal baseline only':'Affected products: E-mini S&P 500 futures ES; baseline applicability only'};
  documents.push({name,document:captureCalendarDocument({url,body:bytes,observedAt,review})});
 }catch(e){documentFailures.push({name,url,reason:e.code??'DOCUMENT_FETCH_UNAVAILABLE'});}
}
const from='2020-03-01',through=new Date().toISOString().slice(0,10);
const pauseDocs=documents.filter(x=>['pause_notice','es_applicability'].includes(x.name)).map(x=>x.document.documentId);
const rules=pauseDocs.length===2?[{scope:'ES_AFTERNOON_PAUSE',effectiveFrom:'2021-06-28',effectiveThrough:through,documentIds:pauseDocs,pause:false,validation:'BASELINE_ONLY_NO_COMPLETE_DATE_CERTIFICATION'}]:[];
const dates=['2020-03-03','2020-04-10','2021-06-25','2021-06-28','2026-09-10'];
const registry=buildCalendarRegistry({documents:documents.map(x=>x.document),rules,sessions:dates.map(tradingDate=>({tradingDate,validationState:'UNKNOWN',reason:'COMPLETE_DATED_ES_SESSION_EXCEPTION_PROOF_UNAVAILABLE'}))});
const metadata=[],bindings=[];
for(const [contract,ticker] of [['ESH2020','ESH0'],['ESM2020','ESM0']]){
 const a=await acquireSourceObservations({request:'https://api.massive.com/futures/v1/contracts?'+new URLSearchParams({ticker,product_code:'ES',date:'2020-03-10',limit:'100'}),apiKey,maxPages:1,maxRows:100});
 metadata.push({contract,acquisition:a});
 if(a.receipts[0])bindings.push(historicalBindingCandidate({contract,ticker,metadataReceipt:a.receipts[0],registry,asOf:new Date().toISOString()}));
 else bindings.push({contract,state:'UNRESOLVED',reason:a.failure,structuralEligible:false});
}
const asOf=new Date().toISOString(),membershipChecks=dates.flatMap(tradingDate=>['5m','10m','1h','4h'].map(timeframe=>({tradingDate,timeframe,result:researchIntervals({registry,tradingDate,timeframe,asOf})})));
const summary={calendarVersion:registry.calendarVersion,tzdbVersion:registry.tzdbVersion,documents:documents.map(x=>({name:x.name,documentId:x.document.documentId,sha256:x.document.bodySha256,review:x.document.review.state})),documentFailures,
 bindings,membershipChecks:membershipChecks.map(x=>({date:x.tradingDate,timeframe:x.timeframe,state:x.result.state,reason:x.result.reason,intervalCount:x.result.intervals.length})),
 unknownDateRanges:[{from,through,reason:'COMPLETE_HISTORICAL_ES_MATCHING_CALENDAR_UNVERIFIED'}],productionCalendarAccepted:false,structuralEligible:false};
await mkdir('research-evidence',{recursive:true});await writeFile('research-evidence/engine11-calendar-membership.json',JSON.stringify({summary,registry,metadata,membershipChecks},null,2)+'\n');
console.log('CALENDAR_PROTOTYPE_SUMMARY '+JSON.stringify(summary));
