// Bounded, read-only, offline verification/replay scan. No licensed data transport.
import {createReadStream,existsSync,readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
function walk(dir){return !existsSync(dir)?[]:readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
async function hashFile(path){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(path,{highWaterMark:65536})){hash.update(chunk);bytes+=chunk.length;}
 return {bytes,sha256:hash.digest('hex')};
}
export async function scanEngine18ReplayBounded(root,{onRecord=()=>{},maxLineBytes=16*1024*1024}={}){
 const base=resolve(root),paths=walk(base);
 if(paths.some(p=>p.endsWith('.jsonl.open')))throw Error('recovery required before verified scan');
 if(paths.some(p=>p.endsWith('.integrity-unverified.json')))throw Error('integrity UNVERIFIED');
 const checkpoint=join(base,'.engine18-highwater.json');
 if(!existsSync(checkpoint))throw Error('missing high-watermark checkpoint');
 const expected=JSON.parse(readFileSync(checkpoint,'utf8')).lastSeq;
 if(!Number.isSafeInteger(expected)||expected<0)throw Error('invalid high-watermark');
 const segments=[];
 for(const path of paths.filter(p=>p.endsWith('.jsonl.gz'))){
  if(!existsSync(path+'.manifest.json'))throw Error('archive manifest missing');
  const manifest=JSON.parse(readFileSync(path+'.manifest.json','utf8'));
  if(!Number.isSafeInteger(manifest.firstSeq)||manifest.firstSeq<1||
     !Number.isSafeInteger(manifest.lastSeq)||manifest.lastSeq<manifest.firstSeq||
     !Number.isSafeInteger(manifest.count)||manifest.count!==manifest.lastSeq-manifest.firstSeq+1)
   throw Error('invalid verified archive sequence range');
  const h=await hashFile(path);
  if(manifest.sha256!==h.sha256||manifest.bytes!==h.bytes)throw Error('archive manifest digest mismatch');
  segments.push({path,manifest,bytes:h.bytes});
 }
 // File names such as part-10 and part-2 are NOT sequence order.
 segments.sort((a,b)=>a.manifest.firstSeq-b.manifest.firstSeq);
 let sequence=0,records=0,compressedBytes=0,maxBufferedBytes=0;
 for(const {path,manifest,bytes} of segments){
  if(manifest.firstSeq!==sequence+1)throw Error('missing or duplicate sequence across archive manifests');
  compressedBytes+=bytes;
  let lineBuffer=Buffer.alloc(0),count=0,firstSeq=null,lastSeq=null;
  const decompressed=createReadStream(path,{highWaterMark:65536}).pipe(createGunzip());
  for await(const chunk of decompressed){
   lineBuffer=Buffer.concat([lineBuffer,chunk]);
   if(lineBuffer.length>maxLineBytes&&lineBuffer.indexOf(10)<0)throw Error('oversized raw envelope');
   let idx;
   while((idx=lineBuffer.indexOf(10))>=0){
    const line=lineBuffer.subarray(0,idx);
    if(line.length>maxLineBytes)throw Error('oversized raw envelope');
    const e=JSON.parse(line.toString('utf8'));
    if(e.schemaVersion!=='engine18.raw.v2'||!Number.isSafeInteger(e.localSeq)||
       typeof e.raw!=='string'||typeof e.runId!=='string'||
       (e.rawEncoding!=='utf8'&&e.rawEncoding!=='base64'))throw Error('invalid replay envelope');
    if(e.localSeq!==sequence+1)throw Error('missing or duplicate sequence');
    sequence=e.localSeq;lastSeq=sequence;if(firstSeq===null)firstSeq=sequence;count++;records++;
    await onRecord(e); // bounded, sequential consumer; no event list accumulation
    lineBuffer=lineBuffer.subarray(idx+1);
   }
   maxBufferedBytes=Math.max(maxBufferedBytes,lineBuffer.length);
   if(lineBuffer.length>maxLineBytes)throw Error('oversized raw envelope');
  }
  if(lineBuffer.length)throw Error('truncated compressed JSONL');
  if(count!==manifest.count||firstSeq!==manifest.firstSeq||lastSeq!==manifest.lastSeq)throw Error('manifest sequence/count mismatch');
 }
 if(sequence!==expected)throw Error('high-watermark tail mismatch');
 return {schema:'engine18.replay.scan.v1',records,lastSeq:sequence,compressedBytes,maxBufferedBytes,
  peakRssBytes:process.memoryUsage().rss}; // sampled RSS is not a guaranteed peak
}
