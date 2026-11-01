import {createHash} from "node:crypto";
import {openSync,closeSync,readFileSync,writeSync,fsyncSync,mkdirSync,existsSync,unlinkSync} from "node:fs";
import {join} from "node:path";

const DEGREE_ORDER=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const digest=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const clone=x=>structuredClone(x);
const semanticHash=content=>digest({...content,publishedAt:null,sourceSnapshotId:null});
const cleanTime=x=>typeof x==="string"&&!Number.isNaN(Date.parse(x))?x:null;
const validSource=x=>x?.schema==="engine22.authorizedWorkingStructure.v1"&&x?.mode==="READ_ONLY"&&x?.degrees&&typeof x.degrees==="object";
const get=(root,path)=>typeof path==="string"&&/^(currentWavelength|degreeStates)\.[a-zA-Z0-9_.]+$/.test(path)
 ?path.split(".").reduce((obj,k)=>obj?.[k],root):null;

// Never infer owner approval from price, timestamp, model status, or this journal.
// Capture existing authority and all available source model details, including alternatives.
export function buildWaveHistoryObservation({strategy,observedAt,sourceSnapshotId=null}={}){
 const authority=strategy?.authorizedWorkingStructure;
 if(!validSource(authority))return {ok:false,reason:"ENGINE22_AUTHORITY_UNAVAILABLE"};
 const timestamp=cleanTime(observedAt);
 if(!timestamp)return {ok:false,reason:"OBSERVATION_TIME_REQUIRED"};
 const degrees={};
 for(const degree of DEGREE_ORDER){
  const selected=authority.degrees?.[degree];
  const sourcePath=selected?.sourcePath??null;
  const model=get({currentWavelength:strategy.currentWavelength,degreeStates:strategy.degreeStates},sourcePath);
  const consistent=selected?.available===true&&model&&(!selected.modelVersion||model.version===selected.modelVersion)
    &&(!selected.activeWave||model.activeWave===selected.activeWave);
  degrees[degree]={
   available:Boolean(consistent),sourcePath,modelVersion:selected?.modelVersion??null,
   selection:clone(selected??null),sourceModel:consistent?clone(model):null,
   invalidation:clone(strategy?.sevenDegreeInvalidations?.degrees?.[degree]??null),
   reason:consistent?null:"SELECTED_MODEL_UNAVAILABLE_OR_CONFLICTING"
  };
 }
 const content={schema:"engine22.waveHistoryObservation.v1",symbol:strategy.symbol??"ES",
  selectionRevision:authority.publicationRevision??null,
  selectionApprovalReference:authority.selectionApprovalReference??null,
  modelFingerprint:authority.modelFingerprint??null,
  evidenceFingerprint:authority.evidenceFingerprint??null,
  publishedAt:authority.publishedAt??null,sourceSnapshotId,degreeOrder:DEGREE_ORDER,
  degrees,noExecution:true,historicalAsOfSupported:false};
 return {ok:true,content,contentHash:semanticHash(content),observedAt:timestamp};
}

// Standalone append-only durable-file implementation. The caller MUST mount a persistent
// volume and ensure a single writer per journal path; otherwise fail deployment acceptance.
// Each revision is retained; repeated identical content is not duplicated.
export function appendWaveHistoryObservation({directory,observation}={}){
 if(!directory||observation?.ok!==true)throw Error("VALID_JOURNAL_DIRECTORY_AND_OBSERVATION_REQUIRED");
 mkdirSync(directory,{recursive:true});
 const lock=join(directory,".writer.lock"),file=join(directory,"wave-history.v1.jsonl");
 let lockFd;
 try{lockFd=openSync(lock,"wx");}catch{throw Error("JOURNAL_WRITER_LOCK_UNAVAILABLE");}
 try{
  const lines=existsSync(file)?readFileSync(file,"utf8").split("\n").filter(Boolean):[];
  let last=null;
  for(const line of lines){const event=JSON.parse(line);if(event?.schema!=="engine22.waveHistoryEvent.v1"||!event?.contentHash)throw Error("JOURNAL_CORRUPT");last=event;}
  if(last?.contentHash===observation.contentHash)return {status:"UNCHANGED",revision:last.revision,contentHash:last.contentHash};
  const event={schema:"engine22.waveHistoryEvent.v1",revision:(last?.revision??0)+1,
   previousEventHash:last?.eventHash??null,observedAt:observation.observedAt,
   contentHash:observation.contentHash,content:observation.content};
  event.eventHash=digest(event);
  const fd=openSync(file,"a");
  try{writeSync(fd,JSON.stringify(event)+"\n");fsyncSync(fd);}finally{closeSync(fd);}
  return {status:"APPENDED",revision:event.revision,contentHash:event.contentHash,eventHash:event.eventHash};
 }finally{closeSync(lockFd);unlinkSync(lock);}
}
export function readWaveHistory({directory}={}){
 if(!directory)return [];
 const file=join(directory,"wave-history.v1.jsonl");
 if(!existsSync(file))return [];
 const events=readFileSync(file,"utf8").split("\n").filter(Boolean).map(JSON.parse);
 let previous=null;
 for(let i=0;i<events.length;i++){
  const e=events[i],{eventHash,...body}=e;
  if(e.schema!=="engine22.waveHistoryEvent.v1"||e.revision!==i+1||e.previousEventHash!==previous||digest(body)!==eventHash||semanticHash(e.content)!==e.contentHash)
   throw Error("JOURNAL_INTEGRITY_FAILURE");
  previous=eventHash;
 }
 return events;
}
