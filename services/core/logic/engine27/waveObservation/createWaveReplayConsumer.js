// Engine27 V6 isolated, source-verified Replay-to-journal ingestion.
// Production activation is intentionally absent. Original bytes are mandatory for SHA-256.
import {createHash} from "node:crypto";
import {planReplayIntake} from "./planReplayIntake.js";
import {createReplayIntakeLedger} from "./createReplayIntakeLedger.js";
import {createWaveObservationJournal} from "./createWaveObservationJournal.js";
import {recoverCommittedWavePending} from "./recoverCommittedWavePending.js";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
export function createWaveReplayConsumer({root,readOriginalReplay,onWaveEvidence=null}={}){
 if(typeof readOriginalReplay!=="function")throw Error("ORIGINAL_REPLAY_READER_REQUIRED");
 if(onWaveEvidence!==null&&typeof onWaveEvidence!=="function")throw Error("INVALID_EVIDENCE_CALLBACK");
 const journal=createWaveObservationJournal({root});
 const ledger=createReplayIntakeLedger({root});
 async function consumeDate({date,times,maxBatch=120,observedAt}={}){
  const recovery=recoverCommittedWavePending({root});
  if(!recovery.ok)return {ok:false,reason:recovery.reason,processed:0,blocked:null};
  const processed=ledger.processedFor(date);
  const plan=planReplayIntake({date,times,processed,maxBatch});
  if(!plan.ok)return {ok:false,reason:plan.reason,processed:0,blocked:null};
  let count=0;
  for(const item of plan.items){
   try{
    const source=await readOriginalReplay(item);
    if(!Buffer.isBuffer(source?.bytes))return {ok:false,reason:"ORIGINAL_REPLAY_BYTES_REQUIRED",processed:count,blocked:item.key};
    const snapshot=JSON.parse(source.bytes.toString("utf8"));
    if(snapshot?.schema!=="engine12.multiStrategyReplay.v1"||
      snapshot?.replayContract!=="CANONICAL_MULTI_STRATEGY_REPLAY"||
      typeof snapshot?.snapshotTime!=="string"||!Number.isFinite(Date.parse(snapshot.snapshotTime)))
      return {ok:false,reason:"CANONICAL_REPLAY_CONTRACT_UNVERIFIED",processed:count,blocked:item.key};
    const sourceReplay={date:item.date,time:item.time,path:item.sourceReplayPath,
      sha256:hash(source.bytes),snapshotTimeUtc:snapshot.snapshotTime,hashBasis:"ORIGINAL_REPLAY_FILE_BYTES"};
    // Original observation time and ingestion time are deliberately distinct.
    const stamp=observedAt??new Date().toISOString();
    const delivery=journal.append(snapshot,{observedAt:stamp,sourceReplay});
    if(!delivery.ok)return {ok:false,reason:delivery.reason,processed:count,blocked:item.key};
    // Optional source-qualified research enrichment must be durable before intake ACK.
    // A failed evidence append leaves the Replay key unacknowledged; retry after restart.
    if(onWaveEvidence){
     const evidence=await onWaveEvidence({snapshot,sourceReplay,observedAt:stamp,item});
     if(evidence?.ok!==true)return {ok:false,reason:evidence?.reason??"WAVE_EVIDENCE_NOT_DURABLE",processed:count,blocked:item.key};
    }
    const receipt=ledger.acknowledge({item,sourceReplay,writeResult:delivery,acknowledgedAt:stamp});
    if(!receipt.ok)return {ok:false,reason:receipt.reason,processed:count,blocked:item.key};
    count++;
   }catch(error){return {ok:false,reason:"REPLAY_INTAKE_SOURCE_OR_WRITE_FAILURE",errorClass:error?.name??"Error",processed:count,blocked:item.key};}
  }
  return {ok:true,processed:count,remaining:plan.remaining-count,hasMore:plan.hasMore,
   researchOnly:true,productionActivated:false};
 }
 return Object.freeze({consumeDate,readEvents:journal.readEvents,processedFor:ledger.processedFor});
}
