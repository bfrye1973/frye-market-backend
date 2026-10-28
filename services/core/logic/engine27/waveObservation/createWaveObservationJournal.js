// Engine27 V6 append-only observation journal. Isolated research module: not wired into production.
// Engine22 is the only wave authority; never synthesize missing history/approvals.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {readAuthorizedWorkingStructure, DEGREE_ORDER} from "../v2/readAuthorizedWorkingStructure.js";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const recordSchema = "engine27.waveObservation.v1";
const physicalContract = value => typeof value === "string" && /^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(value) ? value : null;
const clone = value => JSON.parse(JSON.stringify(value));

export function projectWaveObservation(snapshot, {observedAt, physicalEsContract=null, marketEvidence=null, zoneContext=null, reactionEvidence=null, participationEvidence=null}={}) {
  const observed = timestamp(observedAt);
  if (!observed) return {ok:false,reason:"OBSERVATION_TIME_REQUIRED",events:[]};
  const auth = readAuthorizedWorkingStructure(snapshot);
  if (!auth.available) return {ok:false,reason:auth.reasonCode,events:[]};
  const p = auth.publication;
  const degrees = DEGREE_ORDER.map(degree => {
    const m = p.degrees[degree];
    // No fallback to legacy count, and no invented publication/approval timestamps.
    return {
      degree,activeWave:m.activeWave,direction:m.direction,stage:m.stage??null,
      parentDegree:m.parentDegree??null,parentWave:m.parentWave??null,
      modelVersion:m.modelVersion??null,modelRevision:m.modelRevision??null,
      countId:m.countId??null,sourcePath:m.sourcePath??null,selectionRevision:p.publicationRevision??null,
      selectionStatus:m.selectionStatus??null,ownerApprovalReference:m.ownerApprovalReference??null,
      approvedAt:timestamp(m.approvedAt),effectiveAt:timestamp(m.effectiveAt),priceEventAt:timestamp(m.priceEventAt),
      anchors:m.anchors??null,levels:clone(m.levels??[]),review:clone(m.review??null),
      officialInvalidation:clone(m.officialInvalidation??null),completionConfirmed:m.completionConfirmed===true,
      previousModelVersion:m.previousModelVersion??null
    };
  });
  const sourceTime = timestamp(p.publishedAt);
  return {ok:true,reason:null,source:{
    schema:p.schema,modelFingerprint:p.modelFingerprint,evidenceFingerprint:p.evidenceFingerprint??null,
    publicationId:p.publicationId??null,publicationTime:sourceTime,
    selectionApprovalReference:p.selectionApprovalReference??null,
    pointInTimeAsOfAvailable:p.pointInTimeAsOfAvailable===true,
    snapshotTime:timestamp(snapshot?.now)??timestamp(snapshot?.ts)??null
  },observedAt:observed,physicalEsContract:physicalContract(physicalEsContract),
  // Unknown is explicitly unknown; optional evidence cannot be backfilled into prior records.
  marketEvidence:marketEvidence?clone(marketEvidence):null,
  zoneContext:zoneContext?clone(zoneContext):null,
  reactionEvidence:reactionEvidence?clone(reactionEvidence):null,
  participationEvidence:participationEvidence?clone(participationEvidence):null,degrees};
}

export function createWaveObservationJournal({root="/var/data/replay/engine27/wave-observations"}={}) {
  const directory=path.join(root,"events"), lock=path.join(root,".writer-lock");
  function existing() {
    if(!fs.existsSync(directory))return [];
    return fs.readdirSync(directory).filter(x=>/^\\d{13}-[a-f0-9]{64}\\.json$/.test(x))
      .sort().map(name=>JSON.parse(fs.readFileSync(path.join(directory,name),"utf8")));
  }
  function append(snapshot,options={}) {
    const projected=projectWaveObservation(snapshot,options);
    if(!projected.ok)return {ok:false,reason:projected.reason,stored:0,duplicates:0};
    fs.mkdirSync(directory,{recursive:true});
    try {fs.mkdirSync(lock);} catch(e) {
      if(e?.code==="EEXIST")return {ok:false,reason:"WAVE_JOURNAL_WRITER_BUSY",stored:0,duplicates:0};
      throw e;
    }
    let stored=0, duplicates=0;
    try {
      const prior=new Map();
      for(const old of existing())if(DEGREE_ORDER.includes(old.degree))prior.set(old.degree,old);
      for(const wave of projected.degrees) {
        const contents={wave,physicalEsContract:projected.physicalEsContract,
          marketEvidence:projected.marketEvidence,zoneContext:projected.zoneContext,
          reactionEvidence:projected.reactionEvidence,participationEvidence:projected.participationEvidence};
        const stateHash=hash(contents);
        const previous=prior.get(wave.degree)??null;
        if(previous?.stateHash===stateHash){duplicates++;continue;}
        const observedMs=Date.parse(projected.observedAt);
        const lastMs=previous?Date.parse(previous.observedAt):null;
        if(lastMs!==null && observedMs<lastMs)return {ok:false,reason:"OUT_OF_ORDER_OBSERVATION",stored,duplicates};
        const eventId=hash({degree:wave.degree,stateHash,previousEventId:previous?.eventId??null});
        const event={schema:recordSchema,eventId,degree:wave.degree,
          eventType:previous?"WORKING_EVIDENCE_CHANGED":"INITIAL_VERIFIED_OBSERVATION",
          previousEventId:previous?.eventId??null,stateHash,observedAt:projected.observedAt,
          source:projected.source,...contents,noTradingAuthority:true,noWaveAuthority:true};
        const filename=String(observedMs).padStart(13,"0")+"-"+eventId+".json";
        const target=path.join(directory,filename), tmp=target+".pending";
        // A complete, fsynced temp is atomically linked into the immutable event namespace.
        const fd=fs.openSync(tmp,"wx");
        try {fs.writeFileSync(fd,JSON.stringify(event)+"\n");fs.fsyncSync(fd);}
        finally {fs.closeSync(fd);}
        try{fs.linkSync(tmp,target);}catch(e){if(e?.code!=="EEXIST")throw e;}
        finally{fs.unlinkSync(tmp);}
        const dirfd=fs.openSync(directory,"r");
        try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
        prior.set(wave.degree,event);stored++;
      }
      return {ok:true,stored,duplicates,reason:null};
    } finally {fs.rmdirSync(lock);}
  }
  return Object.freeze({append,readEvents:()=>existing(),storagePath:directory,
    retention:"PERMANENT_UNTIL_EXPLICIT_OWNER_AUTHORIZED_ARCHIVE_MIGRATION"});
}
