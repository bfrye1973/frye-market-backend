import { hash } from '../acceptanceResearchV1/eligibility.js';
const hasLevels=x=>!!x&&typeof x==='object'&&Object.keys(x).length>0;
const root='strategies["intraday_scalp@10m"].engine22WaveStrategy';
export function inspectPublishedFibSources(snapshot){
 const strategy=snapshot?.strategies?.['intraday_scalp@10m']?.engine22WaveStrategy;
 if(!strategy)return {state:'PUBLISHED_ENGINE22_SOURCE_UNAVAILABLE',degrees:[],renderingAuthorized:false};
 const degrees=[];
 for(const degree of ['primary','intermediate','minor','minute']){
  const state=strategy.degreeStates?.[degree],model=state?.activeFibModel;
  degrees.push({degree,exactPath:root+'.degreeStates.'+degree+'.activeFibModel',available:!!state,modelActive:model?.active===true,levels:model?.active===true?structuredClone(model.levels??model.displayLevels??null):null,
   sourceCountId:state?.countId??null,priceBasis:model?.priceBasis??state?.priceBasis??null,contract:model?.contract??state?.contract??null,protectedModelHash:model?hash(model):null,approvalState:'PUBLISHED_SOURCE_NOT_INDEPENDENT_APPROVAL_CERTIFICATE'});
 }
 const micro=strategy.currentWavelength?.degrees?.micro;
 degrees.push({degree:'micro',exactPath:root+'.currentWavelength.degrees.micro.levels',available:!!micro,modelActive:hasLevels(micro?.levels),levels:micro?.levels?structuredClone(micro.levels):null,
  sourceCountId:micro?.countId??null,priceBasis:micro?.priceBasis??null,contract:micro?.contract??null,protectedModelHash:micro?hash(micro):null,approvalState:'PUBLISHED_SOURCE_NOT_INDEPENDENT_APPROVAL_CERTIFICATE'});
 return {state:'PUBLISHED_ENGINE22_PATHS_OBSERVED',degrees,v3ShadowUsed:false,fallbackToSubminute:false,renderingAuthorized:false};
}
export function assessChartBasis({overlay,candles,approvalRecord=null}){
 const reasons=[];
 if(overlay?.snapshot?.authorityConflict===true)reasons.push('PUBLISHED_AUTHORITY_CONFLICT_REQUIRES_ENGINE22_REVIEW');
 if(overlay?.schemaVersion!=='engine2.chartOverlays.v1'||overlay?.symbol!=='ES')reasons.push('OVERLAY_SCHEMA_UNAVAILABLE');
 const chartContract=candles?.contract??candles?.resolvedContract??candles?.resolvedSymbol??candles?.ticker??candles?.meta?.contract??null;
 if(!chartContract)reasons.push('CHART_CONTRACT_UNAVAILABLE');
 if(overlay?.priceBasis==='ES_INDEX_POINTS')reasons.push('INDEX_POINT_UNITS_DO_NOT_IDENTIFY_PRICE_BASIS');
 const recordValid=approvalRecord?.owner==='ENGINE22'&&approvalRecord?.state==='MANAGER_APPROVED_PREVIEW_COMPATIBILITY'&&approvalRecord.recordId&&approvalRecord.sourcePayloadHash===hash(overlay)&&approvalRecord.contract===chartContract&&approvalRecord.priceBasis==='RAW_CONTRACT';
 if(!recordValid)reasons.push('ENGINE22_PREVIEW_BASIS_APPROVAL_REQUIRED');
 const missingCounts=Object.entries(overlay?.degrees??{}).filter(([,d])=>d.lines?.length&&!d.provenance?.sourceCountId).map(([k])=>k);
 return {state:recordValid&&reasons.every(x=>x==='INDEX_POINT_UNITS_DO_NOT_IDENTIFY_PRICE_BASIS')?'HANDOFF_COMPATIBILITY_RECORD_PRESENT_REQUIRES_ENGINE2B_AUTHORIZATION':'HANDOFF_COMPATIBILITY_UNRESOLVED',reasons,chartContract,missingCountIdentityDegrees:missingCounts,
  overlayPayloadHash:overlay?hash(overlay):null,renderingAuthorized:false,sourceAcceptanceGranted:false,engine22AuthorityChanged:false};
}
