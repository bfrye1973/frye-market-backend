import { hash } from './eligibility.js';
const pins=['seriesId','datasetVersion','priceBasis','contractLineageVersion','calendarVersion','alignmentVersion','closeConvention','identityVersion'];
export function checkConsumerCompatibility(history,live){const reasons=pins.filter(k=>typeof history?.[k]!=='string'||!history[k]||history[k]!==live?.[k]).map(k=>'PIN_MISMATCH:'+k);if(history?.completedSourceEvidence!==true)reasons.push('SOURCE_FINALITY_UNACCEPTED');if(history?.sourceAcceptance!=='MANAGER_ACCEPTED')reasons.push('SOURCE_ACCEPTANCE_PENDING');return {compatibleForProposedTest:reasons.length===0,reasons,structuralEligible:false,migrationAuthorized:false};}
export function reviewApprovedFibPreview({overlay,liveBasis}){
 const reasons=[];if(overlay?.owner!=='ENGINE22'||overlay?.approval!=='APPROVED')reasons.push('ENGINE22_APPROVAL_REQUIRED');
 if(!overlay?.sourceIdentity||!overlay?.priceBasis||overlay.priceBasis!==liveBasis?.priceBasis||overlay.contract!==liveBasis?.contract)reasons.push('APPROVED_PRICE_BASIS_UNRESOLVED');
 if(!Array.isArray(overlay?.levels)||overlay.levels.some(x=>!Number.isFinite(x.price)))reasons.push('INVALID_APPROVED_FIB');
 // Inspect an approved payload without calculating, snapping, adjusting or mounting any overlay.
 return {state:reasons.length?'PREVIEW_PLAN_BLOCKED':'PREVIEW_PLAN_COMPATIBLE_REQUIRES_ENGINE2B_AUTHORIZATION',reasons,protectedPayloadHash:overlay?hash(overlay):null,approvedPayload:overlay?structuredClone(overlay):null,renderingAuthorized:false,productionAuthorized:false};
}
