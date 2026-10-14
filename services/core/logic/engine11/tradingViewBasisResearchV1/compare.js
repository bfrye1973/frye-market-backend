import {createHash} from 'node:crypto';
import {indexSamples,cumulativeAdjustment} from '../nodeReconciliationResearchV1/reconcile.js';
export const SOURCE_SHA='287b9ba346afcbc276468b4c3b0ace28123d18ff';
export const SOURCE_REPORT_SHA='2aa5700c8672456fd9a86a91d9a019ba630e90df02befb39c35a4acee187a119';
export const ORIGINAL_SHA='0177e95c58e711d78456b00d952d56f0efe77d64d195a5c86024b0d9cff5b0e4';
export const IDS=['WB-ALL-030','WB-ALL-031','WB-ALL-032','WB-ALL-024','WB-ALL-012'];
export const digest=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const FIELDS=['open','high','low','close'];
export function volumeResearchRolls(rolls){
 return rolls.map(r=>{
  const dates=[...r.volumeComparisons].sort((a,b)=>a.sessionDate.localeCompare(b.sessionDate));
  const crossing=dates.find(d=>d.nextExceedsOld&&d.sameIntervalStart);
  const reference=crossing?dates.filter(d=>d.sessionDate<crossing.sessionDate&&d.sameIntervalStart).at(-1):null;
  const value={...r,policyVersion:'FIRST_SAMPLED_VOLUME_CROSSOVER_RESEARCH_V1',rollDate:crossing?.sessionDate??null,referenceSessionDate:reference?.sessionDate??null,coefficients:{close:reference?.closeDelta??null,settlement_price:reference?.settlementDelta??null},state:reference?'CANDIDATE_OVERLAP_ARITHMETIC':'NO_SAMPLED_VOLUME_REFERENCE',sampleWindowStart:dates[0]?.sessionDate??null,firstHistoricalCrossoverVerified:false,tradingViewEquivalent:false,referenceRows:null,referenceObservationIds:reference?[reference.oldObservationId,reference.newObservationId]:[]};
  return {...value,coefficientVersion:'volume-research:'+digest(value)};
 });
}
export function evaluatePrice(owner,ohlc,offset,endpoint){
 if(!Number.isFinite(offset))return {state:'UNAVAILABLE',offset:null,ohlc:null,exactFields:[],endpointExact:false};
 const transformed=Object.fromEntries(FIELDS.map(k=>[k,Number.isFinite(ohlc[k])?ohlc[k]+offset:null]));
 return {state:'NUMERIC_COMPARISON_ONLY',offset,ohlc:transformed,exactFields:FIELDS.filter(k=>transformed[k]===owner),endpointExact:transformed[endpoint]===owner,ownerMinusEndpoint:transformed[endpoint]===null?null:owner-transformed[endpoint]};
}
export function comparisonPacket(report,original){
 if(digest(report)!==SOURCE_REPORT_SHA)throw Error('PINNED_REPORT_DIGEST');
 if(report.registrySha!=='482ef74bc46367718fb207148d5e92a7b0cc248a')throw Error('REGISTRY_DRIFT');
 const samples=indexSamples(original.samples),volumeRolls=volumeResearchRolls(report.rolls);
 const nodes=IDS.map(id=>{
  const n=report.nodes.find(x=>x.registryNodeId===id);if(!n)throw Error('MISSING_SELECTED_NODE');
  const endpoint=n.node.includes('high')?'high':'low';
  const allSamples=samples.filter(s=>s.query.nodeId===n.importNodeId&&['NODE_MINUTE_DIAGNOSTIC','NODE_NATIVE_FRAME'].includes(s.query.purpose));
  const evidence=allSamples.flatMap(s=>s.evidenceRows.filter(e=>e.source.aliasMatchesRequest).map(e=>{
   const native=s.query.purpose==='NODE_NATIVE_FRAME';
   // Retain every native observation; diagnostic minutes retain exact requested starts only.
   if(!native&&e.row.window_start!==String(BigInt(Date.parse(s.query.targetUtc))*1000000n))return null;
   const ohlc=Object.fromEntries(FIELDS.map(k=>[k,e.row[k]]));
   const models=[{model:'INDIVIDUAL_CONTRACT_RAW_NOT_CERTIFIED_TV_B_ADJ_OFF',field:null,offset:0,lineage:[],tradingViewEquivalent:false}];
   for(const [policy,rolls] of [['CALENDAR',report.rolls],['SAMPLED_VOLUME',volumeRolls]])for(const field of ['close','settlement_price']){
    const a=cumulativeAdjustment(s.query.contract.full,rolls,field);
    models.push({model:policy+'_ADDITIVE_RESEARCH_NOT_CERTIFIED_TV_B_ADJ_ON',...a});
   }
   return {source:e.source,windowStartNanoseconds:e.row.window_start,sessionEndDate:e.row.session_end_date,sourceOhlc:ohlc,sourceSettlement:e.row.settlement_price??null,nativeFrame:native,resolution:s.query.resolution,hypothesis:s.query.hypothesis??'NATIVE_QUERY_TARGET_PHOENIX_UNCONFIRMED',targetUtc:s.query.targetUtc,intervalMembership:'UNVERIFIED_PROVIDER_START_AND_SESSION_LABEL_NOT_EXCHANGE_INTERVAL',finality:'UNKNOWN',comparisons:models.map(a=>({...a,numeric:evaluatePrice(n.original.price,ohlc,a.offset,endpoint)}))};
  }).filter(Boolean));
  const volume=volumeRolls.find(r=>r.old.full===n.nativeCandidates[0]?.contract);
  return {registryNodeId:id,degree:n.degree,node:n.node,originalOwnerCoordinate:structuredClone(n.original),recordedLocalTime:n.coordinateInterpretation.recordedLocalTime,timezone:'UNKNOWN_OWNER_REPORTED_PHOENIX_HYPOTHESIS',endpoint,proposedStructuralTimeframe:n.nativeCandidates[0]?.resolution??null,originalDrawingTimeframe:'UNKNOWN',existingOperationalCoordinate:structuredClone(n.existingOperationalCoordinate),sourceConflicts:n.workbookCrossSheetConflicts,continuousUnadjustedCandidates:{calendarContract:n.candidateContinuousUnadjusted.contract,sampledVolumeContract:volume?.rollDate&&n.coordinateInterpretation.date>=volume.rollDate?volume.next.full:n.nativeCandidates[0]?.contract,verifiedTradingViewContract:null},evidence,exactEndpointComparisons:evidence.flatMap(e=>e.comparisons.filter(a=>a.numeric.endpointExact).map(a=>({observationId:e.source.observationId,model:a.model,field:a.field,nativeFrame:e.nativeFrame,intervalMembership:e.intervalMembership}))),verifiedChartCoordinate:null,result:'UNRESOLVED',structuralEligible:false,executionPriceAuthority:false};
 });
 const body={schemaVersion:'engine11.tradingview-wave-coordinate-comparison.research.v1',phase2Sha:SOURCE_SHA,sourceReportSha256:SOURCE_REPORT_SHA,originalEvidenceSha256:ORIGINAL_SHA,registrySha:report.registrySha,workbookSha256:report.workbookSha256,datasetVersion:report.datasetVersion,asOf:report.asOf,nodes,volumeResearchRolls:volumeRolls.filter(r=>['ESM2025','ESU2025','ESZ2025','ESH2026','ESM2026','ESU2026'].includes(r.old.full)),rollPoliciesDistinguishedByEvidence:false,tradingViewObservations:[],verifiedChartCoordinates:0,structuralEligible:false,executionPriceAuthority:false};
 return {...body,packetVersion:'tv-coordinate-research:'+digest(body)};
}
// A proposed display certificate is independent of structural approval and never supplies execution.
export function coordinateCertificate(originalOwnerCoordinate,evidence){
 const required=['sourceCoordinateHash','seriesIdentity','datasetVersion','priceBasisVersion','calendarVersion','contractLineageVersion','rollVersion','timestampPolicyVersion','sourceObservationId','sourceReceiptId','tradingViewEvidenceHash','chartConfigurationHash','dataVintage','conversionVersion'];
 const missing=required.filter(k=>typeof evidence?.[k]!=='string'||!evidence[k].length);
 if(evidence?.sourceCoordinateHash!==digest(originalOwnerCoordinate))missing.push('SOURCE_COORDINATE_HASH_MISMATCH');
 for(const flag of ['sourceAccepted','intervalVerified','finalityVerified','contractVerified','settingsVerified','conversionVerified'])if(evidence?.[flag]!==true)missing.push(flag);
 if(!Number.isFinite(evidence?.price)||!Number.isFinite(evidence?.originalBasisPrice)||typeof evidence?.timestampUtc!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(evidence.timestampUtc)||!Number.isFinite(Date.parse(evidence.timestampUtc))||new Date(evidence.timestampUtc).toISOString().replace('.000Z','Z')!==evidence.timestampUtc.replace('.000Z','Z'))missing.push('EXACT_COORDINATE_UNAVAILABLE');
 if(evidence?.originalBasisPrice!==originalOwnerCoordinate.price)missing.push('ORIGINAL_BASIS_REPRODUCTION_MISMATCH');
 if(missing.length)return {originalOwnerCoordinate:structuredClone(originalOwnerCoordinate),verifiedChartCoordinate:null,noDrawReasons:[...new Set(missing)],officialPlotEligible:false,executionPriceAuthority:false};
 return {originalOwnerCoordinate:structuredClone(originalOwnerCoordinate),verifiedChartCoordinate:{price:evidence.price,timestampUtc:evidence.timestampUtc,certificate:structuredClone(evidence)},noDrawReasons:[],officialPlotEligible:evidence.structuralApprovalVerified===true&&typeof evidence.engine22ApprovalRecord==='string'&&evidence.engine22ApprovalRecord.length>0,executionPriceAuthority:false};
}
