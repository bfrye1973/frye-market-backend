// Engine 22 integrated observational pipeline: A+B -> C/D -> F -> G/H previews.
// Pure and independent of the live snapshot pipeline. No history writes or count activation.
import {buildEngine22ABRecognitionShadow} from "../recognition/buildWaveRecognitionShadow.js";
import {buildEngine22FibEvidenceShadow} from "../fibonacci/buildFibEvidenceShadow.js";
import {observeEngine22ReviewBoundary} from "../invalidations/observeBoundaryShadow.js";
import {evaluateEngine22CompletionWatch} from "../completion/evaluateCompletionWatch.js";
import {proposeEngine22TransitionShadow} from "../transitions/proposeTransitionShadow.js";
import {buildEngine22CanonicalPublicationPreview} from "../publication/buildPublicationPreview.js";

export const ENGINE22_INTEGRATION_SHADOW_SCHEMA="engine22.integratedObservation.v1";
const unavailable=(code)=>({available:false,reasonCodes:[code],shadowOnly:true,noExecution:true});
const isRecord=x=>x && typeof x==="object"&&!Array.isArray(x);

export function buildEngine22IntegratedObservationShadow({
 degree=null,ownerCount=null,bars=[],timeframe=null,left=2,right=2,
 expectedSource=null,alternatives=[],canonical=null,reviewRule=null,
 targetObservation=null,completionCandidate=null,previousCompletion=null,
 transitionEvidence=null,legacyPacket=null,sevenDegreeRecords=null,
}={}){
 const recognition=buildEngine22ABRecognitionShadow({
   degree,ownerCount,bars,timeframe,left,right,expectedSource,alternatives});
 const countId=recognition.structure?.workingCount?.countId??null;
 const idReady=typeof countId==="string" && countId.length>0 &&
   !/^ES-V3-BASELINE-/i.test(countId);
 const fib=canonical!==null && recognition.available ?
   buildEngine22FibEvidenceShadow({canonical,degree,bars}) :
   unavailable("CANONICAL_FIB_SOURCE_NOT_PROVIDED");
 const reviewed=idReady && isRecord(reviewRule) ?
   observeEngine22ReviewBoundary({countId,rule:reviewRule,bars}):
   unavailable("COUNT_SCOPED_REVIEW_NOT_PROVIDED");
 // Only an actual completed OHLC touch from the same count and source bars
 // may become an internal completion-watch input.
 const touchedFromFib=fib.available && fib.countId===countId ?
   fib.levels.find(x=>x.status==="TOUCHED" && typeof x.evidenceBarId==="string") : null;
 const evidenceFromFib=touchedFromFib ? {
   countId,levelKey:touchedFromFib.key,touched:true,sourceBarId:touchedFromFib.evidenceBarId,
 }:null;
 const candidateEvidence=isRecord(completionCandidate)&&recognition.pivotEvidence?.available &&
   recognition.pivotEvidence.pivots.some(x=>x.sourceBarId===completionCandidate.sourceBarId &&
     x.side===completionCandidate.side &&
     x.price===completionCandidate.price) &&
   completionCandidate.countId===countId ? completionCandidate : null;
 const completion=idReady && recognition.available ?
   evaluateEngine22CompletionWatch({
     degreeState:{degreeId:degree,countId,lifecycle:ownerCount.lifecycle??"DEVELOPING",
       minimumReversalTicks:ownerCount.minimumReversalTicks??8,tickSize:ownerCount.tickSize??0.25},
     targetObservation:evidenceFromFib,
     candidate:candidateEvidence,bars,previous:previousCompletion,
   }):unavailable("VERIFIED_COUNT_ID_AND_RECOGNITION_REQUIRED");
 // In the first integration stage, do not infer a count promotion even when
 // evidence claims structural completion; G is observational only.
 const transition=isRecord(transitionEvidence)&&idReady && recognition.available &&
     ownerCount.activeWave && ownerCount.countId===countId ?
   proposeEngine22TransitionShadow({degreeState:{
     ...ownerCount,degreeId:degree,countId},evidence:transitionEvidence}):
   unavailable("VERIFIED_TRANSITION_EVIDENCE_NOT_PROVIDED");
 const publication=isRecord(legacyPacket)&&isRecord(sevenDegreeRecords)?
   buildEngine22CanonicalPublicationPreview({legacy:legacyPacket,degreeRecords:sevenDegreeRecords}):
   unavailable("COMPLETE_SEVEN_DEGREE_PUBLICATION_INPUT_REQUIRED");
 return {
   schema:ENGINE22_INTEGRATION_SHADOW_SCHEMA,
   degree,sourceTimeframe:timeframe,workingCountId:countId,
   recognition,fibonacci:fib,reviewBoundary:reviewed,
   completionWatch:completion,transitionProposal:transition,publicationPreview:publication,
   available:recognition.available,
   reasonCodes:recognition.available?["OBSERVATIONAL_SHADOW_ONLY"]:["RECOGNITION_SOURCE_UNAVAILABLE"],
   noExecution:true,noPermissionCreated:true,noWaveCountMutation:true,
   activationAuthorized:false,publishAuthorized:false,shadowOnly:true,
 };
}
