// Engine18 Phase4 mock-only encrypted private archive backups.
// No network or production cloud credentials; caller supplies an encryption key.
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream,readFileSync,existsSync,readdirSync,openSync,
 closeSync,fsyncSync,renameSync,unlinkSync,mkdirSync} from 'node:fs';
import {Readable,Writable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join,dirname,relative,resolve} from 'node:path';

const sha=b=>createHash('sha256').update(b).digest('hex');
const walk=dir=>!existsSync(dir)?[]:readdirSync(dir,{withFileTypes:true})
 .flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
const FILE=/^[A-Za-z0-9_.\-/]+$/;
function checkedPath(base,path){
 const rel=relative(base,path);
 if(rel.startsWith('..')||rel.startsWith('/')||!FILE.test(rel))throw Error('unsafe archive key');
 return rel;
}
async function digest(path){
 let bytes=0;const h=createHash('sha256');
 for await(const c of createReadStream(path,{highWaterMark:65536})){bytes+=c.length;h.update(c);}
 return {bytes,sha256:h.digest('hex')};
}
function durableRename(tmp,dest){
 const fd=openSync(tmp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(tmp,dest);
 const d=openSync(dirname(dest),'r');try{fsyncSync(d);}finally{closeSync(d);}
}
export class MockPrivateEncryptedStore{
 constructor({key}={}){
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('32-byte encryption key required');
  this.key=Buffer.from(key);
  this.objects=new Map();this.inventory=new Map();this.failures=0;this.remoteHighWater=0;
 }
 failNext(count){this.failures=count;}
 async putStream(id,readable){
  if(!/^archive\/[A-Za-z0-9_.\-/]+$/.test(id)||id.includes('..'))throw Error('unsafe object key');
  if(this.failures>0){this.failures--;throw Error('SIMULATED_REMOTE_FAILURE');}
  if(this.objects.has(id))throw Error('immutable object already exists');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv),chunks=[];
  let ciphertextBytes=0;
  await pipeline(readable,cipher,new Writable({write(c,enc,cb){chunks.push(Buffer.from(c));ciphertextBytes+=c.length;cb();}}));
  this.objects.set(id,{iv,tag:cipher.getAuthTag(),chunks,ciphertextBytes});
  return {objectId:id,ciphertextBytes};
 }
 async *getStream(id){
  const object=this.objects.get(id);if(!object)throw Error('remote object missing');
  const decipher=createDecipheriv('aes-256-gcm',this.key,object.iv);decipher.setAuthTag(object.tag);
  for await(const chunk of Readable.from(object.chunks).pipe(decipher))yield chunk;
 }
 async getBytes(id){
  const parts=[];for await(const b of this.getStream(id))parts.push(b);
  return Buffer.concat(parts);
 }
 commitInventory(entry){
  if(!entry||typeof entry.archiveId!=='string'||!Number.isSafeInteger(entry.firstSeq)||
   !Number.isSafeInteger(entry.lastSeq)||entry.lastSeq<entry.firstSeq)throw Error('bad immutable inventory');
  const old=this.inventory.get(entry.archiveId);
  if(old){
   if(JSON.stringify(old)!==JSON.stringify(entry))throw Error('immutable inventory conflict');
   return old;
  }
  if(entry.firstSeq!==this.remoteHighWater+1)throw Error('remote immutable inventory sequence discontinuity');
  this.inventory.set(entry.archiveId,Object.freeze({...entry}));
  this.remoteHighWater=entry.lastSeq;
  return entry;
 }
 listInventory(){
  const entries=[...this.inventory.values()].sort((a,b)=>a.firstSeq-b.firstSeq);
  let seq=0;for(const e of entries){if(e.firstSeq!==seq+1)throw Error('remote inventory missing segment');seq=e.lastSeq;}
  if(seq!==this.remoteHighWater)throw Error('independent remote high-watermark mismatch');
  return entries;
 }
 removeForFault(id){this.objects.delete(id);}
 tamperForFault(id){
  const obj=this.objects.get(id);if(obj)obj.tag=Buffer.from('00000000000000000000000000000000','hex');
 }
}
export class Engine18SyntheticArchiveBackup{
 constructor({root,store,maxRetries=3}={}){
  if(!root||!(store instanceof MockPrivateEncryptedStore)||!Number.isInteger(maxRetries)||maxRetries<1||maxRetries>10)throw Error('synthetic storage required');
  this.root=resolve(root);this.store=store;this.maxRetries=maxRetries;
  this.uploaded=0;this.retryCount=0;
 }
 async sendWithRetry(id,path,expected){
  if(this.store.objects.has(id)){
   const bytes=await this.store.getBytes(id);
   if(sha(bytes)!==expected.sha256||bytes.length!==expected.bytes)throw Error('existing remote object corrupt');
   return;
  }
  for(let attempt=1;attempt<=this.maxRetries;attempt++){
   try{await this.store.putStream(id,createReadStream(path));return;}
   catch(e){if(attempt===this.maxRetries)throw Error('private backup upload failed; archive not acknowledged');this.retryCount++;}
  }
 }
 async backupClosed(){
  if(walk(this.root).some(x=>x.endsWith('.jsonl.open')))throw Error('open archive must not be backed up');
  const archives=walk(this.root).filter(x=>x.endsWith('.jsonl.gz'))
   .map(path=>({path,manifest:JSON.parse(readFileSync(path+'.manifest.json','utf8'))}))
   .sort((a,b)=>a.manifest.firstSeq-b.manifest.firstSeq);
  for(const {path,manifest} of archives){
   const manifestPath=path+'.manifest.json';
   if(!existsSync(manifestPath))throw Error('original archive manifest required');
   const local=await digest(path);
   if(local.sha256!==manifest.sha256||local.bytes!==manifest.bytes)throw Error('local archive integrity error');
   const manifestHash=await digest(manifestPath);
   const archiveId=checkedPath(this.root,path);
   const objectId='archive/'+archiveId,manifestObjectId=objectId+'.manifest.json';
   await this.sendWithRetry(objectId,path,local);
   await this.sendWithRetry(manifestObjectId,manifestPath,manifestHash);
   const entry={archiveId,objectId,manifestObjectId,firstSeq:manifest.firstSeq,lastSeq:manifest.lastSeq,
    sha256:local.sha256,bytes:local.bytes,manifestSha256:manifestHash.sha256,manifestBytes:manifestHash.bytes};
   this.store.commitInventory(entry);
   this.uploaded++;
  }
  const entries=this.store.listInventory();
  let last=0;
  for(const e of entries){
   if(e.firstSeq!==last+1)throw Error('independent archive inventory has sequence gap');
   last=e.lastSeq;
  }
  return {uploaded:this.uploaded,retries:this.retryCount,remoteArchiveCount:entries.length,lastSeq:last};
 }
 async restore({destination}={}){
  if(!destination)throw Error('restore destination required');
  const dest=resolve(destination);
  if(existsSync(dest)&&readdirSync(dest).length)throw Error('restore destination must be empty');
  mkdirSync(dest,{recursive:true,mode:0o700});
  const entries=this.store.listInventory();
  let previous=0;
  for(const e of entries){
   if(e.firstSeq!==previous+1)throw Error('remote inventory sequence gap');
   previous=e.lastSeq;
   const name=e.archiveId;
   if(name.includes('..')||name.startsWith('/')||!FILE.test(name))throw Error('unsafe restore path');
   const path=join(dest,name),manifestPath=path+'.manifest.json';
   mkdirSync(dirname(path),{recursive:true,mode:0o700});
   for(const [id,target,expected,size] of [
    [e.objectId,path,e.sha256,e.bytes],
    [e.manifestObjectId,manifestPath,e.manifestSha256,e.manifestBytes]
   ]){
    const tmp=target+'.restore.tmp';
    const hash=createHash('sha256');let bytes=0;
    // Write encrypted object through verified streaming and atomic local rename.
    try{
     await pipeline(
      Readable.from(this.store.getStream(id)),
      new Transform({transform(chunk,encoding,done){hash.update(chunk);bytes+=chunk.length;done(null,chunk);}}),
      createWriteStream(tmp,{flags:'wx',mode:0o600})
     );
    }catch{
     if(existsSync(tmp))unlinkSync(tmp);
     throw Error('encrypted backup restore failed integrity check');
    }
    if(hash.digest('hex')!==expected||bytes!==size)throw Error('restored backup checksum mismatch');
    durableRename(tmp,target);
   }
  }
  const cp=join(dest,'.engine18-highwater.json');
  const checkpoint={schemaVersion:'engine18.checkpoint.v1',lastSeq:previous};
  const tmp=cp+'.restore.tmp';
  const stream=createWriteStream(tmp,{flags:'wx',mode:0o600});
  stream.end(JSON.stringify(checkpoint)+'\n');
  await new Promise((res,rej)=>{stream.once('finish',res);stream.once('error',rej);});
  durableRename(tmp,cp);
  return {lastSeq:previous,archives:entries.length};
 }
}
