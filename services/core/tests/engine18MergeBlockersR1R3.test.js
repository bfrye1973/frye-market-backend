import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,existsSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Engine18RawRecorder,replayRaw} from '../logic/engine18/gate1RawRecorder.js';
import {scanEngine18ReplayBounded} from '../logic/engine18/engine18BoundedReplayScan.js';
import {parseChronyReferenceUtc,parseChronyTracking} from '../logic/engine18/engine18ClockQuality.js';

const withRoot=async fn=>{
 const root=mkdtempSync(join(tmpdir(),'e18-r1r3-'));
 try{await fn(root);}finally{rmSync(root,{recursive:true,force:true});}
};
const clock=()=>({
 wallNs:()=>String(BigInt(Date.parse('2026-11-10T21:00:00Z'))*1000000n),
 monoNs:(()=>{let n=0n;return ()=>String(++n);})()
});
const files=root=>readdirSync(root,{recursive:true}).map(x=>join(root,x));
const rawMarket=e=>e.filter(x=>x.msgClass==='market').map(x=>x.raw);
const fault=stage=>{if(stage==='AFTER_ARCHIVE_RENAME_BEFORE_MANIFEST')throw Error('SIMULATED_RENAME_MANIFEST_CRASH');};

test('R1 streaming rotate crash after gzip rename with intact open reconstructs trusted manifest',()=>withRoot(async root=>{
 const first=await Engine18RawRecorder.openBounded({root,clock:clock(),testFault:fault});
 const original=' { "d": [ {"sz":0,"l":2,"v":1.2500} ], "raw":"unchanged" } ';
 first.append({raw:original,msgClass:'market'});
 await assert.rejects(first.rotateStreaming(),/SIMULATED_RENAME_MANIFEST_CRASH/);
 first.releaseLock();
 let names=files(root);const gz=names.find(p=>p.endsWith('.jsonl.gz'));
 assert.ok(gz);assert.ok(existsSync(gz.replace(/\.gz$/,'.open')));
 assert.ok(!existsSync(gz+'.manifest.json'));
 const recovered=await Engine18RawRecorder.openBounded({root,clock:clock()});
 recovered.close();
 names=files(root);
 assert.ok(existsSync(gz+'.manifest.json'));
 assert.ok(!names.some(p=>p.endsWith('.integrity-unverified.json')));
 assert.deepEqual(rawMarket(replayRaw(root)),[original]);
 const hashes=[];
 for(let i=0;i<2;i++){
  const hash=createHash('sha256');
  await scanEngine18ReplayBounded(root,{onRecord:e=>hash.update(JSON.stringify(e)+'\n')});
  hashes.push(hash.digest('hex'));
 }
 assert.equal(hashes[0],hashes[1]);
}));

test('R1 bounded finalizeOpen crash after rename reconstructs archive from intact open',()=>withRoot(async root=>{
 const original='{"trade":"exact 7500.2500","qty":01}';
 const first=new Engine18RawRecorder({root,clock:clock()});
 first.append({raw:original,msgClass:'market'});
 closeSync(first.fd);first.fd=null;first.releaseLock(); // crash with valid .open, no STOP
 await assert.rejects(Engine18RawRecorder.openBounded({root,clock:clock(),testFault:fault}),
  /SIMULATED_RENAME_MANIFEST_CRASH/);
 const names=files(root),gz=names.find(p=>p.endsWith('.jsonl.gz'));
 assert.ok(gz);assert.ok(!existsSync(gz+'.manifest.json'));
 assert.ok(existsSync(gz.replace(/\.gz$/,'.open')));
 const recovered=await Engine18RawRecorder.openBounded({root,clock:clock()});recovered.close();
 assert.deepEqual(rawMarket(replayRaw(root)),[original]);
 assert.ok(existsSync(gz+'.manifest.json'));
 assert.ok(!files(root).some(p=>p.endsWith('.integrity-unverified.json')));
}));

