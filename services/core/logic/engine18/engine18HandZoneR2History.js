// Durable encrypted HAND-zone history inside existing private R2 bucket.
// Never stores market frames or modifies the chart; immutable conditional PUT only.
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
const PREFIX='engine18/zone-history/v1/HAND/';
const sha=x=>createHash('sha256').update(x).digest('hex');
export class Engine18HandZoneR2History{
 constructor({store}={}){
  if(typeof store?.listObjectKeys!=='function'||typeof store?.uploadClosed!=='function'||
   typeof store?.readSmallEncryptedJson!=='function'||!store.stagingRoot)
   throw Error('PRIVATE_R2_STORE_REQUIRED');
  this.store=store;
 }
 async load(){
  const names=await this.store.listObjectKeys(PREFIX);
  if(names.length>10000)throw Error('ZONE_HISTORY_LIMIT');
  const versions=[];
  for(const name of names.sort()){
   if(!/^engine18\/zone-history\/v1\/HAND\/\d{13}-[a-f0-9]{64}\.json$/.test(name))
    throw Error('INVALID_ZONE_VERSION_KEY');
   const v=await this.store.readSmallEncryptedJson(name,{maxEncryptedBytes:262144});
   const encoded=Buffer.from(JSON.stringify(v));
   if(sha(encoded)!==name.match(/-([a-f0-9]{64})\.json$/)[1])throw Error('VERSION_HASH_MISMATCH');
   versions.push(v);
  }
  versions.sort((a,b)=>Date.parse(a.firstObservedAt)-Date.parse(b.firstObservedAt));
  return versions;
 }
 async append(snapshot){
  const body={...snapshot,keyId:this.store.keyId};
  const encoded=Buffer.from(JSON.stringify(body));
  if(encoded.length>200000)throw Error('ZONE_VERSION_TOO_LARGE');
  const key=PREFIX+String(Date.parse(snapshot.firstObservedAt)).padStart(13,'0')+'-'+sha(encoded)+'.json';
  const dir=mkdtempSync(join(this.store.stagingRoot,'e18-zone-'));
  try{
   const path=join(dir,'version.json');
   writeFileSync(path,encoded,{mode:0o600,flag:'wx'});
   await this.store.uploadClosed({path,key,plaintextSha256:sha(encoded),expectedSize:encoded.length});
   const verified=await this.store.readSmallEncryptedJson(key);
   if(sha(Buffer.from(JSON.stringify(verified)))!==sha(encoded))throw Error('ZONE_REMOTE_VERIFY_FAILED');
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
}
