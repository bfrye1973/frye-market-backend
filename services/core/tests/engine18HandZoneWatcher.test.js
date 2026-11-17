import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCanonicalEsHandZoneText,makeEngine18ChartZoneFetcher}
 from '../logic/engine18/engine18ChartZoneSource.js';
import {normalizeChartHandZones,semanticZoneHash,approvedSnapshotAt,linkObservedBookToZones}
 from '../logic/engine18/engine18HandZoneContext.js';
import {Engine18HandZoneWatcher,Engine18MemoryZoneHistory}
 from '../logic/engine18/engine18HandZoneWatcher.js';
import {Engine18HandZoneR2History} from '../logic/engine18/engine18HandZoneR2History.js';
import {Engine18S3PrivateStore} from '../logic/engine18/engine18S3PrivateStore.js';
import {parseObservedMbp10} from '../logic/engine18/engine18ObservedMbp10Map.js';
const NOW=Date.parse('2026-11-17T15:00:00.000Z');
const rev=n=>n.toString(16).padStart(40,'0');
const mainText=`# owner-approved main zones
7487.25-7541.00 | NEG 7501.25-7525.00 # main buy fill
7297.50-7433.75 | NEG 7383.50-7416.75
7165.00-7264.00 | NEG 7190.25-7234.75
                | NEG 7599.00-7638.00
                | NEG 7571.50-7585.75
                | NEG 7290.00-7348.00
                | NEG 7694.00-7713.75
                | NEG 7457.75-7473.00
                | NEG 7730.25-7758.00
                | NEG 7789.75-7814.25
                | NEG 7888.50-7896.75
                | NEG 7655.25-7677.00
`;
const parse=(txt=mainText,revision=rev(1),ms=NOW)=>parseCanonicalEsHandZoneText(txt,{revision,servedAt:new Date(ms).toISOString()});
const model=p=>normalizeChartHandZones(p);
const history=new Engine18MemoryZoneHistory();
const sha=text=>{const b=Buffer.from(text);return createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');};
const ghFile=text=>({type:'file',encoding:'base64',content:Buffer.from(text).toString('base64'),sha:sha(text)});
const fakeGitHub=({revisions=[rev(1)],contents=[mainText],failure=null}={})=>{
 let index=0,requests=[];
 const fetchImpl=async (url,opts)=>{
  requests.push({url:String(url),authorization:opts.headers.Authorization||null});
  if(failure)return {status:failure,ok:false};
  if(String(url).endsWith('/branches/main'))
   return {ok:true,status:200,json:async()=>({commit:{sha:revisions[Math.min(index++,revisions.length-1)]}})};
  if(String(url).includes('/compare/'))return {ok:true,status:200,json:async()=>({
   status:'ahead',ahead_by:1,behind_by:0})};
  if(String(url).includes('/contents/'))return {ok:true,status:200,json:async()=>{
   const reqRev=new URL(url).searchParams.get('ref');
   const n=revisions.indexOf(reqRev);
   return ghFile(contents[Math.max(0,n)]);
  }};
  throw Error('UNKNOWN_FETCH_URL');
 };
 return {fetchImpl,requests};
};
const watcherHarness=({fetchSource,sourceTexts=[mainText],revisions=[rev(1)],
 store=new Engine18MemoryZoneHistory(),startAt=NOW}={})=>{
 let ms=startAt,tickFn,period;
 const gh=fakeGitHub({contents:sourceTexts,revisions});
 const source=fetchSource??makeEngine18ChartZoneFetcher({fetchImpl:gh.fetchImpl,now:()=>ms});
 const watcher=new Engine18HandZoneWatcher({fetchSource:source,store,now:()=>ms,
  schedule:(fn,p)=>{tickFn=fn;period=p;return 1;},cancel:()=>{}});
 return {watcher,store,gh,now:()=>ms,advance:n=>{ms+=n;},
  tick:async()=>{tickFn();await new Promise(resolve=>setImmediate(resolve));},
  get period(){return period;}};
};
const book=()=>parseObservedMbp10({d:[{s:'XCME:ES.Z26',
 b:Array.from({length:10},(_,i)=>({p:7600-i*.25,sz:10,o:2,l:i,t:1,s:1})),
 a:Array.from({length:10},(_,i)=>({p:7600.25+i*.25,sz:20,o:3,l:i,t:1,s:2}))}]});
test('canonical existing TXT supports parent-only, NEG-only, parent+NEG, comments, exact prices',()=>{
 const p=parse();const zones=model(p).zones;
 assert.equal(zones.length,15);
 assert.equal(zones.filter(x=>x.kind==='PARENT').length,3);
 assert.equal(zones.filter(x=>x.kind==='NEGOTIATED').length,12);
 assert.ok(zones.some(x=>x.lo===7599&&x.hi===7638&&x.kind==='NEGOTIATED'));
 assert.ok(zones.some(x=>x.lo===7487.25&&x.hi===7541&&x.kind==='PARENT'));
 assert.equal(p.meta.priceBasis,'CHART_UNADJUSTED');
 const parentOnly=model(parse('7490.00-7495.25')).zones;
 assert.equal(parentOnly.length,1);
 const negOnly=model(parse('| NEG 7599.00-7638.00')).zones;
 assert.equal(negOnly[0].lo,7599);
});
test('no format mistakes or unapproved zones; quarter-tick, duplicate, bad pair fail closed',()=>{
 for(const txt of ['bad data','7599.10-7638.00','7599.00-7599.00',
  '7490.00-7495.00 | NEG 7480.00-7500.00',
  '| NEG 7599.00-7638.00\n| NEG 7599.00-7638.00']){
  assert.throws(()=>parse(txt));
 }
});
test('normalized set independent of order and whitespace',()=>{
 const a=model(parse('7490.00-7495.00\n| NEG 7599.00-7638.00'));
 const b=model(parse(' | NEG 7599.00-7638.00 # note\n7490.00-7495.00'));
 assert.equal(semanticZoneHash(a),semanticZoneHash(b));
});
test('GitHub main API pinned SHA + matching blob and latest revised 7599 NEG',async()=>{
 const gh=fakeGitHub();
 const read=makeEngine18ChartZoneFetcher({fetchImpl:gh.fetchImpl,now:()=>NOW,token:'test-do-not-log'});
 const result=await read();
 assert.ok(model(result).zones.some(x=>x.lo===7599&&x.hi===7638));
 assert.ok(gh.requests.some(x=>x.url.endsWith('/branches/main')));
 assert.ok(gh.requests.some(x=>x.url.includes('?ref='+rev(1))));
 assert.ok(gh.requests.every(x=>x.authorization==='Bearer test-do-not-log'));
});
test('source GitHub outage/rate-limit/untrusted blob fails closed',async()=>{
 for(const failure of [403,429,503]){
  const gh=fakeGitHub({failure});
  const read=makeEngine18ChartZoneFetcher({fetchImpl:gh.fetchImpl});
  await assert.rejects(read(),/GITHUB_/);
 }
 const gh=fakeGitHub();
 const read=makeEngine18ChartZoneFetcher({fetchImpl:async(url,opt)=>{
  const r=await gh.fetchImpl(url,opt);
  if(String(url).includes('/contents/'))return {ok:true,status:200,json:async()=>({
   ...ghFile(mainText),sha:'0'.repeat(40)})};
  return r;
 }});
 await assert.rejects(read(),/BLOB_HASH/);
});
test('GitHub main source commit rollback rejects divergent commit',async()=>{
 const fetchImpl=async(url)=>{
  if(String(url).endsWith('/branches/main'))return {ok:true,status:200,json:async()=>({commit:{sha:rev(3)}})};
  return {ok:true,status:200,json:async()=>({status:'diverged',behind_by:2,ahead_by:1})};
 };
 await assert.rejects(makeEngine18ChartZoneFetcher({fetchImpl})({previousSourceRevision:rev(5)}),
  /ROLLBACK_OR_DIVERGENCE/);
});
test('300000ms scheduled startup, boundary/add/remove sync, stable hash and no writes unchanged',async()=>{
 const initial='| NEG 7599.00-7638.00',changed='| NEG 7599.00-7639.00';
 const added=changed+'\n7487.25-7541.00',deleted='7487.25-7541.00';
 const h=watcherHarness({sourceTexts:[initial,changed,added,deleted,deleted],
  revisions:[rev(1),rev(2),rev(3),rev(4),rev(4)]});
 await h.watcher.start();assert.equal(h.period,300000);
 assert.equal(h.store.writes,1);
 for(let i=0;i<3;i++){h.advance(300000);await h.tick();assert.equal(h.store.writes,i+2);}
 assert.equal(h.watcher.getCurrent().zones.length,1);
 assert.equal(h.watcher.getVersions()[0].zones[0].hi,7638);
 h.advance(300000);await h.tick();assert.equal(h.store.writes,4);
 assert.equal(h.watcher.health().unchangedCount,1);
 console.log('ENGINE18_GITHUB_MAIN_300000MS_PROOF '+JSON.stringify({
  startup:true,intervalMs:h.period,changes:3,immutableVersions:h.store.writes,
  revisedBoundary:true,added:true,removed:true,
  noExtraWriteUnchanged:true,source:'MOCK_GITHUB_MAIN_NO_PRODUCTION_EDIT'}));
 h.watcher.stop();
});
test('historical revision firstObservedAt is watcher clock; future zone unavailable to old ES',async()=>{
 const h=watcherHarness();await h.watcher.start();
 const current=h.watcher.getCurrent();
 assert.equal(current.firstObservedAt,'2026-11-17T15:00:00.000Z');
 assert.equal(approvedSnapshotAt(h.watcher.getVersions(),'2026-11-16T15:00:00.000Z').status,
  'HISTORICAL_ZONE_UNVERIFIED');
 assert.equal(linkObservedBookToZones({snapshot:current,image:book(),
  eventTime:'2026-11-17T14:59:00.000Z'}).status,'HISTORICAL_ZONE_UNVERIFIED');
 assert.equal(linkObservedBookToZones({snapshot:current,image:book(),
  eventTime:'2026-11-17T15:01:00.000Z'}).status,'PRICE_BASIS_UNVERIFIED');
 const linked=linkObservedBookToZones({snapshot:current,image:book(),
  eventTime:'2026-11-17T15:01:00.000Z',priceBasisEvidence:{
   verified:true,contract:'XCME:ES.Z26',zoneHash:current.hash}});
 assert.equal(linked.status,'OBSERVED_ONLY');
 assert.equal(linked.zones.find(x=>x.kind==='NEGOTIATED'&&x.id.includes('7599.00-7638.00')).insideBand,true);
 h.watcher.stop();
});
test('unavailable source marks active STALE; prior versions persist; timer overlaps skipped',async()=>{
 let resolveFetch;const blocker=new Promise(resolve=>{resolveFetch=resolve;});
 let n=0;
 const h=watcherHarness({fetchSource:async()=>{
  n++;if(n===1)return parse();
  if(n===2)await blocker;
  throw Error('GITHUB_UNAVAILABLE');
 }});
 await h.watcher.start();
 const blocked=h.watcher.poll();
 assert.equal((await h.watcher.poll()).status,'SKIPPED_OVERLAP');
 resolveFetch();await blocked;
 assert.equal(h.watcher.getCurrent(),null);
 assert.equal(h.store.writes,1);
 assert.equal(h.watcher.health().stale,true);
 h.watcher.stop();
});
test('real AES-GCM store writes multiple immutable zone revisions and restores on restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'engine18-r2-zone-ci-'));const memory=new Map();
 const fetchImpl=async (url,opts)=>{
  const u=new URL(url),prefix='/bucket/',key=decodeURIComponent(u.pathname.slice(prefix.length));
  if(u.searchParams.has('list-type')){
   const entries=[...memory.keys()].filter(x=>x.startsWith(u.searchParams.get('prefix')));
   return new Response('<ListBucketResult><IsTruncated>false</IsTruncated>'+
    entries.map(k=>'<Contents><Key>'+k+'</Key></Contents>').join('')+'</ListBucketResult>',{status:200});
  }
  if(opts.method==='PUT'){
   const chunks=[];for await(const c of opts.body)chunks.push(Buffer.from(c));
   if(memory.has(key))return new Response('collision',{status:412});
   memory.set(key,Buffer.concat(chunks));return new Response('',{status:200});
  }
  if(opts.method==='GET'){
   const value=memory.get(key);
   return value?new Response(value,{status:200}):new Response('',{status:404});
  }
  throw Error('unexpected S3 method');
 };
 try{
  const store=new Engine18S3PrivateStore({endpoint:'http://localhost:9000',bucket:'bucket',
   accessKeyId:'testaccess',secretAccessKey:'testsecret123',
   keyId:'test-key',encryptionKey:randomBytes(32),fetchImpl,stagingRoot:dir});
  const history=new Engine18HandZoneR2History({store});
  const gh=watcherHarness({store:history,sourceTexts:[
   '| NEG 7599.00-7638.00','| NEG 7599.00-7639.00',
   '| NEG 7599.00-7639.00\n7487.25-7541.00'],
   revisions:[rev(1),rev(2),rev(3)]});
  await gh.watcher.start();
  for(let i=0;i<2;i++){
   gh.advance(300000);
   assert.equal((await gh.watcher.poll()).status,'CHANGED');
  }
  gh.watcher.stop();
  const restored=await history.load();
  assert.equal(restored.length,3);
  assert.ok([...memory.values()].every(x=>x.subarray(0,8).toString()==='E18GCM01'));
  const resume=watcherHarness({store:history,startAt:NOW+900000,
    sourceTexts:['| NEG 7599.00-7639.00\n7487.25-7541.00'],
    revisions:[rev(3)]});
  await resume.watcher.start();
  assert.equal(resume.watcher.health().historyCount,3);
  assert.equal((await history.load()).length,3);
  assert.equal(resume.watcher.getCurrent().zones.length,2);
  resume.watcher.stop();
  const k=[...memory.keys()][0],bytes=memory.get(k);
  memory.set(k,Buffer.from(bytes));memory.get(k)[25]^=1;
  await assert.rejects(history.load(),/authentication|private inventory|encrypted/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