test('R1 legacy synchronous finalization crash recovers without permanent UNVERIFIED marker',()=>withRoot(async root=>{
 const writer=new Engine18RawRecorder({root,clock:clock(),testFault:fault});
 writer.append({raw:'LEGACY_EXACT',msgClass:'market'});
 assert.throws(()=>writer.rotate(),/SIMULATED_RENAME_MANIFEST_CRASH/);
 writer.releaseLock();
 const recovered=new Engine18RawRecorder({root,clock:clock()});recovered.close();
 assert.deepEqual(rawMarket(replayRaw(root)),['LEGACY_EXACT']);
 assert.ok(!files(root).some(p=>p.endsWith('.integrity-unverified.json')));
}));

test('R1 fail-closed when archive cannot be matched to intact source',()=>withRoot(async root=>{
 const first=await Engine18RawRecorder.openBounded({root,clock:clock(),testFault:fault});
 first.append({raw:'original',msgClass:'market'});
 await assert.rejects(first.rotateStreaming(),/SIMULATED_RENAME_MANIFEST_CRASH/);first.releaseLock();
 const gz=files(root).find(p=>p.endsWith('.jsonl.gz'));
 const originalOpen=gz.replace(/\.gz$/,'.open');
 // Same sequence but modified contents: does not authorize manifest reconstruction.
 const old=readFileSync(originalOpen,'utf8');writeFileSync(originalOpen,old.replace('original','tampered'));
 await assert.rejects(Engine18RawRecorder.openBounded({root,clock:clock()}),/conflicting archive bytes|conflicting archive\/open evidence/);
 assert.ok(!existsSync(gz+'.manifest.json'));
 unlinkSync(originalOpen);
 await assert.rejects(Engine18RawRecorder.openBounded({root,clock:clock()}),/UNVERIFIED/);
 assert.ok(existsSync(gz+'.integrity-unverified.json'));
}));

test('R1 previously written ORIGINAL_MANIFEST_MISSING marker is cleared only with verified open source',()=>withRoot(async root=>{
 const first=await Engine18RawRecorder.openBounded({root,clock:clock(),testFault:fault});
 first.append({raw:'valid proof',msgClass:'market'});
 await assert.rejects(first.rotateStreaming(),/SIMULATED_RENAME_MANIFEST_CRASH/);first.releaseLock();
 const gz=files(root).find(p=>p.endsWith('.jsonl.gz'));
 writeFileSync(gz+'.integrity-unverified.json',JSON.stringify({
  schemaVersion:'engine18.integrity.v1',state:'UNVERIFIED',reason:'ORIGINAL_MANIFEST_MISSING'
 })+'\n');
 const second=await Engine18RawRecorder.openBounded({root,clock:clock()});
 second.close();assert.deepEqual(rawMarket(replayRaw(root)),['valid proof']);
 assert.ok(!existsSync(gz+'.integrity-unverified.json'));
}));

test('R2 >=12 same-hour segments part-2 vs part-10 replay by verified firstSeq',()=>withRoot(async root=>{
 const writer=await Engine18RawRecorder.openBounded({root,clock:clock()});
 const source=[];
 for(let i=0;i<14;i++){
  const raw='segment-'+i+' {"p":7500.2500,"l":'+i+'}';
  source.push(raw);writer.append({raw,msgClass:'market'});
  await writer.rotateStreaming();
 }
 await writer.closeStreaming();
 const gz=files(root).filter(p=>p.endsWith('.jsonl.gz'));
 assert.ok(gz.length>=14);
 assert.ok(gz.some(p=>p.includes('.part-10.')));
 assert.ok(gz.some(p=>p.includes('.part-2.')));
 const collected=[];
 const scan=await scanEngine18ReplayBounded(root,{onRecord:e=>{if(e.msgClass==='market')collected.push(e.raw);}});
 assert.deepEqual(collected,source);
 assert.equal(scan.records,16); // START, 14 raw frames, STOP
 assert.deepEqual(rawMarket(replayRaw(root)),source);
 const hashes=[];
 for(let i=0;i<2;i++){
  const hash=createHash('sha256');
  await scanEngine18ReplayBounded(root,{onRecord:e=>hash.update(JSON.stringify(e)+'\n')});
  hashes.push(hash.digest('hex'));
 }
 assert.equal(hashes[0],hashes[1]);
}));

