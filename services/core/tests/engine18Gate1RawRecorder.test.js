import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,writeFileSync,appendFileSync,closeSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Engine18RawRecorder,replayRaw,deterministicReplayBytes} from '../logic/engine18/gate1RawRecorder.js';
const clock={wallNs:()=>'1794350000000000000',monoNs:(()=>{let i=0;return ()=>String(++i);})()};
const withDir=fn=>{const root=mkdtempSync(join(tmpdir(),'e18-gate1-'));try{fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const files=root=>readdirSync(root,{recursive:true}).map(x=>join(root,x));
test('exact raw representation, hourly gzip manifests and replay determinism',()=>withDir(root=>{
 const r=new Engine18RawRecorder({root,clock});
 const raw=' { "p": 7560.2500, "sz": 01, "str": "\\u263A" } ';
 r.append({raw,msgClass:'market',at:new Date('2026-11-10T21:59:00Z')});
 r.append({raw:'not valid JSON',msgClass:'unknown',at:new Date('2026-11-10T22:00:00Z')});
 r.close();const events=replayRaw(root);
 assert.deepEqual(events.map(e=>e.localSeq),[1,2]);assert.equal(events[0].raw,raw);
 assert.equal(files(root).filter(p=>p.endsWith('.manifest.json')).length,2);
 assert.deepEqual(deterministicReplayBytes(root),deterministicReplayBytes(root));
}));
test('recover truncated unfinished JSONL and continue without sequence reuse',()=>withDir(root=>{
 const r=new Engine18RawRecorder({root,clock});
 r.append({raw:'first',msgClass:'control'});
 const active=files(root).find(p=>p.endsWith('.jsonl.open'));
 appendFileSync(active,'{"incomplete":');closeSync(r.fd);r.fd=null;r.releaseLock();
 const r2=new Engine18RawRecorder({root,clock});assert.equal(r2.health().gaps,1);
 r2.append({raw:'second',msgClass:'control'});r2.close();
 assert.deepEqual(replayRaw(root).map(x=>x.raw),['first','','second']);assert.equal(replayRaw(root)[1].statusCode,'GAP');
}));
test('reject tampered archive',()=>withDir(root=>{
 const r=new Engine18RawRecorder({root,clock});r.append({raw:'synthetic'});r.close();
 const file=files(root).find(p=>p.endsWith('.jsonl.gz'));writeFileSync(file,'tampered');
 assert.throws(()=>replayRaw(root),/sha256/);
}));
test('block live providers and unsafe path segments',()=>withDir(root=>{
 assert.throws(()=>new Engine18RawRecorder({root,clock,provider:'IRONBEAM_V2'}),/disabled/);
 assert.throws(()=>new Engine18RawRecorder({root,clock,physicalContract:'../private'}),/identifier/);
}));

test('single writer lock and clean shutdown',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock});
 assert.throws(()=>new Engine18RawRecorder({root,clock}),/already active/);
 a.append({raw:'ok'});a.close();
 const b=new Engine18RawRecorder({root,clock});b.append({raw:'second'});b.close();
 assert.deepEqual(replayRaw(root).map(x=>x.raw),['ok','second']);
}));
test('clock regression rejected and health never exposes payload',()=>withDir(root=>{
 let n=4;const localClock={wallNs:()=>String(100+n),monoNs:()=>String(n--)};
 const a=new Engine18RawRecorder({root,clock:localClock});
 a.append({raw:'PRIVATE_SOURCE_MESSAGE'});
 assert.throws(()=>a.append({raw:'secret'}),/clock/);
 assert.ok(!JSON.stringify(a.health()).includes('PRIVATE_SOURCE_MESSAGE'));
 a.close();
}));
test('missing original manifest is marked UNVERIFIED and blocks replay',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock});
 a.append({raw:'z'});a.close();
 const p=files(root).find(x=>x.endsWith('.manifest.json'));
 unlinkSync(p);assert.throws(()=>new Engine18RawRecorder({root,clock}),/UNVERIFIED/);assert.ok(files(root).some(x=>x.endsWith('.integrity-unverified.json')));assert.throws(()=>replayRaw(root),/UNVERIFIED|manifest/);
}));

test('CME ETH normal boundary partitions Sunday evening to Monday trade date',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock});
 a.append({raw:'sunday-evening',at:new Date('2026-11-08T23:30:00Z')});
 a.close();
 assert.ok(files(root).some(x=>x.includes('2026-11-09')));
}));

test('orphan gzip temp after interrupted finalization is safely discarded',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock});a.append({raw:'safe'});
 const active=files(root).find(x=>x.endsWith('.jsonl.open'));
 writeFileSync(active.replace('.jsonl.open','.jsonl.gz.tmp'),'partial gzip');
 closeSync(a.fd);a.fd=null;a.releaseLock();
 const b=new Engine18RawRecorder({root,clock});b.close();
 assert.deepEqual(replayRaw(root).map(x=>x.statusCode||x.raw),['safe','GAP']);
}));
test('orphan manifest temp cannot grant new integrity authority',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock});a.append({raw:'safe'});a.close();
 const manifest=files(root).find(x=>x.endsWith('.manifest.json'));
 writeFileSync(manifest+'.tmp','partial manifest');unlinkSync(manifest);
 assert.throws(()=>new Engine18RawRecorder({root,clock}),/UNVERIFIED/);
 assert.ok(files(root).some(x=>x.endsWith('.integrity-unverified.json')));
}));

