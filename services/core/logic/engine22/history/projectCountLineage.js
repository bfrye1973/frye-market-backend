// Engine22E T1.3 - deterministic historical count-lineage projection.
// Pure/research only: no live store writes, 22G authorization, or count selection.
// Micro V2 original count IDs must be preserved verbatim during later migrations.
export const ENGINE22_COUNT_LINEAGE_SCHEMA="engine22.countLineageReadOnly.v1";
const DEGREES=new Set(["INTRADAY_SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]);
const str=x=>typeof x==="string"&&x.trim().length>0;
const stamp=x=>str(x)&&/(?:Z|[+-]\d{2}:\d{2})$/i.test(x)&&Number.isFinite(Date.parse(x));
const fail=(reason,eventId=null)=>({ok:false,reason,eventId,counts:[],eventsAccepted:0,shadowOnly:true,noExecution:true});
const synthetic=x=>/^ES-V3-BASELINE-/i.test(x);
const ALLOWED=new Set(["COUNT_IMPORTED","COUNT_REVISED","COUNT_SUPERSEDED","OBSERVATION"]);
export function projectEngine22CountLineage({events=[],instrumentContextId=null,degree=null}={}){
 if(!str(instrumentContextId)||!DEGREES.has(degree)||!Array.isArray(events))
  return fail("INSTRUMENT_DEGREE_AND_EVENTS_REQUIRED");
 const counts=new Map(),seen=new Map();
 let prior=-Infinity;
 for(const event of events){
  const id=event?.eventId;
  if(!str(id)||!str(event.countId)||!str(event.idempotencyKey)||
     !stamp(event.occurredAt)||!ALLOWED.has(event.type)||
     event.instrumentContextId!==instrumentContextId||event.degree!==degree)
    return fail("INVALID_LINEAGE_EVENT",id??null);
  const now=Date.parse(event.occurredAt);
  if(now<prior)return fail("OUT_OF_ORDER_EVENT",id);
  prior=now;
  if(synthetic(event.countId))return fail("SYNTHETIC_BASELINE_NOT_HISTORICAL_PROOF",id);
  const fingerprint=JSON.stringify([event.eventId,event.type,event.countId,event.revision,event.occurredAt,event.parentCountId??null,event.sourceEventId??null]);
  if(seen.has(event.idempotencyKey)){
   if(seen.get(event.idempotencyKey)!==fingerprint)return fail("IDEMPOTENCY_CONFLICT",id);
   continue;
  }
  seen.set(event.idempotencyKey,fingerprint);
  const existing=counts.get(event.countId);
  if(event.type==="COUNT_IMPORTED"){
   if(existing)return fail("DUPLICATE_COUNT_IMPORT",id);
   if(event.revision!==0)return fail("IMPORTED_COUNT_REVISION_MUST_START_AT_ZERO",id);
   if(event.parentCountId && (!str(event.parentCountId) || event.parentCountId===event.countId))
    return fail("INVALID_PARENT_COUNT_ID",id);
   counts.set(event.countId,{countId:event.countId,degree,revision:0,
     parentCountId:event.parentCountId??null,originEventId:id,provenance:event.provenance??"UNRESOLVED",
     superseded:false,lastEventId:id,observations:0});
  }else{
   if(!existing)return fail("UNKNOWN_COUNT_ID",id);
   if(event.type==="COUNT_REVISED"){
    if(existing.superseded)return fail("SUPERSEDED_COUNT_REVISION_BLOCKED",id);
    if(event.revision!==existing.revision+1)return fail("REVISION_GAP_OR_REWRITE",id);
    existing.revision=event.revision;
   }else if(event.type==="COUNT_SUPERSEDED"){
    if(existing.superseded||event.revision!==existing.revision)
     return fail("INVALID_SUPERSESSION_REVISION",id);
    existing.superseded=true;
   }else if(event.type==="OBSERVATION"){
    if(event.revision!==existing.revision)return fail("OBSERVATION_REVISION_MISMATCH",id);
    existing.observations++;
   }
   existing.lastEventId=id;
  }
 }
 return {ok:true,schema:ENGINE22_COUNT_LINEAGE_SCHEMA,instrumentContextId,degree,
  counts:[...counts.values()].map(x=>({...x})),eventsAccepted:seen.size,
  activeCountId:null,activeCountSelectionAuthorized:false,
  noExecution:true,noPermissionCreated:true,shadowOnly:true};
}
