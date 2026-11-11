// Phase 5 S3-backed sealed-hour backup and immutable encrypted inventory.
// Synthetic/mock-endpoint tested only. Not wired to licensed market data.
// Restores require an independently pinned lastSeq to detect tail inventory loss.
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,statSync,
 mkdtempSync,rmSync,openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {Engine18S3PrivateStore} from './engine18S3PrivateStore.js';
import {scanEngine18ReplayBounded} from './engine18BoundedReplayScan.js';

const digest=b=>createHash('sha256').update(b).digest('hex');
const fileHash=async path=>{
 let bytes=0;const h=createHash('sha256');
 for await(const chunk of createReadStream(path,{highWaterMark:65536})){h.update(chunk);bytes+=chunk.length;}
 return {bytes,sha256:h.digest('hex')};
};
const walk=dir=>!existsSync(dir)?[]:readdirSync(dir,{withFileTypes:true})
 .flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
function durablyRename(src,dest){
 const fd=openSync(src,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(src,dest);
 const dir=openSync(dirname(dest),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
export class Engine18S3ArchiveCoordinator {
 constructor({root,store,reconcileIntervalMs=900000,now=()=>Date.now()}={}){
  if(typeof root!=='string'||!(store instanceof Engine18S3PrivateStore))throw Error('private S3 store and root required');
  this.root=resolve(root);this.store=store;this.prefix='engine18/inventory/v1/';
  this.inFlight=null;this.failures=0;this.lastSuccessAtMs=null;this.retries=0;
  this.pendingRotation=new Map();this.pendingRotationArchives=0;
  if(!Number.isSafeInteger(reconcileIntervalMs)||reconcileIntervalMs<1000||typeof now!=='function')throw Error('invalid inventory reconciliation policy');
  this.reconcileIntervalMs=reconcileIntervalMs;this.now=now;
  this.cachedInventory=null;this.lastFullReconciliationMs=null;
  this.fullReconciliations=0;this.cachedScans=0;
 }
 async inventory({expectedLastSeq=null,forceFull=true}={}){
  if(!forceFull&&expectedLastSeq===null&&this.cachedInventory&&
    this.now()-this.lastFullReconciliationMs<this.reconcileIntervalMs){
   this.cachedScans++;
   return this.cachedInventory;
  }
  const keys=await this.store.listObjectKeys(this.prefix);
  const entries=[];
  for(const key of keys){
   if(!/^engine18\/inventory\/v1\/\d{16}-\d{16}-[a-f0-9]{64}\.json$/.test(key))
    throw Error('invalid inventory object key');
   const entry=await this.store.readSmallEncryptedJson(key);
   if(entry.schema!=='engine18.s3.inventory.v1'||entry.keyId!==this.store.keyId||
      !Number.isSafeInteger(entry.firstSeq)||!Number.isSafeInteger(entry.lastSeq)||
      entry.firstSeq<1||entry.lastSeq<entry.firstSeq)throw Error('untrusted inventory entry');
   const hash=digest(Buffer.from(JSON.stringify(entry)));
   const keyTail=String(entry.firstSeq).padStart(16,'0')+'-'+String(entry.lastSeq).padStart(16,'0')+'-'+hash+'.json';
   if(!key.endsWith(keyTail))throw Error('inventory key/digest conflict');
   entries.push({...entry,entryHash:hash,key});
  }
  entries.sort((a,b)=>a.firstSeq-b.firstSeq);
  let last=0,prev=null;
  for(const entry of entries){
   if(entry.firstSeq!==last+1||entry.previousEntryHash!==prev)
    throw Error('independent S3 inventory sequence or hash-chain gap');
   last=entry.lastSeq;prev=entry.entryHash;
  }
  if(expectedLastSeq!==null&&last!==expectedLastSeq)throw Error('pinned independent inventory high-watermark mismatch');
  if(this.cachedInventory&&last<this.cachedInventory.lastSeq)
   throw Error('remote inventory regressed below previously verified high-watermark');
  if(this.cachedInventory&&last===this.cachedInventory.lastSeq&&prev!==this.cachedInventory.headHash)
   throw Error('remote inventory head changed for same acknowledged sequence');
  const snapshot={entries,lastSeq:last,headHash:prev,tailPinned:expectedLastSeq!==null};
  this.cachedInventory={...snapshot,tailPinned:false};
  this.lastFullReconciliationMs=this.now();this.fullReconciliations++;
  return snapshot;
 }
 async syncClosed(){
  if(this.inFlight)return this.inFlight;
  const work=this._syncClosed();
  this.inFlight=work;
  try{return await work;}
  catch{this.failures++;throw Error('private sealed-hour backup failed');}
  finally{this.inFlight=null;}
 }
 async _syncClosed(){
  let inventory=await this.inventory({forceFull:false}),added=0;
  const paths=walk(this.root).filter(x=>x.endsWith('.jsonl.gz'));
  const closed=[];this.pendingRotationArchives=0;
  for(const path of paths){
   if(!existsSync(path+'.manifest.json')){
    const original=path.replace(/\.jsonl\.gz$/,'.jsonl.open');
    // A renamed gzip can precede the manifest; a still-present source proves
    // finalization may be in progress. Do not read or upload unfinished files.
    // After a bounded grace interval, persistent unmanifested files fail closed.
    if(!existsSync(original))throw Error('unmanifested archive without original source requires recovery');
    const age=Math.max(0,Date.now()-statSync(path).mtimeMs);
    if(age>120000)throw Error('unmanifested archive stuck beyond rotation grace; recovery required');
    this.pendingRotation.set(path,Date.now());this.pendingRotationArchives++;
    continue;
   }
   this.pendingRotation.delete(path);
   const manifest=JSON.parse(readFileSync(path+'.manifest.json','utf8'));
   if(!Number.isSafeInteger(manifest.firstSeq)||!Number.isSafeInteger(manifest.lastSeq))
    throw Error('invalid archive sequence');
   closed.push({path,manifest});
  }
  closed.sort((a,b)=>a.manifest.firstSeq-b.manifest.firstSeq);
  for(const {path,manifest} of closed){
   const archiveId=relative(this.root,path);
   if(archiveId.startsWith('..')||!/^[-A-Za-z0-9_.\/]+$/.test(archiveId))throw Error('unsafe archive file');
   const sourceHash=await fileHash(path);
   if(sourceHash.sha256!==manifest.sha256||sourceHash.bytes!==manifest.bytes)
    throw Error('closed archive mutated after manifest');
   const manifestPath=path+'.manifest.json',manifestHash=await fileHash(manifestPath);
   if(manifest.lastSeq<=inventory.lastSeq){
    const recorded=inventory.entries.find(e=>e.firstSeq===manifest.firstSeq&&e.lastSeq===manifest.lastSeq);
    if(!recorded||recorded.archive.plainSha256!==sourceHash.sha256||
       recorded.manifest.plainSha256!==manifestHash.sha256)throw Error('acknowledged remote archive immutability violated');
    continue;
   }
   if(manifest.firstSeq!==inventory.lastSeq+1)throw Error('archive sequence not contiguous with remote inventory');
   const archiveKey='engine18/archives/'+archiveId;
   const archive=await this.store.uploadClosed({path,key:archiveKey,
    plaintextSha256:sourceHash.sha256,expectedSize:sourceHash.bytes});
   const manifestKey=archiveKey+'.manifest.json';
   const manifestReceipt=await this.store.uploadClosed({path:manifestPath,key:manifestKey,
    plaintextSha256:manifestHash.sha256,expectedSize:manifestHash.bytes});
   // Never publish inventory until *both* encrypted objects are verified.
   const entry={schema:'engine18.s3.inventory.v1',keyId:this.store.keyId,
    firstSeq:manifest.firstSeq,lastSeq:manifest.lastSeq,
    previousEntryHash:inventory.headHash,archive,manifest:manifestReceipt};
   const encoded=Buffer.from(JSON.stringify(entry)),entryHash=digest(encoded);
   const inventoryKey=this.prefix+String(entry.firstSeq).padStart(16,'0')+'-'+
    String(entry.lastSeq).padStart(16,'0')+'-'+entryHash+'.json';
   const directory=mkdtempSync(join(this.store.stagingRoot,'engine18-s3-inventory-'));
   try{
    const p=join(directory,'entry.json');writeFileSync(p,encoded,{mode:0o600});
    await this.store.uploadClosed({path:p,key:inventoryKey,
     plaintextSha256:entryHash,expectedSize:encoded.length});
   }finally{rmSync(directory,{recursive:true,force:true});}
   // Confirm only the new encrypted chain entry. Never re-download the entire
   // inventory for every closed hour; full listing is periodic and at startup.
   const confirmed=await this.store.readSmallEncryptedJson(inventoryKey);
   if(digest(Buffer.from(JSON.stringify(confirmed)))!==entryHash||
      confirmed.previousEntryHash!==inventory.headHash||confirmed.lastSeq!==entry.lastSeq)
    throw Error('new S3 inventory entry verification failed');
   const validated={...confirmed,entryHash,key:inventoryKey};
   inventory={entries:[...inventory.entries,validated],lastSeq:entry.lastSeq,
    headHash:entryHash,tailPinned:false};
   this.cachedInventory=inventory;
   added++;
   this.lastSuccessAtMs=Date.now();
  }
  return {added,remoteArchived:inventory.entries.length,lastSeq:inventory.lastSeq,headHash:inventory.headHash,pendingRotationArchives:this.pendingRotationArchives,fullReconciliations:this.fullReconciliations};
 }
 async restore({destination,expectedLastSeq}={}){
  if(typeof destination!=='string'||!Number.isSafeInteger(expectedLastSeq)||expectedLastSeq<0)
   throw Error('independent pinned high-watermark and destination required');
  const state=await this.inventory({expectedLastSeq});
  const dest=resolve(destination);
  if(existsSync(dest)&&readdirSync(dest).length)throw Error('restore requires empty private destination');
  mkdirSync(dest,{recursive:true,mode:0o700});
  for(const entry of state.entries){
   if(!entry.archive.key.startsWith('engine18/archives/'))throw Error('invalid remote archive source');
   const archiveId=entry.archive.key.replace(/^engine18\/archives\//,'');
   if(archiveId.includes('..')||archiveId.startsWith('/')||!/^[-A-Za-z0-9_.\/]+$/.test(archiveId))
    throw Error('unsafe restore target');
   const archivePath=join(dest,archiveId);
   mkdirSync(dirname(archivePath),{recursive:true,mode:0o700});
   for(const [object,target] of [[entry.archive,archivePath],[entry.manifest,archivePath+'.manifest.json']]){
    const result=await this.store.restoreClosed({key:object.key,destination:target,expected:object});
    durablyRename(result.tempPath,target);
   }
  }
  const checkpoint=join(dest,'.engine18-highwater.json'),tmp=checkpoint+'.tmp';
  writeFileSync(tmp,JSON.stringify({schemaVersion:'engine18.checkpoint.v1',lastSeq:expectedLastSeq})+'\n',
   {mode:0o600,flag:'wx'});
  durablyRename(tmp,checkpoint);
  const verified=await scanEngine18ReplayBounded(dest);
  if(verified.lastSeq!==expectedLastSeq)throw Error('restored source high-watermark mismatch');
  return {restoredArchives:state.entries.length,lastSeq:verified.lastSeq,inventoryHead:state.headHash};
 }
 health({nowMs=Date.now()}={}){
  return Object.freeze({schema:'engine18.s3.backup.health.v1',inFlight:this.inFlight!==null,
   failures:this.failures,lastSuccessAtMs:this.lastSuccessAtMs,pendingRotationArchives:this.pendingRotationArchives,
   remoteArchived:this.cachedInventory?.entries.length??null,
   fullReconciliations:this.fullReconciliations,cachedScans:this.cachedScans,
   lastFullReconciliationMs:this.lastFullReconciliationMs,
   lagMs:this.lastSuccessAtMs===null?null:Math.max(0,nowMs-this.lastSuccessAtMs)});
 }
}
