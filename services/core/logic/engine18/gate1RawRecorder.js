// Engine 18 Gate 1: offline-only, synthetic raw recorder. No live feed integration.
import {mkdirSync,openSync,writeSync,fsyncSync,closeSync,ftruncateSync,readFileSync,readdirSync,renameSync,unlinkSync,existsSync,writeFileSync,statSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

export const SCHEMA='engine18.raw.v1';
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
 return {schemaVersion:'engine18.manifest.v1',sha256:digest(gzip),bytes:gzip.length,count:entries.length,firstSeq:entries[0].localSeq,lastSeq:entries.at(-1).localSeq,firstWallNs:entries[0].tLocalWallNs,lastWallNs:entries.at(-1).tLocalWallNs,calendarVersion};
}
function recoverArchiveManifest(path,calendarVersion){
 const gzip=readFileSync(path),plain=gunzipSync(gzip),parsed=parse(plain);
 if(!parsed.entries.length||parsed.bytes!==plain.length)throw Error('invalid orphan archive');
 if(!existsSync(path+'.manifest.json'))atomic(path+'.manifest.json',JSON.stringify(manifestFor(gzip,parsed.entries,calendarVersion))+'\n');
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
function parse(buf){
 let pos=0,last=0,entries=[];
 while(pos<buf.length){
  const end=buf.indexOf(10,pos);if(end<0)break;
  let e;try{e=JSON.parse(buf.subarray(pos,end).toString('utf8'));}catch{throw Error('corrupt complete JSONL line');}
  if(e.schemaVersion!==SCHEMA||!Number.isSafeInteger(e.localSeq)||e.localSeq<=last||typeof e.raw!=='string'||typeof e.tLocalWallNs!=='string'||typeof e.tLocalMonoNs!=='string'||!classes.has(e.msgClass))throw Error('invalid raw record');
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
  this.clock=clock;this.calendarVersion=calendarVersion;this.path=null;this.fd=null;this.seq=0;this.frames=0;this.bytes=0;this.gaps=0;this.writeErrors=0;this.lastMono=null;
  mkdirSync(this.root,{recursive:true,mode:0o700});
  this.lockPath=lockRoot(this.root);this.recoveredOpen=0;
  try{this.recover();if(this.recoveredOpen)this.append({raw:'',msgClass:'control',streamGeneration:0,statusCode:'GAP',at:new Date()});}
  catch(e){this.releaseLock();throw e;}
 }
 recover(){
  let last=0;
  // Crash between atomic temp fsync and rename: only discard temps when
  // the source .open file or completed archive can independently be verified.
  for(const temp of walk(this.root).filter(x=>x.endsWith('.jsonl.gz.tmp')||x.endsWith('.manifest.json.tmp'))){
    if(temp.endsWith('.jsonl.gz.tmp')){
      const source=temp.replace(/\\.jsonl\\.gz\\.tmp$/,'.jsonl.open');
      const archive=temp.slice(0,-4);
      if(!existsSync(source)&&!existsSync(archive))throw Error('orphan compressed temp requires operator inspection');
    }else{
      const archive=temp.replace(/\\.manifest\\.json\\.tmp$/,'.gz');
      if(!existsSync(archive))throw Error('orphan manifest temp requires operator inspection');
    }
    unlinkDurably(temp);
  }
  // Existing archives are checked first, including a crash between archive rename and manifest commit.
  for(const path of walk(this.root).filter(x=>x.endsWith('.jsonl.gz')).sort()){
   const e=recoverArchiveManifest(path,this.calendarVersion);last=Math.max(last,e.at(-1)?.localSeq??0);
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
  this.seq=last;this.gaps+=this.recoveredOpen;
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
 append({raw,msgClass='unknown',streamGeneration=0,at=new Date(),statusCode=null}={}){
  if(typeof raw!=='string'||!classes.has(msgClass)||!Number.isSafeInteger(streamGeneration)||streamGeneration<0)throw Error('invalid frame');
  if(!(at instanceof Date)||!Number.isFinite(at.getTime()))throw Error('invalid date');
  if(statusCode!==null&&!/^[A-Z_]{1,40}$/.test(statusCode))throw Error('unsafe status code');
  const stem=join(this.root,this.provider,this.contract,tradeDate(at),at.toISOString().slice(0,13).replace('T','-'));
  let path=stem+'.jsonl.open';
  if(this.path?.startsWith(stem+'.part-'))path=this.path;
  else if(existsSync(stem+'.jsonl.gz')){let n=1;while(existsSync(stem+`.part-${n}.jsonl.gz`)||existsSync(stem+`.part-${n}.jsonl.open`))n++;path=stem+`.part-${n}.jsonl.open`;}
  if(path!==this.path){this.rotate();mkdirSync(dirname(path),{recursive:true,mode:0o700});this.fd=openSync(path,'a',0o600);this.path=path;}
  const wall=String(this.clock.wallNs()),mono=String(this.clock.monoNs());
  if(!/^\d+$/.test(wall)||!/^\d+$/.test(mono)||this.lastMono!==null&&BigInt(mono)<BigInt(this.lastMono))throw Error('invalid monotonic or wall clock');
  const item={schemaVersion:SCHEMA,localSeq:this.seq+1,tLocalWallNs:wall,tLocalMonoNs:mono,streamGeneration,msgClass,statusCode,raw};
  const line=Buffer.from(JSON.stringify(item)+'\n');
  try{let offset=0;while(offset<line.length){const n=writeSync(this.fd,line,offset,line.length-offset);if(n<=0)throw Error('short write');offset+=n;}fsyncSync(this.fd);}catch{this.writeErrors++;throw Error('recorder write failed');}
  this.seq++;this.frames++;this.bytes+=line.length;this.lastMono=mono;if(statusCode==='GAP'&&!this.recoveredOpen)this.gaps++;
  return {localSeq:this.seq};
 }
 health(){return Object.freeze({schemaVersion:'engine18.health.v1',provider:this.provider,physicalContract:this.contract,frames:this.frames,bytesWritten:this.bytes,lastSeq:this.seq,gaps:this.gaps,writeErrors:this.writeErrors,recording:this.fd!==null});}
 releaseLock(){if(this.lockPath&&existsSync(this.lockPath)){unlinkDurably(this.lockPath);this.lockPath=null;}}
 close(){try{this.rotate();}finally{this.releaseLock();}}
}
export function replayRaw(root){
 const all=walk(resolve(root)).filter(p=>p.endsWith('.jsonl.gz')).sort().flatMap(verify).sort((a,b)=>a.localSeq-b.localSeq);
 for(let i=1;i<all.length;i++)if(all[i].localSeq!==all[i-1].localSeq+1)throw Error('replay sequence gap or duplicate');
 return all;
}
export const deterministicReplayBytes=root=>Buffer.from(replayRaw(root).map(e=>JSON.stringify(e)).join('\n')+'\n');
