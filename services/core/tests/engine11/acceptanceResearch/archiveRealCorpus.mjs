import { readFile,writeFile } from 'node:fs/promises';
import { verifyTwoSandboxCopies } from '../../../logic/engine11/acceptanceResearchV1/sandboxCopies.js';
import { hash } from '../../../logic/engine11/acceptanceResearchV1/eligibility.js';
const bytes=await readFile(process.argv[2]),corpus=JSON.parse(bytes);for(const r of corpus.receipts)if(hash(Buffer.from(r.bodyBase64,'base64'))!==r.bodySha256)throw new Error('AUTHENTIC_BODY_HASH');
const proof=await verifyTwoSandboxCopies([{name:'two-year-original-receipts.json',bytes}]);
const report={...proof,rawFileBytes:bytes.length,originalDecodedBodyBytes:corpus.receipts.reduce((n,r)=>n+Buffer.from(r.bodyBase64,'base64').length,0),originalReceiptHashesVerified:corpus.receipts.length,sourceRun:38333722706,sourceArtifact:11783458871,sourceRawFileSha256:hash(bytes),observedAt:new Date().toISOString()};
await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({rawBytes:bytes.length,archiveFileBytes:proof.archiveFileBytes,copies:proof.copies.map(x=>({label:x.label,exactRestore:x.exactRestore})),backupIndependenceVerified:proof.backupIndependenceVerified,durable:proof.durable}));
