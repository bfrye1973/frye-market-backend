// Gate1 Phase5 PRIVATE OBJECT STORE ADAPTER — not instantiated by production.
// SigV4 S3-compatible, AES-256-GCM envelope, versioned key ID, immutable writes.
// Not a remote backup inventory or a retention-policy implementation by itself.
// Explicit credentials and endpoint injected; NO env credentials, paid calls, or defaults.
import {createHash,createHmac,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream,mkdtempSync,readFileSync,writeFileSync,appendFileSync,
 statSync,rmSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline,finished} from 'node:stream/promises';
import {Readable} from 'node:stream';

const hash=b=>createHash('sha256').update(b).digest('hex');
const hmac=(key,data)=>createHmac('sha256',key).update(data).digest();
const keyRe=/^[a-zA-Z0-9_./:-]{1,240}$/;
const idRe=/^[A-Za-z0-9_.:-]{1,80}$/;
const MAGIC=Buffer.from('E18GCM01');
function pathEncode(s){return s.split('/').map(encodeURIComponent).join('/');}
function signingKey(secret,date,region){
 const k=hmac('AWS4'+secret,date);
 return hmac(hmac(hmac(k,region),'s3'),'aws4_request');
}
function canonicalAuth({method,url,bodyHash,now,accessKeyId,secretAccessKey,region,metadata={}}){
 const dt=now.toISOString().replace(/[-:]|\.\d{3}/g,'');
 const date=dt.slice(0,8),scope=date+'/'+region+'/s3/aws4_request';
 const headers={'host':url.host,'x-amz-content-sha256':bodyHash,'x-amz-date':dt};
 for(const [k,v] of Object.entries(metadata))headers[k.toLowerCase()]=String(v);
 const keys=Object.keys(headers).sort();
 const canonicalHeaders=keys.map(k=>k+':'+headers[k].trim()+'\n').join('');
 const signedHeaders=keys.join(';');
 const request=[method,url.pathname,url.searchParams.toString(),canonicalHeaders,signedHeaders,bodyHash].join('\n');
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
  fetchImpl=fetch,now=()=>new Date(),maxObjectBytes=1024*1024*1024}={}){
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
  this.maxObjectBytes=maxObjectBytes;
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
 async uploadClosed({path,key,plaintextSha256,expectedSize}={}){
  if(!path||typeof plaintextSha256!=='string'||!/^[a-f0-9]{64}$/.test(plaintextSha256)||
    !Number.isSafeInteger(expectedSize)||expectedSize<0)throw Error('verified sealed archive required');
  const local=await hashFile(path);
  if(local.sha256!==plaintextSha256||local.bytes!==expectedSize)throw Error('source archive changed before upload');
  const dir=mkdtempSync(join(tmpdir(),'engine18-s3-stage-')),tmp=join(dir,'sealed.enc');
  try{
   const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);
   writeFileSync(tmp,Buffer.concat([MAGIC,nonce]),{flag:'wx',mode:0o600});
   await pipeline(createReadStream(path),cipher,createWriteStream(tmp,{flags:'a',mode:0o600}));
   appendFileSync(tmp,cipher.getAuthTag());
   const fd=openSync(tmp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
   // Ensure source archive has not changed during encryption.
   const after=await hashFile(path);
   if(after.sha256!==plaintextSha256||after.bytes!==expectedSize)throw Error('source archive changed during upload');
   const metadata={'x-amz-meta-engine18-key-id':this.keyId,
    'x-amz-meta-engine18-plain-sha256':plaintextSha256,
    'x-amz-meta-engine18-plain-bytes':String(expectedSize)};
   const encrypted=await hashFile(tmp);
   await this.request('PUT',key,{file:tmp,metadata,expectedCode:[200,201,204]});
   return Object.freeze({key,keyId:this.keyId,plainSha256:plaintextSha256,plainBytes:expectedSize,
    cipherSha256:encrypted.sha256,cipherBytes:encrypted.bytes});
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
 async restoreClosed({key,destination,expected}={}){
  if(!expected||expected.keyId!==this.keyId)throw Error('versioned restore key missing');
  const dir=mkdtempSync(join(tmpdir(),'engine18-s3-restore-')),tmp=join(dir,'encrypted');
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
    const {readSync}=await import('node:fs');
    readSync(fh,header,0,20,0);readSync(fh,tag,0,16,size-16);
   }finally{closeSync(fh);}
   if(!header.subarray(0,8).equals(MAGIC))throw Error('invalid encrypted envelope');
   const decipher=createDecipheriv('aes-256-gcm',this.key,header.subarray(8,20));
   decipher.setAuthTag(tag);
   const output=destination+'.restore.tmp';
   await pipeline(createReadStream(tmp,{start:20,end:size-17}),decipher,
    createWriteStream(output,{flags:'wx',mode:0o600}));
   const plain=await hashFile(output);
   if(plain.sha256!==expected.plainSha256||plain.bytes!==expected.plainBytes)
    throw Error('restored plaintext SHA256 mismatch');
   return {tempPath:output,keyId:this.keyId,sha256:plain.sha256,bytes:plain.bytes};
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
}
