// Phase 6 acceptance CI only: independent AWS Smithy signer comparison and
// real MinIO S3 protocol. Test dependencies installed in GitHub workflow;
// never connects to licensed Ironbeam or any paid object storage.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonicalAuth,canonicalQueryRFC3986,Engine18S3PrivateStore} from '../logic/engine18/engine18S3PrivateStore.js';
const sha=buf=>createHash('sha256').update(buf).digest('hex');

test('AWS Smithy SignatureV4 independently matches canonical query and Authorization',async()=>{
 const [{SignatureV4},{HttpRequest},{Hash}]=await Promise.all([
  import('@smithy/signature-v4'),import('@smithy/protocol-http'),import('@smithy/hash-node')
 ]);
 const credentials={accessKeyId:'AKIDEXAMPLE',secretAccessKey:'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'};
 const now=new Date('2026-11-11T12:00:00.000Z'),bodyHash=sha(Buffer.alloc(0));
 const signer=new SignatureV4({service:'s3',region:'us-east-1',
  credentials,sha256:Hash.bind(null,'sha256'),uriEscapePath:false});
 const cases=[
  new URL('https://s3.us-east-1.amazonaws.com/example?prefix=with+space&z=x*y&z=~&a=%21'),
  new URL('https://s3.us-east-1.amazonaws.com/example?list-type=2&continuation-token=a%2Bb%2Fc%3D&max-keys=1000'),
  new URL('https://s3.us-east-1.amazonaws.com/example?empty=&dup=b&dup=a&punct=%27%28%29%2A%21')
 ];
 for(const url of cases){
  const ours=canonicalAuth({method:'GET',url,bodyHash,now,accessKeyId:credentials.accessKeyId,
   secretAccessKey:credentials.secretAccessKey,region:'us-east-1'});
  const query={};
  for(const [key,value] of url.searchParams.entries()){
   if(query[key]===undefined)query[key]=value;
   else query[key]=[].concat(query[key],value);
  }
  const request=new HttpRequest({
   protocol:url.protocol,hostname:url.hostname,path:url.pathname,method:'GET',query,
   headers:{host:url.host,'x-amz-content-sha256':bodyHash,'x-amz-date':ours['x-amz-date']}
  });
  const signed=await signer.sign(request,{signingDate:now});
  const a=ours.authorization.match(/Signature=([a-f0-9]+)/)?.[1];
  const b=signed.headers.authorization.match(/Signature=([a-f0-9]+)/)?.[1];
  assert.equal(a,b,'Smithy signature must equal our signature for '+url.search);
 }
 assert.equal(canonicalQueryRFC3986(cases[0]),'a=%21&prefix=with%20space&z=~&z=x%2Ay');
});

test('MinIO real S3 PUT/GET, conditional 412, paginated listing and AES-256 restore',async()=>{
 if(process.env.ENGINE18_MINIO_CI!=='1')return;
 const endpoint=process.env.ENGINE18_MINIO_ENDPOINT||'http://127.0.0.1:9000';
 const bucket='engine18-test',accessKeyId='engine18-minio-test',secretAccessKey='engine18-minio-test-secret';
 const emptyHash=sha(Buffer.alloc(0)),url=new URL(endpoint+'/'+bucket);
 const headers=canonicalAuth({method:'PUT',url,bodyHash:emptyHash,now:new Date(),
  accessKeyId,secretAccessKey,region:'us-east-1'});
 const create=await fetch(url,{method:'PUT',headers});
 assert.ok([200,409].includes(create.status),'create MinIO test bucket: '+create.status);
 const directory=mkdtempSync(join(tmpdir(),'engine18-minio-'));
 try{
  const content=Buffer.from('SYNTHETIC raw ES data 7500.2500 \0\xff — byte-exact');
  const path=join(directory,'first.gz');writeFileSync(path,content);
  const store=new Engine18S3PrivateStore({
   endpoint,bucket,region:'us-east-1',accessKeyId,secretAccessKey,
   keyId:'minio-test-key-v1',encryptionKey:Buffer.alloc(32,7),
   stagingRoot:directory,now:()=>new Date()
  });
  const receipt=await store.uploadClosed({path,key:'engine18/archive/test-0001.jsonl.gz',
   plaintextSha256:sha(content),expectedSize:content.length});
  const duplicate=await store.uploadClosed({path,key:receipt.key,
   plaintextSha256:sha(content),expectedSize:content.length});
  assert.equal(duplicate.plainSha256,receipt.plainSha256);
  const list=await store.listObjectKeys('engine18/archive/');
  assert.deepEqual(list,['engine18/archive/test-0001.jsonl.gz']);
  const restore=await store.restoreClosed({key:receipt.key,
   destination:join(directory,'restore'),expected:receipt});
  assert.deepEqual(readFileSync(restore.tempPath),content);
  const different=join(directory,'different.gz'),diff=Buffer.from('different');
  writeFileSync(different,diff);
  await assert.rejects(store.uploadClosed({path:different,key:receipt.key,
   plaintextSha256:sha(diff),expectedSize:diff.length}),/conflicts/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
