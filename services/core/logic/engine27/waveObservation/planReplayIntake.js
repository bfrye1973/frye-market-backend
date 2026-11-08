// Engine27 V6 Replay intake planner. Pure, read-only and safe to resume after restart.
// Do not advance a cursor past a failed file; no synthetic Replay or hashes.
const dateOK=d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+"T00:00:00Z"));
const hhmmOK=t=>typeof t==="string"&&/^([01]\d|2[0-3])[0-5]\d$/.test(t);
export function planReplayIntake({date,times=[],processed=[],maxBatch=120}={}){
 if(!dateOK(date)||!Array.isArray(times)||!Array.isArray(processed)||
  !Number.isInteger(maxBatch)||maxBatch<1||maxBatch>500)
  return {ok:false,reason:"INVALID_REPLAY_INTAKE_ARGUMENTS",items:[]};
 if(times.some(t=>!hhmmOK(t)))return {ok:false,reason:"INVALID_REPLAY_TIME",items:[]};
 const done=new Set(processed);
 const discovered=[...new Set(times)].sort().map(time=>({date,time,
  sourceReplayPath:`/var/data/replay/es/${date}/${time}.json`,key:`${date}/${time}`}));
 const remaining=discovered.filter(x=>!done.has(x.key));
 return {ok:true,items:remaining.slice(0,maxBatch),remaining:remaining.length,
  hasMore:remaining.length>maxBatch,duplicatesInListing:times.length-discovered.length,
  snapshotFilesNeverRecreated:true,noExecution:true};
}
// A successful source read is insufficient. Mark processed only after a durable
// event write OR a source-grounded no-change acknowledgment recorded by the consumer.
export function verifyReplayIntakeReceipt({item,sourceReplay,writeResult}={}){
 if(!item||sourceReplay?.path!==item.sourceReplayPath||
   sourceReplay?.date!==item.date||sourceReplay?.time!==item.time||
   sourceReplay?.hashBasis!=="ORIGINAL_REPLAY_FILE_BYTES"||
   !/^[a-f0-9]{64}$/.test(sourceReplay?.sha256??""))
  return {acknowledged:false,reason:"RAW_REPLAY_IDENTITY_UNVERIFIED"};
 if(writeResult?.ok!==true||!Number.isInteger(writeResult.stored)||
  !Number.isInteger(writeResult.duplicates)||writeResult.stored<0||writeResult.duplicates<0)
  return {acknowledged:false,reason:"DURABLE_WRITE_NOT_CONFIRMED"};
 if(writeResult.stored+writeResult.duplicates!==7)
  return {acknowledged:false,reason:"INCOMPLETE_SEVEN_DEGREE_DELIVERY"};
 return {acknowledged:true,key:item.key,sha256:sourceReplay.sha256,
  reason:"SEVEN_DEGREE_JOURNAL_WRITE_ACKNOWLEDGED"};
}