test('replay fails closed while open segment is unfinalized',()=>withDir(root=>{
 const r=new Engine18RawRecorder({root,clock});r.append({raw:'open'});
 assert.throws(()=>replayRaw(root),/unfinalized/);r.close();
}));
test('replay rejects missing initial archive',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock});
 a.append({raw:'first',at:new Date('2026-11-10T21:00:00Z')});
 a.append({raw:'second',at:new Date('2026-11-10T22:00:00Z')});a.close();
 const gz=files(root).filter(x=>x.endsWith('.jsonl.gz')).sort();
 unlinkSync(gz[0]);unlinkSync(gz[0]+'.manifest.json');
 assert.throws(()=>replayRaw(root),/missing initial/);
}));

test('deleting final archive plus its manifest is detected by durable high-watermark',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock});
 a.append({raw:'early',at:new Date('2026-11-10T21:30:00Z')});
 a.append({raw:'last',at:new Date('2026-11-10T22:30:00Z')});a.close();
 const gz=files(root).filter(x=>x.endsWith('.jsonl.gz')).sort().at(-1);
 unlinkSync(gz);unlinkSync(gz+'.manifest.json');
 assert.throws(()=>replayRaw(root),/high-watermark/);
 assert.throws(()=>new Engine18RawRecorder({root,clock}),/high-watermark/);
}));
test('tampered archive missing manifest never self-certifies new hash',()=>withDir(root=>{
 const a=new Engine18RawRecorder({root,clock});a.append({raw:'untampered'});a.close();
 const gz=files(root).find(x=>x.endsWith('.jsonl.gz'));
 unlinkSync(gz+'.manifest.json');writeFileSync(gz,'tampered');
 assert.throws(()=>new Engine18RawRecorder({root,clock}),/UNVERIFIED/);
 assert.ok(files(root).some(x=>x.endsWith('.integrity-unverified.json')));
}));
test('independent byte fixture and separate-process replay hash',()=>withDir(root=>{
 const localClock={wallNs:()=> '111',monoNs:()=> '222'};
 const a=new Engine18RawRecorder({root,clock:localClock});a.append({raw:' { "n": 01 } ',msgClass:'market',streamGeneration:7,at:new Date('2026-11-10T21:00:00Z')});a.close();
 const b=new Engine18RawRecorder({root,clock:localClock});b.append({raw:'z',msgClass:'control',streamGeneration:8,at:new Date('2026-11-10T22:00:00Z')});b.close();
 const expected='{"schemaVersion":"engine18.raw.v1","localSeq":1,"tLocalWallNs":"111","tLocalMonoNs":"222","streamGeneration":7,"msgClass":"market","statusCode":null,"raw":" { \\"n\\": 01 } "}\\n'+
 '{"schemaVersion":"engine18.raw.v1","localSeq":2,"tLocalWallNs":"111","tLocalMonoNs":"222","streamGeneration":8,"msgClass":"control","statusCode":null,"raw":"z"}\\n';
 const expectedBytes=Buffer.from(expected.replaceAll('\\n','\n'));
 assert.deepEqual(deterministicReplayBytes(root),expectedBytes);
 const moduleUrl=new URL('../logic/engine18/gate1RawRecorder.js',import.meta.url).href;
 const code=`import {deterministicReplayBytes} from ${JSON.stringify(moduleUrl)};import{createHash}from'node:crypto';process.stdout.write(createHash('sha256').update(deterministicReplayBytes(process.argv[1])).digest('hex'));`;
 const run=spawnSync(process.execPath,['--input-type=module','-e',code,root],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 assert.equal(run.stdout,createHash('sha256').update(expectedBytes).digest('hex'));
}));
test('real SIGKILL then restart: one durable GAP, acknowledged frame retained once',async()=>{
 const root=mkdtempSync(join(tmpdir(),'e18-real-kill-'));
 try{
  const moduleUrl=new URL('../logic/engine18/gate1RawRecorder.js',import.meta.url).href;
  const childCode=`import{Engine18RawRecorder}from ${JSON.stringify(moduleUrl)};const a=new Engine18RawRecorder({root:process.argv[1],clock:{wallNs:()=> '999',monoNs:()=> '888'}});a.append({raw:'ACKNOWLEDGED_FRAME',msgClass:'market'});process.stdout.write('READY\\n');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',childCode,root],{stdio:['ignore','pipe','pipe']});
  let output='';await new Promise((resolve,reject)=>{
   child.stdout.on('data',d=>{output+=d.toString();if(output.includes('READY'))resolve();});
   child.on('error',reject);child.on('exit',code=>reject(new Error('child ended before ack '+code)));
  });
  child.kill('SIGKILL');await once(child,'exit');
  const recovered=new Engine18RawRecorder({root,clock:{wallNs:()=> '1000',monoNs:()=> '1001'}});
  recovered.append({raw:'AFTER_RESTART',msgClass:'market'});recovered.close();
  const all=replayRaw(root);
  assert.deepEqual(all.map(e=>e.localSeq),[1,2,3]);
  assert.deepEqual(all.map(e=>e.raw),['ACKNOWLEDGED_FRAME','','AFTER_RESTART']);
  assert.equal(all[1].statusCode,'GAP');
 }finally{rmSync(root,{recursive:true,force:true});}
});
