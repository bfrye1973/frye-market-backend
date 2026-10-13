import { readFile,writeFile } from 'node:fs/promises';
import { packResearch,restoreResearch } from '../../../logic/engine11/finalityResearchV1/archive.js';
import { digest } from '../../../logic/engine11/finalityResearchV1/sourceCapture.js';
const original=await readFile(process.argv[2]);const parsed=JSON.parse(original);let decodedBytes=0;
for(const r of parsed.receipts){const b=Buffer.from(r.bodyBase64,'base64');if(digest(b)!==r.bodySha256)throw new Error('ORIGINAL_RECEIPT_HASH_MISMATCH');decodedBytes+=b.length;}
const archive=packResearch([{name:'two-year-original-receipts.json',bytes:original}]);const restored=restoreResearch(archive)[0].bytes;if(!restored.equals(original))throw new Error('RESTORE_BYTE_MISMATCH');
const evidence={schemaVersion:'engine11.authentic-archive-restore-evidence.v1',observedAt:new Date().toISOString(),sourceRun:38333722706,sourceArtifact:11783458871,originalFileBytes:original.length,originalDecodedBodyBytes:decodedBytes,receiptHashesVerified:parsed.receipts.length,rawFileSha256:digest(original),gzipBytes:archive.files[0].gzipBytes,gzipSha256:archive.files[0].gzipSha256,manifestSha256:archive.manifestSha256,exactRestore:true,sourceKind:'AUTHENTIC_TWO_YEAR_PROVIDER_RECEIPTS',environment:'LOCAL_SCRATCH_SANDBOX',durable:false,productionStorageTouched:false};
await writeFile(process.argv[3],JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
