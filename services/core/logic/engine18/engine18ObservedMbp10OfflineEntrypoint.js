// Manual OFFLINE analyst: read existing licensed replay locally. Never print prices or raw frames.
// Do not configure as Render start command, run through CI, or call any vendor endpoint.
import {createHash} from 'node:crypto';
import {readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {replayRaw,deterministicReplayBytes} from './gate1RawRecorder.js';
import {analyzeObservedMbp10} from './engine18ObservedMbp10Map.js';
const ROOT='/var/data/engine18-recorder/records';
const PIN='99ed9a7bd60bb9c564178d8ecf3fc448759244996c7066d8a6e0acc0ec42a4b5';
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(x=>{
 const p=join(dir,x.name);return x.isDirectory()?walk(p):[p];
});
try{
 const records=replayRaw(ROOT);
 const sha=createHash('sha256').update(deterministicReplayBytes(ROOT)).digest('hex');
 if(records.length!==492||sha!==PIN)throw Error('REAL_CAPTURE_HASH_MISMATCH');
 const files=walk(ROOT).filter(x=>x.endsWith('.jsonl.gz'));
 if(files.length!==1)throw Error('EXPECTED_SINGLE_CAPTURE_ARCHIVE');
 const compressedBytes=files.reduce((n,x)=>n+statSync(x).size,0);
 const result=analyzeObservedMbp10(records);
 const output={schema:'engine18.mbp10.sanitizedReport.v0',verifiedReplay:true,records:492,
  compressedBytesPerRecorded60s:compressedBytes,...result.summarySafe,
  note:'Time durations are host monotonic observed intervals only; receipt clock UNVERIFIED, no exchange-time inference.'};
 console.log('ENGINE18_OBSERVED_MBP10_SANITIZED '+JSON.stringify(output));
 console.log('ENGINE18_OFFLINE_MBP10: PASS');
}catch{
 console.log('ENGINE18_OFFLINE_MBP10: FAIL_CLOSED');
 process.exitCode=1;
}
