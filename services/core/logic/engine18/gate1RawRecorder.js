// Engine 18 Gate 1: offline-only, synthetic raw recorder. No live feed integration.
import {mkdirSync,openSync,writeSync,fsyncSync,closeSync,ftruncateSync,readFileSync,readdirSync,renameSync,unlinkSync,existsSync,writeFileSync,statSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';

export const SCHEMA='engine18.raw.v2';
const classes=new Set(['market','control','error','unknown']);
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const ident=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(v)||v==='.'||v==='..')throw Error('invalid partition identifier');return v;};
const walk=dir=>!existsSync(dir)?[]:readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
function syncDir(path){const fd=openSync(dirname(path),'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function atomic(path,data){
 const tmp=path+'.tmp';
 const fd=openSync(tmp,'wx',0o600);
 try{const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(n<=0)throw Error('short atomic write');offset+=n;}fsyncSync(fd);}
 finally{closeSync(fd);}
 renameSync(tmp,path);syncDir(path);
}
function unlinkDurably(path){unlinkSync(path);syncDir(path);}
function manifestFor(gzip,entries,calendarVersion){
 return {schemaVersion:'engine18.manifest.v1',sha256:digest(gzip),bytes:gzip.length,count:entries.length,firstSeq:entries[0].localSeq,lastSeq:entries.at(-1).localSeq,firstWallNs:entries[0].receivedWallNs,lastWallNs:entries.at(-1).receivedWallNs,calendarVersion};
}
const CHECKPOINT='.engine18-highwater.json';
function checkpointPath(root){return join(root,CHECKPOINT);}
function loadCheckpoint(root){
 const p=checkpointPath(root);
 if(!existsSync(p))return null;
 const x=JSON.parse(readFileSync(p,'utf8'));
 if(x.schemaVersion!=='engine18.checkpoint.v1'||!Number.isSafeInteger(x.lastSeq)||x.lastSeq<0)throw Error('invalid high-watermark checkpoint');
 return x.lastSeq;
}
function saveCheckpoint(root,lastSeq){
 const p=checkpointPath(root),old=loadCheckpoint(root);
 if(old!==null&&lastSeq<old)throw Error('checkpoint cannot regress');
 atomic(p,JSON.stringify({schemaVersion:'engine18.checkpoint.v1',lastSeq})+'\n');
}
function recoverArchiveManifest(path){
 if(!existsSync(path+'.manifest.json')){
  // Missing origin manifest is NOT equivalent to a fresh trustworthy checksum.
  const marker=path+'.integrity-unverified.json';
  if(!existsSync(marker))atomic(marker,JSON.stringify({schemaVersion:'engine18.integrity.v1',state:'UNVERIFIED',reason:'ORIGINAL_MANIFEST_MISSING'})+'\n');
  throw Error('original archive manifest missing: integrity UNVERIFIED; operator review required');
 }
 return verify(path);
}
function lockRoot(root){
 const lock=join(root,'.engine18-recorder.lock');
 const take=()=>{const fd=openSync(lock,'wx',0o600);try{writeSync(fd,Buffer.from(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()})+'\n'));fsyncSync(fd);}finally{closeSync(fd);}syncDir(lock);};
 try{take();}catch(e){
  if(e.code!=='EEXIST')throw e;
  let info;try{info=JSON.parse(readFileSync(lock,'utf8'));}catch{throw Error('unreadable recorder lock requires operator inspection');}
  if(!Number.isSafeInteger(info.pid)||info.pid<=0)throw Error('invalid recorder lock requires operator inspection');
  try{process.kill(info.pid,0);throw Error('recorder writer already active');}
  catch(err){if(err.code==='EPERM')throw Error('recorder writer ownership unknown');if(err.code!=='ESRCH')throw err;}
  // A dead same-host PID is recoverable. Network filesystems/multi-host are NOT supported.
  unlinkDurably(lock);take();
 }
 return lock;
}
function validBase64(v){
 if(typeof v!=='string'||v.length%4!==0||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v))return false;
 return Buffer.from(v,'base64').toString('base64')===v;
}
function encodeRaw(raw,rawEncoding){
 if(rawEncoding==='utf8'){if(typeof raw!=='string')throw Error('utf8 raw must be a string');return raw;}
 if(rawEncoding!=='base64')throw Error('invalid rawEncoding');
 if(Buffer.isBuffer(raw)||raw instanceof Uint8Array)return Buffer.from(raw).toString('base64');
 if(!validBase64(raw))throw Error('invalid base64 raw');
 return raw;
}
function parse(buf){
 let pos=0,last=0,entries=[];
 while(pos<buf.length){
  const end=buf.indexOf(10,pos);if(end<0)break;
  let e;try{e=JSON.parse(buf.subarray(pos,end).toString('utf8'));}catch{throw Error('corrupt complete JSONL line');}
  if(e.schemaVersion!==SCHEMA||!Number.isSafeInteger(e.localSeq)||e.localSeq<=last||
   typeof e.runId!=='string'||!/^[a-f0-9-]{36}$/.test(e.runId)||
   typeof e.raw!=='string'||typeof e.receivedWallNs!=='string'||typeof e.receivedMonoNs!=='string'||typeof e.writtenMonoNs!=='string'||
   !/^\\d+$/.test(e.receivedWallNs)||!/^\\d+$/.test(e.receivedMonoNs)||!/^\\d+$/.test(e.writtenMonoNs)||
   (e.rawEncoding!=='utf8'&&e.rawEncoding!=='base64')||!classes.has(e.msgClass))throw Error('invalid raw record');
  if(e.rawEncoding==='base64'&&!validBase64(e.raw))throw Error('invalid encoded binary');
  entries.push(e);last=e.localSeq;pos=end+1;
 }
 return {entries,bytes:pos};
}
function tradeDate(d){
 // Provisional normal CME equity-index ETH 17:00 Chicago boundary, NOT holiday-aware.
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
 return new Date(Date.UTC(+p.year,+p.month-1,+p.day+(+p.hour>=17?1:0))).toISOString().slice(0,10);
}
function verify(path){
 const compressed=readFileSync(path),manifest=JSON.parse(readFileSync(path+'.manifest.json','utf8'));
 if(digest(compressed)!==manifest.sha256||compressed.length!==manifest.bytes)throw Error('manifest sha256 mismatch');
 const plain=gunzipSync(compressed),parsed=parse(plain);
 if(parsed.bytes!==plain.length||parsed.entries.length!==manifest.count||parsed.entries[0]?.localSeq!==manifest.firstSeq||parsed.entries.at(-1)?.localSeq!==manifest.lastSeq)throw Error('replay manifest mismatch');
 return parsed.entries;
}
export class Engine18RawRecorder{
 constructor({root,provider='SYNTHETIC',physicalContract='XCME_ES_Z26',clock,calendarVersion='cme-eth-provisional-v1'}={}){
  if(!root||!clock||typeof clock.wallNs!=='function'||typeof clock.monoNs!=='function')throw Error('root and clock required');
  this.root=resolve(root);this.provider=ident(provider);this.contract=ident(physicalContract);
  if(provider!=='SYNTHETIC')throw Error('live raw collection disabled pending owner authorization');
  this.clock=clock;this.calendarVersion=calendarVersion;this.path=null;this.fd=null;this.seq=0;this.frames=0;this.bytes=0;this.gaps=0;this.writeErrors=0;this.lastMono=null;this.faulted=false;
  this.runId=randomUUID();this.previousUnclean=false;this.previousRunId=null;
  mkdirSync(this.root,{recursive:true,mode:0o700});
  this.lockPath=lockRoot(this.root);this.recoveredOpen=0;
  try{
   this.recover();
   if(this.previousUnclean)this.append({raw:'',msgClass:'control',streamGeneration:0,statusCode:'GAP'});
   this.append({raw:'',msgClass:'control',streamGeneration:0,statusCode:'RECORDER_START'});
  }
  catch(e){this.releaseLock();throw e;}
 }
 recover(){
  let last=0;
  const checkpointTemp=checkpointPath(this.root)+'.tmp';
  if(existsSync(checkpointTemp)){
    if(!existsSync(checkpointPath(this.root)))throw Error('orphan high-watermark checkpoint temp requires inspection');
    unlinkDurably(checkpointTemp);
  }
  const highWater=loadCheckpoint(this.root);
  // Crash between atomic temp fsync and rename: only discard temps when
  // the source .open file or completed archive can independently be verified.
  for(const temp of walk(this.root).filter(x=>x.endsWith('.jsonl.gz.tmp')||x.endsWith('.manifest.json.tmp'))){
    if(temp.endsWith('.jsonl.gz.tmp')){
      const source=temp.replace(/\.jsonl\.gz\.tmp$/,'.jsonl.open');
      const archive=temp.slice(0,-4);
      if(!existsSync(source)&&!existsSync(archive))throw Error('orphan compressed temp requires operator inspection');
    }else{
      const archive=temp.replace(/\.manifest\.json\.tmp$/,'');
      if(!existsSync(archive))throw Error('orphan manifest temp requires operator inspection');
    }
    unlinkDurably(temp);
  }
  // Existing archives are checked first, including a crash between archive rename and manifest commit.
  for(const path of walk(this.root).filter(x=>x.endsWith('.jsonl.gz')).sort()){
   const e=recoverArchiveManifest(path);last=Math.max(last,e.at(-1)?.localSeq??0);
  }
  for(const path of walk(this.root).filter(x=>x.endsWith('.jsonl.open')).sort()){
    const buf=readFileSync(path),p=parse(buf);
    if(p.bytes!==buf.length){const fd=openSync(path,'r+');try{ftruncateSync(fd,p.bytes);fsyncSync(fd);}finally{closeSync(fd);}}
    const dest=path.replace(/\.jsonl\.open$/,'.jsonl.gz');
    if(existsSync(dest)){
      // Orphan .open from a successful compressed write: verify same content before removing.
      const gz=gunzipSync(readFileSync(dest));
      if(!gz.equals(readFileSync(path)))throw Error('archive and open file conflict');
      unlinkDurably(path);
    }else if(p.entries.length)this.finish(path,p.entries);
    else unlinkDurably(path);
    last=Math.max(last,p.entries.at(-1)?.localSeq??0);this.recoveredOpen++;
  }
  if(highWater!==null&&last<highWater)throw Error('high-watermark checkpoint proves missing tail archive');
  this.seq=last;this.gaps+=this.recoveredOpen;
  if(highWater===null&&last>0)throw Error('missing historical high-watermark checkpoint; operator review required');
  if(last>0&&last!==highWater)saveCheckpoint(this.root,last);
  const events=replayRaw(this.root);
  const prior=events.at(-1);
  this.previousRunId=prior?.runId??null;
  this.previousUnclean=!!prior&&prior.statusCode!=='RECORDER_STOP';
  this.gaps=events.filter(e=>e.statusCode==='GAP').length;
 }
 finish(path,entries){
  const dest=path.replace(/\.jsonl\.open$/,'.jsonl.gz');
  if(existsSync(dest))throw Error('archive collision');
  const gzip=gzipSync(readFileSync(path),{mtime:0});
  atomic(dest,gzip);
  atomic(dest+'.manifest.json',JSON.stringify(manifestFor(gzip,entries,this.calendarVersion))+'\n');
  unlinkDurably(path);
 }
 rotate(){
  if(this.fd===null)return;
  fsyncSync(this.fd);closeSync(this.fd);this.fd=null;
  const path=this.path;this.path=null;
  const buf=readFileSync(path),p=parse(buf);
  if(p.bytes!==buf.length)throw Error('incomplete active record');
  if(p.entries.length)this.finish(path,p.entries);else unlinkDurably(path);
 }
 // Capture at the receipt boundary BEFORE any rotation, disk I/O or fsync.
 capture({raw,msgClass='unknown',streamGeneration=0,at,rawEncoding='utf8',statusCode=null}={}){
  if(this.faulted)throw Error('recorder faulted; restart and recover before new writes');
  if(!classes.has(msgClass)||!Number.isSafeInteger(streamGeneration)||streamGeneration<0)throw Error('invalid frame');
  if(statusCode!==null&&!/^[A-Z_]{1,40}$/.test(statusCode))throw Error('unsafe status code');
  const payload=encodeRaw(raw,rawEncoding);
  if(at!==undefined&&(!(at instanceof Date)||!Number.isFinite(at.getTime())))throw Error('invalid receipt time');
  const receivedWallNs=at!==undefined?String(BigInt(at.getTime())*1000000n):String(this.clock.wallNs());
  const receivedMonoNs=String(this.clock.monoNs());
  if(!/^\\d+$/.test(receivedWallNs)||!/^\\d+$/.test(receivedMonoNs))throw Error('invalid receipt clock');
  const receiptDate=new Date(Number(BigInt(receivedWallNs)/1000000n));
  if(!Number.isFinite(receiptDate.getTime()))throw Error('invalid receipt wall time');
  return Object.freeze({raw:payload,rawEncoding,msgClass,streamGeneration,statusCode,receivedWallNs,receivedMonoNs,receiptDate});
 }
 append(args){return this.appendReceived(this.capture(args));}
 appendReceived(receipt){
  if(this.faulted)throw Error('recorder faulted; restart and recover before new writes');
  if(!receipt||typeof receipt.receivedWallNs!=='string'||!/^\\d+$/.test(receipt.receivedWallNs)||
     typeof receipt.receivedMonoNs!=='string'||!/^\\d+$/.test(receipt.receivedMonoNs)||
     !classes.has(receipt.msgClass)||!Number.isSafeInteger(receipt.streamGeneration)||receipt.streamGeneration<0||
     !Number.isFinite(receipt.receiptDate?.getTime())||
     (receipt.statusCode!==null&&!/^[A-Z_]{1,40}$/.test(receipt.statusCode)))throw Error('invalid captured receipt');
  const raw=encodeRaw(receipt.raw,receipt.rawEncoding);
  if(this.lastMono!==null&&BigInt(receipt.receivedMonoNs)<BigInt(this.lastMono))throw Error('monotonic clock regression in recording run');
  const at=receipt.receiptDate;
  const stem=join(this.root,this.provider,this.contract,tradeDate(at),at.toISOString().slice(0,13).replace('T','-'));
  let path=stem+'.jsonl.open';
  if(this.path?.startsWith(stem+'.part-'))path=this.path;
  else if(existsSync(stem+'.jsonl.gz')){let n=1;while(existsSync(stem+`.part-${n}.jsonl.gz`)||existsSync(stem+`.part-${n}.jsonl.open`))n++;path=stem+`.part-${n}.jsonl.open`;}
  if(path!==this.path){this.rotate();mkdirSync(dirname(path),{recursive:true,mode:0o700});this.fd=openSync(path,'a',0o600);this.path=path;}
  const writtenMonoNs=String(this.clock.monoNs());
  if(!/^\\d+$/.test(writtenMonoNs)||BigInt(writtenMonoNs)<BigInt(receipt.receivedMonoNs))throw Error('invalid written monotonic timestamp');
  const item={schemaVersion:SCHEMA,localSeq:this.seq+1,runId:this.runId,receivedWallNs:receipt.receivedWallNs,receivedMonoNs:receipt.receivedMonoNs,writtenMonoNs,streamGeneration:receipt.streamGeneration,msgClass:receipt.msgClass,statusCode:receipt.statusCode,rawEncoding:receipt.rawEncoding,raw};
  const line=Buffer.from(JSON.stringify(item)+'\\n');
  try{let offset=0;while(offset<line.length){const n=writeSync(this.fd,line,offset,line.length-offset);if(n<=0)throw Error('short write');offset+=n;}fsyncSync(this.fd);}catch{this.writeErrors++;this.faulted=true;throw Error('recorder write failed; recovery required');}
  this.seq++;
  try{saveCheckpoint(this.root,this.seq);}catch{this.writeErrors++;this.faulted=true;throw Error('checkpoint failed; recovery required');}
  this.frames++;this.bytes+=line.length;this.lastMono=receipt.receivedMonoNs;
  if(receipt.statusCode==='GAP')this.gaps++;
  return {localSeq:this.seq,runId:this.runId};
 }
 health(){return Object.freeze({schemaVersion:'engine18.health.v1',provider:this.provider,physicalContract:this.contract,frames:this.frames,bytesWritten:this.bytes,lastSeq:this.seq,gaps:this.gaps,writeErrors:this.writeErrors,recording:this.fd!==null,runId:this.runId});}
 releaseLock(){if(this.lockPath&&existsSync(this.lockPath)){unlinkDurably(this.lockPath);this.lockPath=null;}}
 close(){try{if(this.fd!==null&&!this.faulted||this.fd===null&&!this.faulted)this.append({raw:'',msgClass:'control',statusCode:'RECORDER_STOP'});this.rotate();}finally{this.releaseLock();}}
}
export function replayRaw(root){
 const paths=walk(resolve(root));
 if(paths.some(p=>p.endsWith('.jsonl.open')))throw Error('unfinalized open archive; recover before replay');
 if(paths.some(p=>p.endsWith('.integrity-unverified.json')))throw Error('archive integrity UNVERIFIED');
 const all=paths.filter(p=>p.endsWith('.jsonl.gz')).sort().flatMap(verify).sort((a,b)=>a.localSeq-b.localSeq);
 if(all.length&&all[0].localSeq!==1)throw Error('missing initial recorder sequence');
 for(let i=1;i<all.length;i++)if(all[i].localSeq!==all[i-1].localSeq+1)throw Error('replay sequence gap or duplicate');
 const highWater=loadCheckpoint(resolve(root));
 if(highWater===null&&all.length)throw Error('missing high-watermark checkpoint');
 if(highWater!==null&&(all.at(-1)?.localSeq??0)!==highWater)throw Error('high-watermark mismatch: missing archive or uncommitted tail');
 return all;
}
export const deterministicReplayBytes=root=>Buffer.from(replayRaw(root).map(e=>JSON.stringify(e)).join('\n')+'\n');
