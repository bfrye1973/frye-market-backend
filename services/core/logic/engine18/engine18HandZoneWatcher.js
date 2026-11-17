// Engine18 supervised five-minute chart-effective HAND zone watcher.
// Safe-by-default: no active approval on stale/unavailable/unverified source.
// Externally injected durable append/read store, timer and source for CI/runtime.
import {normalizeChartHandZones,semanticZoneHash,ZONE_POLL_MS,digest} from './engine18HandZoneContext.js';
const iso=ms=>new Date(ms).toISOString();
const safeTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
export class Engine18HandZoneWatcher{
 constructor({fetchSource,store,approvedKinds=null,now=()=>Date.now(),
  schedule=(fn,ms)=>setInterval(fn,ms),cancel=clearInterval,
  timeoutMs=8000,maxSourceAgeMs=120000,onChange=()=>{},pollIntervalMs=ZONE_POLL_MS}={}){
  if(typeof fetchSource!=='function'||typeof store?.load!=='function'||
   typeof store?.append!=='function'||typeof now!=='function'||
   pollIntervalMs!==ZONE_POLL_MS||timeoutMs<100||timeoutMs>30000)
   throw Error('INVALID_HAND_ZONE_WATCH_CONFIG');
  this.fetchSource=fetchSource;this.store=store;this.approvedKinds=approvedKinds;
  this.now=now;this.schedule=schedule;this.cancel=cancel;this.onChange=onChange;
  this.timeoutMs=timeoutMs;this.maxSourceAgeMs=maxSourceAgeMs;this.pollIntervalMs=pollIntervalMs;
  this.versions=[];this.active=null;this.timer=null;this.busy=false;this.started=false;
  this.healthState={lastAttemptAt:null,lastSuccessAt:null,lastChangedAt:null,
   revision:null,sourceName:'ES_CHART_EFFECTIVE_STICKY',sourceAgeMs:null,
   stale:true,reason:'NOT_STARTED',lastGoodHash:null,changedCount:0,unchangedCount:0,
   failureCount:0};
 }
 health(){return Object.freeze({...this.healthState,activeCount:this.active?.zones.length??0,
  historyCount:this.versions.length,pollIntervalMs:this.pollIntervalMs,inFlight:this.busy});}
 getCurrent(){return this.healthState.stale?null:this.active;}
 getVersions(){return this.versions.map(x=>structuredClone(x));}
 async start(){
  if(this.started)throw Error('WATCH_ALREADY_STARTED');
  const loaded=await this.store.load();
  if(!Array.isArray(loaded))throw Error('DURABLE_HISTORY_INVALID');
  let prev=null,time=-Infinity;
  for(const x of loaded){
   if(!x||!safeTime(x.firstObservedAt)||!x.hash||x.hash!==semanticZoneHash(x)||
    Date.parse(x.firstObservedAt)<time||x.previousHash!==(prev?.hash??null)||
    (prev&&x.hash===prev.hash))throw Error('DURABLE_HISTORY_TAMPERED');
   time=Date.parse(x.firstObservedAt);prev=x;
  }
  this.versions=loaded.map(x=>structuredClone(x));
  this.active=null;this.started=true;
  this.healthState.stale=true;this.healthState.reason='RECOVERED_AWAITING_FRESH_SOURCE';
  try{await this.poll();}finally{
   if(this.started)this.timer=this.schedule(()=>{void this.poll().catch(()=>{});},this.pollIntervalMs);
  }
  return this.health();
 }
 stop(){this.started=false;if(this.timer!==null)this.cancel(this.timer);this.timer=null;
  this.active=null;this.healthState.stale=true;this.healthState.reason='STOPPED';
 }
 async poll(){
  if(!this.started)return {status:'STOPPED'};
  if(this.busy)return {status:'SKIPPED_OVERLAP'};
  this.busy=true;const began=this.now();
  this.healthState.lastAttemptAt=iso(began);
  try{
   // Bounded attempts and backoff, with injected fetch abort support.
   let data,err;
   for(let attempt=0;attempt<2;attempt++){
    try{data=await this.fetchSource({timeoutMs:this.timeoutMs,attempt});err=null;break;}
    catch(e){err=e;if(attempt===0)await Promise.resolve();}
   }
   if(err)throw Error('SOURCE_UNAVAILABLE');
   if(!data?.meta||!safeTime(data.meta.servedAt))
    throw Error('SOURCE_FRESHNESS_UNVERIFIED');
   const age=this.now()-Date.parse(data.meta.servedAt);
   this.healthState.sourceAgeMs=age;
   if(age<0||age>this.maxSourceAgeMs)throw Error('SOURCE_STALE');
   const model=normalizeChartHandZones(data,{approvedKinds:this.approvedKinds});
   const prior=this.versions.at(-1);
   if(prior){
    if(Date.parse(model.sourceUpdatedAt)<Date.parse(prior.sourceUpdatedAt))
     throw Error('SOURCE_REVISION_REGRESSION');
    if(model.sourceRevision===prior.sourceRevision&&semanticZoneHash(model)!==prior.hash)
     throw Error('SOURCE_REVISION_CONTENT_CONFLICT');
   }
   const h=semanticZoneHash(model);
   if(prior?.hash===h){
    this.active=prior;this.healthState.unchangedCount++;
    this.healthState.revision=model.sourceRevision;
    this.healthState.lastGoodHash=h;
    this.healthState.lastSuccessAt=iso(this.now());
    this.healthState.stale=false;this.healthState.reason=null;
    return {status:'UNCHANGED',hash:h};
   }
   const firstObservedAt=iso(this.now());
   const snapshot={...model,hash:h,previousHash:prior?.hash??null,firstObservedAt};
   // Appends immutable history durably BEFORE exposing the changed active snapshot.
   await this.store.append(snapshot);
   this.versions.push(structuredClone(snapshot));this.active=snapshot;
   this.healthState.lastChangedAt=firstObservedAt;
   this.healthState.lastSuccessAt=firstObservedAt;
   this.healthState.lastGoodHash=h;this.healthState.changedCount++;
   this.healthState.revision=model.sourceRevision;this.healthState.stale=false;
   this.healthState.reason=null;
   try{this.onChange(structuredClone(snapshot));}catch{}
   return {status:'CHANGED',hash:h};
  }catch(e){
   this.active=null;this.healthState.stale=true;
   this.healthState.reason=String(e.message||'SOURCE_INVALID').slice(0,100);
   this.healthState.failureCount++;
   return {status:'STALE',reason:this.healthState.reason};
  }finally{this.busy=false;}
 }
}
export class Engine18MemoryZoneHistory{
 constructor(versions=[]){this.versions=structuredClone(versions);this.writes=0;}
 async load(){return structuredClone(this.versions);}
 async append(s){if(this.versions.some(x=>x.hash===s.hash&&x.firstObservedAt===s.firstObservedAt))
  throw Error('VERSION_ALREADY_EXISTS');this.versions.push(structuredClone(s));this.writes++;}
}
