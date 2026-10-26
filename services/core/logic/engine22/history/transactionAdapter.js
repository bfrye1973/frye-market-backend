// Engine22E T1.2 - isolated SQL transaction adapter. No production connection.
export const ENGINE22_HISTORY_TX_SCHEMA="engine22.historyTransaction.v1";
const str=v=>typeof v==="string"&&v.trim().length>0;
export async function commitEngine22HistoryEvent({client,event,activation=null}={}){
 if(!client||typeof client.query!=="function")return {ok:false,reason:"CLIENT_REQUIRED"};
 if(!event||![event.eventId,event.idempotencyKey,event.payloadHash,event.instrumentContextId,event.degree,event.type,event.disposition].every(str))
   return {ok:false,reason:"VALID_EVENT_REQUIRED"};
 if(activation && (!str(activation.authorizationId)||!str(activation.targetCountId)||
   !Number.isSafeInteger(activation.expectedVersion)||activation.expectedVersion<0 ||
   activation.authorizationVerified!==true || event.authorizationId!==activation.authorizationId ||
   event.countId!==activation.targetCountId || event.disposition!=="APPROVED"))
   return {ok:false,reason:"VERIFIED_ENGINE22G_AUTHORIZATION_REQUIRED"};
 await client.query("BEGIN");
 try {
   const dup=await client.query("SELECT event_id,payload_hash FROM engine22_wave_events WHERE idempotency_key=$1 FOR UPDATE",[event.idempotencyKey]);
   if(dup.rows?.length){
     if(dup.rows[0].payload_hash!==event.payloadHash)throw new Error("IDEMPOTENCY_CONFLICT");
     await client.query("COMMIT");
     return {ok:true,status:"DUPLICATE",changed:false};
   }
   if(activation){
     const p=await client.query("SELECT pointer_version FROM engine22_wave_active_pointers WHERE instrument_context_id=$1 AND degree=$2 FOR UPDATE",[event.instrumentContextId,event.degree]);
     if(!p.rows?.length || Number(p.rows[0].pointer_version)!==activation.expectedVersion)throw new Error("STALE_POINTER");
   }
   await client.query("INSERT INTO engine22_wave_events(event_id,instrument_context_id,degree,count_id,event_type,disposition,idempotency_key,payload_hash,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",[event.eventId,event.instrumentContextId,event.degree,event.countId??null,event.type,event.disposition,event.idempotencyKey,event.payloadHash,JSON.stringify(event.payload??{})]);
   if(activation){
     const u=await client.query("UPDATE engine22_wave_active_pointers SET active_count_id=$1,pointer_version=pointer_version+1 WHERE instrument_context_id=$2 AND degree=$3 AND pointer_version=$4",[activation.targetCountId,event.instrumentContextId,event.degree,activation.expectedVersion]);
     if(u.rowCount!==1)throw new Error("CAS_CONFLICT");
   }
   await client.query("COMMIT");
   return {ok:true,status:"COMMITTED",changed:Boolean(activation)};
 }catch(e){try{await client.query("ROLLBACK");}catch{}return {ok:false,status:"REJECTED",reason:e.message,changed:false};}
}