test('R2 detects deleted and duplicate manifest ranges',()=>withRoot(async root=>{
 const writer=new Engine18RawRecorder({root,clock:clock()});
 for(let i=0;i<4;i++){writer.append({raw:'f'+i,msgClass:'market'});writer.rotate();}
 writer.close();
 const gz=files(root).filter(p=>p.endsWith('.jsonl.gz'));
 const manifests=gz.map(p=>({p,m:JSON.parse(readFileSync(p+'.manifest.json','utf8'))}))
  .sort((a,b)=>a.m.firstSeq-b.m.firstSeq);
 const second=manifests[1];
 const original=readFileSync(second.p+'.manifest.json');
 const changed={...second.m,firstSeq:manifests[0].m.firstSeq,lastSeq:manifests[0].m.lastSeq,count:manifests[0].m.count};
 writeFileSync(second.p+'.manifest.json',JSON.stringify(changed));
 await assert.rejects(scanEngine18ReplayBounded(root),/missing or duplicate sequence|manifest sequence\/count mismatch/);
 writeFileSync(second.p+'.manifest.json',original);
 unlinkSync(second.p);unlinkSync(second.p+'.manifest.json');
 await assert.rejects(scanEngine18ReplayBounded(root),/missing or duplicate sequence/);
}));

test('R3 reference time is UTC in both host timezones and malformed dates fail closed',()=>{
 const text=['Stratum : 3','Ref time (UTC) : Tue Nov 10 20:59:30 2026',
  'System time : 0.0000123 seconds slow of NTP time',
  'RMS offset : 0.000002 seconds','Root dispersion : 0.000005 seconds','Leap status : Normal'].join('\n');
 const now=Date.UTC(2026,10,10,21,0,0);
 assert.equal(parseChronyReferenceUtc('Tue Nov 10 20:59:30 2026'),Date.UTC(2026,10,10,20,59,30));
 assert.equal(parseChronyTracking(text,{nowMs:now}).offsetNs,'-12300');
 assert.equal(parseChronyReferenceUtc('Tue Feb 30 20:59:30 2026'),null);
 assert.equal(parseChronyReferenceUtc('Tue Nov 10 20:59:30 2026 PST'),null);
 assert.equal(parseChronyReferenceUtc('Mon Nov 10 20:59:30 2026'),null);
});

test('R1 abandoned atomic manifest temp is reconciled only from exact open source',()=>withRoot(async root=>{
 const first=await Engine18RawRecorder.openBounded({root,clock:clock(),testFault:fault});
 first.append({raw:'source with exact 7500.2500',msgClass:'market'});
 await assert.rejects(first.rotateStreaming(),/SIMULATED_RENAME_MANIFEST_CRASH/);
 first.releaseLock();
 const gz=files(root).find(p=>p.endsWith('.jsonl.gz'));
 writeFileSync(gz+'.manifest.json.tmp','{"incomplete":');
 const recovered=await Engine18RawRecorder.openBounded({root,clock:clock()});
 recovered.close();
 assert.deepEqual(rawMarket(replayRaw(root)),['source with exact 7500.2500']);
 assert.ok(!existsSync(gz+'.manifest.json.tmp'));
 assert.ok(existsSync(gz+'.manifest.json'));
 assert.ok(!files(root).some(p=>p.endsWith('.integrity-unverified.json')));
}));
test('R1 legacy abandoned manifest temp is reconciled after matching gzip and open',()=>withRoot(async root=>{
 const first=new Engine18RawRecorder({root,clock:clock(),testFault:fault});
 first.append({raw:'legacy source exact',msgClass:'market'});
 assert.throws(()=>first.rotate(),/SIMULATED_RENAME_MANIFEST_CRASH/);
 first.releaseLock();
 const gz=files(root).find(p=>p.endsWith('.jsonl.gz'));
 writeFileSync(gz+'.manifest.json.tmp','partial');
 const recovered=new Engine18RawRecorder({root,clock:clock()});
 recovered.close();
 assert.deepEqual(rawMarket(replayRaw(root)),['legacy source exact']);
 assert.ok(!existsSync(gz+'.manifest.json.tmp'));
 assert.ok(!files(root).some(p=>p.endsWith('.integrity-unverified.json')));
}));
