import { hash } from '../acceptanceResearchV1/eligibility.js';
export const ROOT='strategies["intraday_scalp@10m"].engine22WaveStrategy';
const degrees=['submicro','micro','subminute','minute','minor','intermediate','primary'];
const fields=['activeWave','currentWave','status','stage','currentRead','direction','role','countId','sourceCountId','countIdentity','sequenceId','revision','datasetVersion','seriesId','priceBasis','contract','sourceTimestamp','timestamp','updatedAt','activeFibModel','marks','anchors','levels','invalidation','microSequence'];
export function selectFields(value,names=fields){return Object.fromEntries(names.map(k=>[k,Object.hasOwn(value??{},k)?structuredClone(value[k]):null]));}
export function timestampEvidence(value,path='$'){
 const result=[];
 const visit=(x,p,key)=>{
  if(x&&typeof x==='object'){for(const [k,v] of Object.entries(x))visit(v,p+(Array.isArray(x)?'['+k+']':'.'+k),k);return;}
  if(!/(timestamp|time|date|At|AtBarTime)$/i.test(key))return;
  if(x===null||x===undefined)return;
  let state='UNKNOWN_FORMAT';
  if(typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x))state='DATE_ONLY_NO_INTRADAY_PRECISION';
  else if(typeof x==='string'&&/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(x))state=/(Z|[+-]\d\d:\d\d)$/.test(x)?'EXPLICIT_OFFSET_TIMESTAMP':'TIMEZONE_NAIVE_OWNER_CONVENTION_REQUIRED';
  else if((typeof x==='number'&&Number.isFinite(x))||(typeof x==='string'&&/^\d+$/.test(x)))state='NUMERIC_UNIT_REQUIRES_FIELD_CONTRACT';
  result.push({path:p,originalValue:x,originalType:typeof x,state,normalizedValue:null,ownerConfirmation:'UNKNOWN'});
 };visit(value,path,'');return result;
}
export function captureEngine22Publications(snapshot){
 const s=snapshot?.strategies?.['intraday_scalp@10m']?.engine22WaveStrategy;
 if(!s)return {schemaVersion:'engine11.engine22-publication-capture.v1',state:'UNAVAILABLE',approval:'UNKNOWN',degrees:[],structuralEligible:false};
 const wavelength=s.currentWavelength??{}, captures=[];
 for(const degree of degrees){for(const [collection,value] of [['degreeStates',s.degreeStates?.[degree]],['currentWavelength.degrees',wavelength.degrees?.[degree]]]){
  const sourcePath=ROOT+'.'+collection+'.'+degree;
  captures.push({degree,sourcePath,available:!!value,selected:value?selectFields(value):null,publicationHash:value?hash(value):null,approval:'UNKNOWN',completeCountIdentity:'UNKNOWN',priceBasis:'UNKNOWN',timestampEvidence:value?timestampEvidence(selectFields(value),sourcePath):[]});
 }}
 return {schemaVersion:'engine11.engine22-publication-capture.v1',state:'CAPTURED_OWNER_PUBLICATIONS_NOT_APPROVAL',strategyPublicationHash:hash(s),snapshotMetadata:selectFields(snapshot,['symbol','generatedAt','sourceTimestamp','timestamp','updatedAt','schemaVersion']),strategyMetadata:selectFields(s,['sourceTimestamp','timestamp','updatedAt','schemaVersion','authority','sourceMode']),wavelengthMetadata:selectFields(wavelength,['canonicalWaveStateConflict','canonicalWaveStateConflictReason','sourceTimestamp','timestamp','updatedAt','sourceMode','authority']),degrees:captures,nonApprovalBranches:Object.keys(s).filter(k=>/v3|shadow/i.test(k)).map(k=>({sourcePath:ROOT+'.'+k,hash:hash(s[k]),state:'NOT_USED_AS_OFFICIAL_FIB_SOURCE'})),structuralEligible:false,renderingAuthorized:false};
}
export function comparePublications({core,previewSource,overlay,candles}){
 const comparisons=[];
 for(const degree of ['primary','intermediate','minor','minute']){
  const path=ROOT+'.degreeStates.'+degree, source=core.degrees?.find(x=>x.sourcePath===path),preview=previewSource?.degrees?.find(x=>x.sourcePath===path);
  const model=source?.selected?.activeFibModel, levels=model?.active===true?(model.levels??model.displayLevels):null;
  for(const line of overlay?.degrees?.[degree]?.lines??[]){const raw=levels?.[line.key];const price=raw&&typeof raw==='object'?raw.price:raw;
   comparisons.push({degree,lineId:line.id,publishedPrice:line.price,originalSourceValue:price??null,actualSourcePath:path+'.activeFibModel.'+(model?.levels?'levels':'displayLevels')+'.'+line.key,emittedSourcePath:line.sourcePath??null,state:price===undefined||price===null?'SOURCE_VALUE_UNAVAILABLE':Number(price)===line.price?'NUMERIC_VALUE_MATCH_NOT_AUTHORITY_APPROVAL':'VALUE_MISMATCH',officialApproval:'UNKNOWN'});
  }
  if(source?.available&&preview?.available)comparisons.push({degree,state:source.publicationHash===preview.publicationHash?'OWNER_PUBLICATION_HASH_MATCH':'OWNER_PUBLICATION_HASH_DIFFERENT_CAPTURE_OR_CACHE',corePublicationHash:source.publicationHash,previewPublicationHash:preview.publicationHash,officialApproval:'UNKNOWN'});
 }
 const flag=previewSource?.wavelengthMetadata?.canonicalWaveStateConflict;
 return {schemaVersion:'engine11.final-compatibility-comparison.v1',captureConsistency:'INDEPENDENT_HTTP_CAPTURES_NOT_ATOMIC',comparisons,conflict:{emitted:overlay?.snapshot?.authorityConflict??null,exactSourcePath:ROOT+'.currentWavelength.canonicalWaveStateConflict',sourceValue:flag??null,state:typeof flag==='boolean'&&flag===overlay?.snapshot?.authorityConflict?'FLAG_ORIGIN_MATCH_NOT_STRUCTURAL_RESOLUTION':'UNKNOWN_OR_CAPTURE_DIFFERENCE'},chart:{resolvedSymbol:candles?.resolvedSymbol??null,requestedSymbol:candles?.requestedSymbol??null,resolution:candles?.resolution??null,resolverRule:candles?.resolver?.selectionRule??null,fullYearContractIdentity:'UNKNOWN',priceBasisRelativeToApprovedFib:'UNKNOWN'},overlayUnits:overlay?.priceBasis??null,officialCountIdentity:'UNKNOWN',approval:'UNKNOWN',renderingAuthorized:false,canonicalEligible:false};
}
