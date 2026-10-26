import {HISTORICAL_VALIDATION_SCHEMA} from "../contracts/historicalValidation.v1.js";
const timestamp=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const denied=(reason)=>({schema:HISTORICAL_VALIDATION_SCHEMA,mode:"READ_ONLY_REPLAY",available:false,state:"UNAVAILABLE",observations:[],outcomes:[],sampleSize:0,statisticalConfidence:"NOT_CALIBRATED",reasonCodes:[reason],noPredictionRewrite:true,noExecution:true,noJournalWrite:true});
export function evaluateHistoricalReplay({snapshots=null,predictions=null,cutoff=null,outcomes=null}={}){
 const cut=timestamp(cutoff);
 if(cut===null || !Array.isArray(snapshots) || !Array.isArray(predictions)||!Array.isArray(outcomes))return denied("REPLAY_INPUT_OR_CUTOFF_UNAVAILABLE");
 const normalized=[];
 let previous=-Infinity;
 for(const s of snapshots){
  const at=timestamp(s?.snapshotTime??s?.now);
  if(at===null||at<=previous||s?.symbol!=="ES")return denied("REPLAY_SNAPSHOT_TIME_OR_SYMBOL_INVALID");
  if(at>cut)return denied("REPLAY_FUTURE_SNAPSHOT_LEAK");
  previous=at;
  normalized.push({at,snapshotTime:new Date(at).toISOString(),symbol:"ES"});
 }
 if(!normalized.length)return denied("REPLAY_SNAPSHOTS_UNAVAILABLE");
 const predictionIds=new Set();
 const events=[];
 for(const p of predictions){
  const at=timestamp(p?.predictedAt),source=timestamp(p?.evidenceAsOf);
  if(!p?.id||predictionIds.has(p.id)||at===null||source===null||at>cut||source>at||!["UP","DOWN"].includes(p?.direction)||!finite(p?.referencePrice))
    return denied("PREDICTION_PROVENANCE_OR_LOOKAHEAD_INVALID");
  if(!normalized.some(s=>s.at<=at))return denied("PREDICTION_HAS_NO_PRIOR_SNAPSHOT");
  predictionIds.add(p.id);
  events.push({id:p.id,predictedAt:p.predictedAt,evidenceAsOf:p.evidenceAsOf,direction:p.direction,referencePrice:p.referencePrice,immutable:true});
 }
 const results=[];
 for(const result of outcomes){
  const at=timestamp(result?.observedAt);
  if(!predictionIds.has(result?.predictionId)||at===null||at<=timestamp(predictions.find(p=>p.id===result.predictionId)?.predictedAt)||!finite(result?.observedPrice))
   return denied("OUTCOME_IDENTITY_OR_CHRONOLOGY_INVALID");
  // Future outcomes are only labels, never inputs to historical prediction reconstruction.
  results.push({predictionId:result.predictionId,observedAt:result.observedAt,observedPrice:result.observedPrice,postCutoff:at>cut});
 }
 return {schema:HISTORICAL_VALIDATION_SCHEMA,mode:"READ_ONLY_REPLAY",available:true,
  state:results.length?"OUTCOME_OBSERVED":events.length?"OUTCOME_PENDING":"REPLAY_QUALIFIED",
  observations:events,outcomes:results,sampleSize:events.length,statisticalConfidence:"NOT_CALIBRATED",
  sourceAuthority:{history:"ENGINE12_REPLAY",calibration:"ENGINE28A_READ_ONLY_LEARNING",positionOutcome:"ENGINE10_WHEN_VERIFIED"},
  reasonCodes:[],noPredictionRewrite:true,noExecution:true,noJournalWrite:true};
}
