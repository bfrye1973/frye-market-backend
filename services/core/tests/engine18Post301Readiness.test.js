import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine18BufferedRecorder} from '../logic/engine18/engine18BufferedRecorder.js';
import {Engine18S3PrivateStore} from '../logic/engine18/engine18S3PrivateStore.js';
import {Engine18S3ArchiveCoordinator} from '../logic/engine18/engine18Phase5S3Coordinator.js';

const withRoot=async fn=>{const root=mkdtempSync(join(tmpdir(),'e18-post301-'));try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const localClock=()=>{
 let now=Date.parse('2026-11-10T21:59:00Z'),mono=0n;
 return {wallNs:()=>String(BigInt(now)*1000000n),monoNs:()=>String(++mono),set:iso=>{now=Date.parse(iso);}};
};
const makeStore=root=>{
 const objects=new Map(),metrics={list:0,get:0,put:0},fetchImpl=async(url,request)=>{
  const id=url.pathname.replace(/^\/private-test\//,'');
  if(request.method==='PUT'){
   metrics.put++;
   if(objects.has(id))return new Response(null,{status:412});
   const parts=[];for await(const c of request.body)parts.push(Buffer.from(c));
   objects.set(id,Buffer.concat(parts));return new Response(null,{status:200});
  }
  if(request.method==='GET'&&url.searchParams.has('list-type')){
   metrics.list++;
   const prefix=url.searchParams.get('prefix')||'';
   const items=[...objects.keys()].filter(k=>k.startsWith(prefix)).sort();
   return new Response('<ListBucketResult><IsTruncated>false</IsTruncated>'+
    items.map(k=>'<Contents><Key>'+k+'</Key></Contents>').join('')+'</ListBucketResult>',{status:200});
  }
  if(request.method==='GET'){
   metrics.get++;
   return objects.has(id)?new Response(objects.get(id),{status:200}):new Response(null,{status:404});
  }
  throw Error('unexpected synthetic operation');
 };
 const store=new Engine18S3PrivateStore({endpoint:'https://synthetic.s3.example',bucket:'private-test',
  region:'auto',accessKeyId:'SYNTHETIC',secretAccessKey:'SYNTHETICSECRET',
  keyId:'synthetic-key-v1',encryptionKey:randomBytes(32),fetchImpl,stagingRoot:root});
 return {store,objects,metrics};
};

test('normal scans avoid remote inventory downloads; only new immutable entry verified',()=>withRoot(async root=>{
 const {store,metrics}=makeStore(root),clock=localClock();
 let ms=0;const coordinator=new Engine18S3ArchiveCoordinator({root,store,reconcileIntervalMs:5000,now:()=>ms});
 const rec=new Engine18BufferedRecorder({root,clock,batchSize:4,flushDelayMs:0});
 await rec.offer({raw:'one',msgClass:'market',at:new Date('2026-11-10T21:59:05Z')});
 clock.set('2026-11-10T22:00:00Z');
 await rec.offer({raw:'two',msgClass:'market',at:new Date('2026-11-10T22:00:00Z')});
 const first=await coordinator.syncClosed();assert.equal(first.added,1);assert.equal(metrics.list,1);
 const getBefore=metrics.get;
 await coordinator.syncClosed();await coordinator.syncClosed();
 assert.equal(metrics.list,1);assert.equal(metrics.get,getBefore);
 clock.set('2026-11-10T23:00:00Z');
 await rec.offer({raw:'three',msgClass:'market',at:new Date('2026-11-10T23:00:00Z')});
 const second=await coordinator.syncClosed();
 assert.equal(second.added,1);assert.equal(metrics.list,1,'new hour must not trigger full listing');
 assert.equal(metrics.get,getBefore+1,'only new remote inventory entry authenticated');
 ms=5100;
 await coordinator.syncClosed();
 assert.equal(metrics.list,2,'periodic full reconciliation required');
 await rec.close();
 assert.equal(coordinator.health().fullReconciliations,2);
}));

test('restart reconciles full inventory and missing final chain fails at periodic scan or pinned restore',()=>withRoot(async root=>{
 const {store,objects,metrics}=makeStore(root),clock=localClock();let ms=0;
 const rec=new Engine18BufferedRecorder({root,clock,batchSize:4,flushDelayMs:0});
 await rec.offer({raw:'first',msgClass:'market',at:new Date('2026-11-10T21:59:00Z')});
 clock.set('2026-11-10T22:00:00Z');
 await rec.offer({raw:'second',msgClass:'market',at:new Date('2026-11-10T22:00:00Z')});
 clock.set('2026-11-10T22:01:00Z');await rec.close();
 const first=new Engine18S3ArchiveCoordinator({root,store,reconcileIntervalMs:1000,now:()=>ms});
 await first.syncClosed();
 const head=await first.inventory({forceFull:false});
 assert.equal(head.entries.length,2);
 const next=new Engine18S3ArchiveCoordinator({root,store,reconcileIntervalMs:1000,now:()=>ms});
 await next.syncClosed();assert.equal(next.health().fullReconciliations,1);
 const newest=head.entries.at(-1).key;
 objects.delete(newest);
 assert.equal((await next.inventory({forceFull:false})).lastSeq,head.lastSeq,
  'cached state is provisional until periodic reconciliation');
 ms=1100;
 await assert.rejects(next.syncClosed(),/private sealed-hour backup failed/);
 await assert.rejects(next.inventory({expectedLastSeq:head.lastSeq}),/high-watermark/);
 assert.ok(metrics.list>=3);
}));
