import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,writeFileSync,appendFileSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
 appendFileSync(active,'{"incomplete":');closeSync(r.fd);r.fd=null;
 const r2=new Engine18RawRecorder({root,clock});assert.equal(r2.health().gaps,1);
 r2.append({raw:'second',msgClass:'control'});r2.close();
 assert.deepEqual(replayRaw(root).map(x=>x.raw),['first','second']);
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
