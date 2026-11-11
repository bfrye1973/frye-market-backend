// Engine 18 bounded crash recovery. Synthetic-only, no external source or transport.
// Never manufacture data or accept a missing original manifest as new proof.
import {createReadStream,createWriteStream,existsSync,readFileSync,readdirSync,
 openSync,closeSync,fsyncSync,ftruncateSync,renameSync,unlinkSync,writeSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createGunzip,createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';

const MAX_FRAME=16*1024*1024;
const CHUNK=64*1024;
const walk=dir=>!existsSync(dir)?[]:readdirSync(dir,{withFileTypes:true})
 .flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
const fileHash=async path=>{
 const h=createHash('sha256');let bytes=0;
 for await(const c of createReadStream(path,{highWaterMark:CHUNK})){h.update(c);bytes+=c.length;}
 return {bytes,sha256:h.digest('hex')};
};
function syncDirectory(path){
 const fd=openSync(dirname(path),'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}
function atomic(path,data){
 const tmp=path+'.tmp';
 const fd=openSync(tmp,'wx',0o600);
 try{const b=Buffer.from(data);let n=0;while(n<b.length){const written=writeSync(fd,b,n,b.length-n);if(written<=0)throw Error('atomic short write');n+=written;}fsyncSync(fd);}
 finally{closeSync(fd);}
 renameSync(tmp,path);syncDirectory(path);
}
function remove(path){unlinkSync(path);syncDirectory(path);}
function validRecord(e){
 if(!e||e.schemaVersion!=='engine18.raw.v2'||!Number.isSafeInteger(e.localSeq)||
  e.localSeq<=0||typeof e.runId!=='string'||typeof e.raw!=='string'||
  (e.rawEncoding!=='utf8'&&e.rawEncoding!=='base64')||
  typeof e.receivedWallNs!=='string'||!/^\d+$/.test(e.receivedWallNs)||
  typeof e.receivedMonoNs!=='string'||!/^\d+$/.test(e.receivedMonoNs))throw Error('invalid archive record');
 if(e.rawEncoding==='base64'){
  if(!/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(e.raw)||
    Buffer.from(e.raw,'base64').toString('base64')!==e.raw)throw Error('corrupt binary raw payload');
 }
}
async function scanLines(path,{compressed=false,allowTail=false,onRecord=()=>{}}={}){
 const input=createReadStream(path,{highWaterMark:CHUNK});
 const stream=compressed?input.pipe(createGunzip()):input;
 let buffer=Buffer.alloc(0),validBytes=0,bytes=0,count=0,firstSeq=null,lastSeq=null,
  firstWallNs=null,lastWallNs=null,lastStatus=null,gaps=0,maxBufferedBytes=0;
 for await(const part of stream){
  bytes+=part.length;
  buffer=Buffer.concat([buffer,part]);
  while(true){
   const newline=buffer.indexOf(10);
   if(newline===-1)break;
   if(newline>MAX_FRAME)throw Error('raw envelope exceeds 16MiB limit');
   let e;
   try{e=JSON.parse(buffer.subarray(0,newline).toString('utf8'));}catch{throw Error('corrupt complete JSONL record');}
   validRecord(e);
   if(lastSeq!==null&&e.localSeq!==lastSeq+1)throw Error('archive localSeq discontinuity');
   if(firstSeq===null){firstSeq=e.localSeq;firstWallNs=e.receivedWallNs;}
   lastSeq=e.localSeq;lastWallNs=e.receivedWallNs;lastStatus=e.statusCode;
   if(e.statusCode==='GAP')gaps++;
   count++;validBytes+=newline+1;onRecord(e);
   buffer=buffer.subarray(newline+1);
  }
  maxBufferedBytes=Math.max(maxBufferedBytes,buffer.length);
  if(buffer.length>MAX_FRAME)throw Error('unbounded incomplete JSONL record');
 }
 if(!allowTail&&buffer.length)throw Error('incomplete archive tail');
 return {count,firstSeq,lastSeq,firstWallNs,lastWallNs,lastStatus,gaps,validBytes,
  truncatedBytes:allowTail?buffer.length:0,maxBufferedBytes,plainBytes:bytes};
}
async function verifyGzip(path){
 if(!existsSync(path+'.manifest.json')){
  const marker=path+'.integrity-unverified.json';
  if(!existsSync(marker))atomic(marker,JSON.stringify({
   schemaVersion:'engine18.integrity.v1',state:'UNVERIFIED',reason:'ORIGINAL_MANIFEST_MISSING'
  })+'\n');
  throw Error('original manifest missing: integrity UNVERIFIED');
 }
 const manifest=JSON.parse(readFileSync(path+'.manifest.json','utf8'));
 const h=await fileHash(path);
 if(h.sha256!==manifest.sha256||h.bytes!==manifest.bytes)throw Error('archive SHA256 mismatch');
 const scan=await scanLines(path,{compressed:true});
 if(scan.count!==manifest.count||scan.firstSeq!==manifest.firstSeq||
  scan.lastSeq!==manifest.lastSeq)throw Error('archive manifest record mismatch');
 return scan;
}
async function finalizeOpen(path,summary,calendarVersion,testFault=null){
 const dest=path.replace(/\.jsonl\.open$/,'.jsonl.gz');
 if(existsSync(dest)){
  const a=await scanLines(dest,{compressed:true}),b=summary;
  if(a.count!==b.count||a.firstSeq!==b.firstSeq||a.lastSeq!==b.lastSeq)throw Error('conflicting archive/open evidence');
  const openHash=await fileHash(path);
  const decompressedHash=createHash('sha256');
  for await(const chunk of createReadStream(dest).pipe(createGunzip()))decompressedHash.update(chunk);
  if(openHash.sha256!==decompressedHash.digest('hex'))throw Error('conflicting archive bytes');
  // A gzip renamed before its manifest is not automatically corrupt when
  // its intact original .open remains a byte-identical source of truth.
  if(!existsSync(dest+'.manifest.json')){
   // Interrupted atomic manifest write may leave a .tmp. We may discard it
   // ONLY after the intact original has verified equal to decompressed gzip.
   if(existsSync(dest+'.manifest.json.tmp'))remove(dest+'.manifest.json.tmp');
   const hash=await fileHash(dest);
   atomic(dest+'.manifest.json',JSON.stringify({
    schemaVersion:'engine18.manifest.v1',...hash,count:summary.count,
    firstSeq:summary.firstSeq,lastSeq:summary.lastSeq,
    firstWallNs:summary.firstWallNs,lastWallNs:summary.lastWallNs,calendarVersion
   })+'\n');
  }
  await verifyGzip(dest);
  const marker=dest+'.integrity-unverified.json';
  if(existsSync(marker)){
   const data=JSON.parse(readFileSync(marker,'utf8'));
   if(data.reason!=='ORIGINAL_MANIFEST_MISSING')throw Error('unrelated integrity marker requires inspection');
   remove(marker);
  }
  remove(path);return;
 }
 if(summary.count===0){remove(path);return;}
 const tmp=dest+'.tmp';
 if(existsSync(tmp))remove(tmp); // source .open remains verifiable
 await pipeline(createReadStream(path),createGzip({mtime:0}),createWriteStream(tmp,{flags:'wx',mode:0o600}));
 const fd=openSync(tmp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(tmp,dest);syncDirectory(dest);
 testFault?.('AFTER_ARCHIVE_RENAME_BEFORE_MANIFEST',{source:path,archive:dest});
 const hash=await fileHash(dest);
 atomic(dest+'.manifest.json',JSON.stringify({
  schemaVersion:'engine18.manifest.v1',...hash,count:summary.count,
  firstSeq:summary.firstSeq,lastSeq:summary.lastSeq,
  firstWallNs:summary.firstWallNs,lastWallNs:summary.lastWallNs,calendarVersion
 })+'\n');
 remove(path);
}
export async function recoverEngine18Bounded({root,calendarVersion='cme-eth-provisional-v1',testFault=null}={}){
 const base=resolve(root),paths=walk(base);
 // Reconcile interrupted rename-before-manifest FIRST, before treating a
 // previous unverified marker as permanent. No original source => fail closed.
 for(const gz of walk(base).filter(p=>p.endsWith('.jsonl.gz')&&!existsSync(p+'.manifest.json'))){
  const source=gz.replace(/\.jsonl\.gz$/,'.jsonl.open');
  if(!existsSync(source))continue; // verifyGzip below creates a fail-closed marker
  const summary=await scanLines(source,{allowTail:false});
  if(!summary.count)throw Error('empty original source cannot certify orphan gzip');
  await finalizeOpen(source,summary,calendarVersion,testFault);
 }
 if(walk(base).some(p=>p.endsWith('.integrity-unverified.json')))throw Error('integrity UNVERIFIED');
 const cp=join(base,'.engine18-highwater.json');
 if(existsSync(cp+'.tmp')){
  if(!existsSync(cp))throw Error('orphan checkpoint requires manual inspection');
  remove(cp+'.tmp');
 }
 const high=existsSync(cp)?JSON.parse(readFileSync(cp,'utf8')).lastSeq:null;
 if(high!==null&&(!Number.isSafeInteger(high)||high<0))throw Error('invalid checkpoint');
 let maxBufferedBytes=0,recoveredOpen=0,truncatedBytes=0;
 for(const tmp of walk(base).filter(p=>p.endsWith('.jsonl.gz.tmp')||p.endsWith('.manifest.json.tmp'))){
  const source=tmp.endsWith('.jsonl.gz.tmp')?tmp.replace(/\.jsonl\.gz\.tmp$/,'.jsonl.open'):null;
  const archive=tmp.slice(0,-4);
  if(source?!existsSync(source)&&!existsSync(archive):!existsSync(archive))throw Error('orphan archive temp');
  remove(tmp);
 }
 // Verify all existing archives before modifying an open segment.
 for(const p of walk(base).filter(p=>p.endsWith('.jsonl.gz')))await verifyGzip(p);
 for(const path of walk(base).filter(p=>p.endsWith('.jsonl.open')).sort()){
  const scan=await scanLines(path,{allowTail:true});
  maxBufferedBytes=Math.max(maxBufferedBytes,scan.maxBufferedBytes);
  if(scan.truncatedBytes){
   const fd=openSync(path,'r+');
   try{ftruncateSync(fd,scan.validBytes);fsyncSync(fd);}finally{closeSync(fd);}
   truncatedBytes+=scan.truncatedBytes;
  }
  await finalizeOpen(path,scan,calendarVersion,testFault);recoveredOpen++;
 }
 // Archive filenames are not a source of event ordering: use localSeq ranges.
 const items=[];
 for(const path of walk(base).filter(p=>p.endsWith('.jsonl.gz'))){
  const scan=await verifyGzip(path);
  maxBufferedBytes=Math.max(maxBufferedBytes,scan.maxBufferedBytes);
  items.push({path,scan});
 }
 items.sort((a,b)=>a.scan.firstSeq-b.scan.firstSeq);
 let lastSeq=0,lastStatus=null,gaps=0;
 for(const {scan} of items){
  if(scan.firstSeq!==lastSeq+1)throw Error('missing or duplicated archive sequence');
  lastSeq=scan.lastSeq;lastStatus=scan.lastStatus;gaps+=scan.gaps;
 }
 if(high!==null&&lastSeq<high)throw Error('high-watermark proves missing acknowledged data');
 if(high===null&&lastSeq>0)throw Error('historical high-watermark missing');
 if(lastSeq>high){
  atomic(cp,JSON.stringify({schemaVersion:'engine18.checkpoint.v1',lastSeq})+'\n');
 }
 return {lastSeq,gaps,previousUnclean:lastSeq>0&&lastStatus!=='RECORDER_STOP',
  metrics:{recoveredOpen,truncatedBytes,maxBufferedBytes,sampledRssBytes:process.memoryUsage().rss,
   verifiedArchives:items.length}};
}
