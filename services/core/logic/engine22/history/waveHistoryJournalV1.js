import {createHash} from "node:crypto";
import {openSync,closeSync,readFileSync,writeSync,fsyncSync,mkdirSync,existsSync,unlinkSync} from "node:fs";
import {join} from "node:path";
import {replayNodeIdentityEvents} from "./nodeIdentityLedgerV1.js";

const DEGREE_ORDER=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const digest=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const clone=x=>structuredClone(x);
const semanticHash=content=>digest({...content,publishedAt:null,sourceSnapshotId:null});
// Node events are included in the SAME immutable journal revision, not a second store.
// Preserve the original hash for legacy publication-only records.
const revisionHash=(content,nodeEvents=[])=>nodeEvents.length
 ?digest({observationHash:semanticHash(content),nodeEvents}):semanticHash(content);
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
  publishedAt:authority.publishedAt??null,
  ownerApprovedAt:authority.approvedAt??null,sourceSnapshotId,degreeOrder:DEGREE_ORDER,
  degrees,noExecution:true,historicalAsOfSupported:false};
 return {ok:true,content,contentHash:semanticHash(content),observedAt:timestamp};
}

// Standalone append-only durable-file implementation. The caller MUST mount a persistent
// volume and ensure a single writer per journal path; otherwise fail deployment acceptance.
// Each revision is retained; repeated identical content is not duplicated.
export function appendWaveHistoryObservation({directory,observation,nodeEvents=[]}={}){
 if(!Array.isArray(nodeEvents))throw Error("INVALID_NODE_EVENT_BATCH");
 const proposedNodeEvents=structuredClone(nodeEvents);
 if(!directory||observation?.ok!==true)throw Error("VALID_JOURNAL_DIRECTORY_AND_OBSERVATION_REQUIRED");
 mkdirSync(directory,{recursive:true});
 const lock=join(directory,".writer.lock"),file=join(directory,"wave-history.v1.jsonl");
 let lockFd;
 try{lockFd=openSync(lock,"wx");}catch{throw Error("JOURNAL_WRITER_LOCK_UNAVAILABLE");}
 try{
  // Validate the complete existing hash chain before any append.
  // A malformed/truncated last record must never be silently discarded.
  const events=readWaveHistory({directory});
  const last=events.at(-1)??null;
  // Verify all prior node records plus the proposed batch BEFORE touching the journal file.
  const priorNodes=events.flatMap(e=>e.nodeEvents??[]);
  replayNodeIdentityEvents([...priorNodes,...proposedNodeEvents]);
  const nextHash=revisionHash(observation.content,proposedNodeEvents);
  if(last?.contentHash===nextHash)return {status:"UNCHANGED",revision:last.revision,contentHash:last.contentHash};
  const event={schema:"engine22.waveHistoryEvent.v1",revision:(last?.revision??0)+1,
   previousEventHash:last?.eventHash??null,observedAt:observation.observedAt,
   eventType:last?"WAVE_PUBLICATION_CHANGE":"INITIAL_OBSERVATION_NOT_HISTORICAL_RECONSTRUCTION",
   contentHash:nextHash,content:observation.content};
  if(proposedNodeEvents.length)event.nodeEvents=proposedNodeEvents;
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
 const raw=readFileSync(file,"utf8");
 if(raw.length&&!raw.endsWith("\n"))throw Error("JOURNAL_INTERRUPTED_WRITE");
 const lines=raw.split("\n").slice(0,-1);
 if(lines.some(line=>!line.trim()))throw Error("JOURNAL_MALFORMED_RECORD");
 let events;
 try{events=lines.map(JSON.parse);}catch{throw Error("JOURNAL_MALFORMED_RECORD");}
 let previous=null;
 for(let i=0;i<events.length;i++){
  const e=events[i],{eventHash,...body}=e;
  if(e.schema!=="engine22.waveHistoryEvent.v1"||e.revision!==i+1||e.previousEventHash!==previous||digest(body)!==eventHash||revisionHash(e.content,e.nodeEvents??[])!==e.contentHash)
   throw Error("JOURNAL_INTEGRITY_FAILURE");
  previous=eventHash;
 }
 // Every read verifies node identity lineage as well as the journal hash chain.
 replayNodeIdentityEvents(events.flatMap(e=>e.nodeEvents??[]));
 return events;
}

export function pageWaveHistory({directory,afterRevision=0,limit=50}={}){
 if(!Number.isSafeInteger(afterRevision)||afterRevision<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
  throw Error("INVALID_HISTORY_PAGINATION");
 const events=readWaveHistory({directory});
 const items=events.filter(e=>e.revision>afterRevision).slice(0,limit);
 const nextRevision=items.at(-1)?.revision??afterRevision;
 return {schema:"engine22.waveHistoryPage.v1",items,nextRevision,
  hasMore:events.some(e=>e.revision>nextRevision),totalRevisions:events.length,readOnly:true};
}
