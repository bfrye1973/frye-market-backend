// Gate1 Phase5 PRIVATE OBJECT STORE ADAPTER — not instantiated by production.
// SigV4 S3-compatible, AES-256-GCM envelope, versioned key ID, immutable writes.
// Not a remote backup inventory or a retention-policy implementation by itself.
// Explicit credentials and endpoint injected; NO env credentials, paid calls, or defaults.
import {createHash,createHmac,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream,mkdtempSync,readFileSync,writeFileSync,appendFileSync,
 statSync,rmSync,existsSync,openSync,closeSync,fsyncSync,readSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline,finished} from 'node:stream/promises';
import {Readable,Writable} from 'node:stream';

const hash=b=>createHash('sha256').update(b).digest('hex');
const hmac=(key,data)=>createHmac('sha256',key).update(data).digest();
const keyRe=/^[a-zA-Z0-9_./:-]{1,240}$/;
const idRe=/^[A-Za-z0-9_.:-]{1,80}$/;
const MAGIC=Buffer.from('E18GCM01');
export function rfc3986Encode(s){return encodeURIComponent(String(s)).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());}
function pathEncode(s){return s.split('/').map(rfc3986Encode).join('/');}
export function canonicalQueryRFC3986(url){
 return [...url.searchParams.entries()].map(([k,v])=>[rfc3986Encode(k),rfc3986Encode(v)])
  .sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0)
  .map(([k,v])=>k+'='+v).join('&');
}
function signingKey(secret,date,region){
 const k=hmac('AWS4'+secret,date);
 return hmac(hmac(hmac(k,region),'s3'),'aws4_request');
}
export function canonicalAuth({method,url,bodyHash,now,accessKeyId,secretAccessKey,region,metadata={}}){
 const dt=now.toISOString().replace(/[-:]|\.\d{3}/g,'');
 const date=dt.slice(0,8),scope=date+'/'+region+'/s3/aws4_request';
 const headers={'host':url.host,'x-amz-content-sha256':bodyHash,'x-amz-date':dt};
 for(const [k,v] of Object.entries(metadata))headers[k.toLowerCase()]=String(v);
 const keys=Object.keys(headers).sort();
 const canonicalHeaders=keys.map(k=>k+':'+headers[k].trim()+'\n').join('');
 const signedHeaders=keys.join(';');
 const request=[method,url.pathname,canonicalQueryRFC3986(url),canonicalHeaders,signedHeaders,bodyHash].join('\n');
 const stringToSign=['AWS4-HMAC-SHA256',dt,scope,hash(request)].join('\n');
 const signature=hmac(signingKey(secretAccessKey,date,region),stringToSign).toString('hex');
 return {...headers,'authorization':'AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+
  ', SignedHeaders='+signedHeaders+', Signature='+signature};
}
async function hashFile(path){
 const h=createHash('sha256');let bytes=0;
 for await(const c of createReadStream(path)){h.update(c);bytes+=c.length;}
 return {sha256:h.digest('hex'),bytes};
}
export class Engine18S3PrivateStore {
 constructor({endpoint,bucket,region='auto',accessKeyId,secretAccessKey,keyId,encryptionKey,
  fetchImpl=fetch,now=()=>new Date(),maxObjectBytes=1024*1024*1024,maxRetries=3,retentionDays=30,stagingRoot=tmpdir()}={}){
  const url=new URL(endpoint);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||
     (url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname)))
   throw Error('private S3 requires HTTPS endpoint (or mock localhost)');
  for(const s of [bucket,region,accessKeyId,keyId])if(typeof s!=='string'||!idRe.test(s))throw Error('unsafe S3 identifier');
  if(typeof secretAccessKey!=='string'||secretAccessKey.length<8||!Buffer.isBuffer(encryptionKey)||encryptionKey.length!==32)
   throw Error('external S3 credentials and 256-bit key required');
  this.endpoint=url.origin;this.bucket=bucket;this.region=region;
  this.accessKeyId=accessKeyId;this.secretAccessKey=secretAccessKey;
  this.keyId=keyId;this.key=Buffer.from(encryptionKey);this.fetch=fetchImpl;this.now=now;
  if(!Number.isInteger(maxRetries)||maxRetries<1||maxRetries>8||
     !Number.isInteger(retentionDays)||retentionDays<1||retentionDays>3650)throw Error('invalid backup retry/retention policy');
  this.maxObjectBytes=maxObjectBytes;this.maxRetries=maxRetries;this.retentionDays=retentionDays;
  this.stagingRoot=stagingRoot; // Must be dedicated private disk in authorized live worker.
 }
 url(key){
  if(typeof key!=='string'||!keyRe.test(key)||key.includes('..')||key.startsWith('/'))throw Error('unsafe object path');
  return new URL(this.endpoint+'/'+encodeURIComponent(this.bucket)+'/'+pathEncode(key));
 }
 async request(method,key,{file=null,metadata={},expectedCode=[200,201,204]}={}){
  const url=this.url(key),size=file?statSync(file).size:0;
  if(size>this.maxObjectBytes)throw Error('S3 object exceeds bounded staging limit');
  const bodyHash=file?(await hashFile(file)).sha256:hash(Buffer.alloc(0));
  const headers=canonicalAuth({method,url,bodyHash,now:this.now(),accessKeyId:this.accessKeyId,
   secretAccessKey:this.secretAccessKey,region:this.region,metadata});
  if(file){headers['content-length']=String(size);headers['if-none-match']='*';}
  // Authorization signing includes all x-amz headers; the conditional header
  // is deliberately not signed and must be supported by the target provider.
  const body=file?createReadStream(file):undefined;
  let response;
  try{
   response=await this.fetch(url,{method,headers,body,...(file?{duplex:'half'}:{})});
  }catch{
   if(body){body.destroy();await finished(body).catch(()=>{});}
   throw Error('private S3 transport failed');
  }
  if(!expectedCode.includes(response.status)){
   // S3 can reject conditional PUT before consuming request body. Drain/close
   // the staged file stream BEFORE cleanup or it may reopen after unlink.
   if(body){body.destroy();await finished(body).catch(()=>{});}
   throw Error('private S3 operation refused: HTTP '+response.status);
  }
  if(body)await finished(body).catch(()=>{throw Error('S3 request upload incomplete');});
  return response;
 }
 async remoteCipherDigest(key){
  const response=await this.request('GET',key,{expectedCode:[200]});
  if(!response.body)throw Error('missing private object stream');
  const h=createHash('sha256');let bytes=0;
  for await(const chunk of Readable.fromWeb(response.body)){
   bytes+=chunk.length;
   if(bytes>this.maxObjectBytes)throw Error('remote object exceeds bounded limit');
   h.update(chunk);
  }
  return {sha256:h.digest('hex'),bytes};
 }
 async inspectExisting(key,plainSha256,expectedSize){
  // Prove a remote immutable object is the SAME original archive, even when
  // it was encrypted under a new nonce after a caller restart.
  const dir=mkdtempSync(join(this.stagingRoot,'engine18-s3-inspect-'));
  const encrypted=join(dir,'remote.enc');
  try{
   const response=await this.request('GET',key,{expectedCode:[200]});
   if(!response.body)throw Error('remote immutable object missing');
   await pipeline(Readable.fromWeb(response.body),createWriteStream(encrypted,{flags:'wx',mode:0o600}));
   const cipher=await hashFile(encrypted),size=cipher.bytes;
   if(size<36||size>this.maxObjectBytes)throw Error('invalid remote envelope size');
   const header=Buffer.alloc(20),tag=Buffer.alloc(16),fd=openSync(encrypted,'r');
   try{readSync(fd,header,0,20,0);readSync(fd,tag,0,16,size-16);}
   finally{closeSync(fd);}
   if(!header.subarray(0,8).equals(MAGIC))throw Error('wrong remote envelope');
   const d=createDecipheriv('aes-256-gcm',this.key,header.subarray(8,20));
   d.setAuthTag(tag);
   const digest=createHash('sha256');let bytes=0;
   try{
    await pipeline(createReadStream(encrypted,{start:20,end:size-17}),d,
     new Writable({write(chunk,encoding,callback){bytes+=chunk.length;digest.update(chunk);callback();}}));
   }catch{throw Error('remote immutable object cannot be authenticated');}
   if(bytes!==expectedSize||digest.digest('hex')!==plainSha256)
    throw Error('remote immutable object conflicts with source archive');
   return {key,keyId:this.keyId,plainSha256,plainBytes:expectedSize,
    cipherSha256:cipher.sha256,cipherBytes:size};
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
 async readSmallEncryptedJson(key,{maxEncryptedBytes=128*1024}={}){
  // Inventory is small, encrypted and authenticated; market-data archives use
  // streaming restoreClosed() instead of this bounded JSON helper.
  const response=await this.request('GET',key,{expectedCode:[200]});
  if(!response.body)throw Error('private inventory object missing');
  const parts=[];let n=0;
  for await(const c of Readable.fromWeb(response.body)){
   n+=c.length;if(n>maxEncryptedBytes)throw Error('encrypted inventory too large');
   parts.push(c);
  }
  const bytes=Buffer.concat(parts);
  if(bytes.length<36||!bytes.subarray(0,8).equals(MAGIC))throw Error('invalid private inventory envelope');
  const decipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(8,20));
  decipher.setAuthTag(bytes.subarray(bytes.length-16));
  let plain;
  try{plain=Buffer.concat([decipher.update(bytes.subarray(20,-16)),decipher.final()]);}
  catch{throw Error('private inventory authentication failed');}
  let obj;
  try{obj=JSON.parse(plain.toString('utf8'));}catch{throw Error('corrupt private inventory JSON');}
  if(!obj||typeof obj!=='object'||obj.keyId!==this.keyId)throw Error('private inventory key version mismatch');
  return obj;
 }
 async listObjectKeys(prefix,{pageSize=1000}={}){
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw Error('invalid S3 page size');
  if(typeof prefix!=='string'||!keyRe.test(prefix)||prefix.includes('..'))throw Error('unsafe S3 inventory prefix');
  const result=[];let token=null;
  for(let page=0;page<1000;page++){
   const url=new URL(this.endpoint+'/'+encodeURIComponent(this.bucket));
   url.searchParams.set('list-type','2');
   url.searchParams.set('max-keys',String(pageSize));
   url.searchParams.set('prefix',prefix);
   if(token)url.searchParams.set('continuation-token',token);
   url.searchParams.sort();
   const headers=canonicalAuth({method:'GET',url,bodyHash:hash(Buffer.alloc(0)),
    now:this.now(),accessKeyId:this.accessKeyId,secretAccessKey:this.secretAccessKey,region:this.region});
   let response;
   try{response=await this.fetch(url,{method:'GET',headers});}
   catch{throw Error('private S3 inventory listing failed');}
   if(response.status!==200)throw Error('private S3 inventory listing refused');
   const xml=await response.text();
   if(xml.length>4*1024*1024)throw Error('private inventory listing exceeds safe page');
   const keys=[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(x=>x[1]);
   for(const key of keys){
    if(!key.startsWith(prefix)||!keyRe.test(key)||key.includes('..'))throw Error('unsafe listed S3 object');
    result.push(key);
   }
   if(!/<IsTruncated>true<\/IsTruncated>/.test(xml))return result.sort();
   const match=xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
   if(!match||match[1]===token)throw Error('invalid S3 continuation token');
   token=match[1];
  }
  throw Error('inventory pagination safety limit exceeded');
 }
 async uploadClosed({path,key,plaintextSha256,expectedSize}={}){
  if(!path||typeof plaintextSha256!=='string'||!/^[a-f0-9]{64}$/.test(plaintextSha256)||
    !Number.isSafeInteger(expectedSize)||expectedSize<0)throw Error('verified sealed archive required');
  const local=await hashFile(path);
  if(local.sha256!==plaintextSha256||local.bytes!==expectedSize)throw Error('source archive changed before upload');
  const dir=mkdtempSync(join(this.stagingRoot,'engine18-s3-stage-')),tmp=join(dir,'sealed.enc');
  try{
   const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);
   writeFileSync(tmp,Buffer.concat([MAGIC,nonce]),{flag:'wx',mode:0o600});
   await pipeline(createReadStream(path),cipher,createWriteStream(tmp,{flags:'a',mode:0o600}));
   appendFileSync(tmp,cipher.getAuthTag());
   const fd=openSync(tmp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
   // Ensure source archive has not changed during encryption.
   const after=await hashFile(path);
   if(after.sha256!==plaintextSha256||after.bytes!==expectedSize)throw Error('source archive changed during upload');
   const retainUntil=new Date(this.now().getTime()+this.retentionDays*86400000).toISOString();
   const metadata={'x-amz-meta-engine18-key-id':this.keyId,
    'x-amz-meta-engine18-plain-sha256':plaintextSha256,
    'x-amz-meta-engine18-plain-bytes':String(expectedSize),
    // Advisory only: enforce actual deletion policy in bucket lifecycle controls.
    'x-amz-meta-engine18-retain-until':retainUntil};
   const encrypted=await hashFile(tmp);
   let stored=false;
   for(let attempt=0;attempt<this.maxRetries;attempt++){
    try{await this.request('PUT',key,{file:tmp,metadata,expectedCode:[200,201,204]});stored=true;break;}
    catch{
     // A prior attempt can succeed even when its ACK is lost. The exact
     // ciphertext is staged once, so compare remote hash before retry.
     try{
      const found=await this.remoteCipherDigest(key);
      if(found.sha256===encrypted.sha256&&found.bytes===encrypted.bytes){stored=true;break;}
      // Different nonce is expected on a restarted upload. Authenticate and
      // hash remote plaintext instead of overwriting or falsely declaring loss.
      const original=await this.inspectExisting(key,plaintextSha256,expectedSize);
      return Object.freeze(original);
     }catch(err){
      if(/conflicts/.test(err.message))throw err;
      if(attempt===this.maxRetries-1)throw Error('private S3 immutable upload not verified');
     }
    }
   }
   if(!stored)throw Error('private S3 upload not verified');
   return Object.freeze({key,keyId:this.keyId,plainSha256:plaintextSha256,plainBytes:expectedSize,
    cipherSha256:encrypted.sha256,cipherBytes:encrypted.bytes});
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
 async restoreClosed({key,destination,expected}={}){
  if(!expected||expected.keyId!==this.keyId)throw Error('versioned restore key missing');
  const dir=mkdtempSync(join(this.stagingRoot,'engine18-s3-restore-')),tmp=join(dir,'encrypted');
  try{
   const response=await this.request('GET',key,{expectedCode:[200]});
   if(!response.body)throw Error('missing encrypted object body');
   await pipeline(Readable.fromWeb(response.body),createWriteStream(tmp,{flags:'wx',mode:0o600}));
   const cipher=await hashFile(tmp);
   if(cipher.sha256!==expected.cipherSha256||cipher.bytes!==expected.cipherBytes)
    throw Error('encrypted object SHA256 mismatch');
   const size=statSync(tmp).size;
   if(size<MAGIC.length+12+16)throw Error('incomplete encrypted backup');
   const header=Buffer.alloc(20),tag=Buffer.alloc(16);
   const fh=openSync(tmp,'r');
   try{
    readSync(fh,header,0,20,0);readSync(fh,tag,0,16,size-16);
   }finally{closeSync(fh);}
   if(!header.subarray(0,8).equals(MAGIC))throw Error('invalid encrypted envelope');
   const decipher=createDecipheriv('aes-256-gcm',this.key,header.subarray(8,20));
   decipher.setAuthTag(tag);
   const output=destination+'.restore.tmp';
   if(existsSync(output))throw Error('restore staging already exists');
   try{
    await pipeline(createReadStream(tmp,{start:20,end:size-17}),decipher,
     createWriteStream(output,{flags:'wx',mode:0o600}));
    const plain=await hashFile(output);
    if(plain.sha256!==expected.plainSha256||plain.bytes!==expected.plainBytes)
     throw Error('restored plaintext SHA256 mismatch');
    return {tempPath:output,keyId:this.keyId,sha256:plain.sha256,bytes:plain.bytes};
   }catch{
    // Never leave a partial or unauthenticated plaintext file on disk.
    rmSync(output,{force:true});
    throw Error('encrypted restore authentication or checksum failed');
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
}
