import { mkdtemp,writeFile,readFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';import { join } from 'node:path';
import { packResearch,restoreResearch } from '../finalityResearchV1/archive.js';
import { digest } from '../finalityResearchV1/sourceCapture.js';
export async function verifyTwoSandboxCopies(entries){
 const archive=packResearch(entries),serialized=Buffer.from(JSON.stringify(archive)),version='source-evidence-'+archive.manifestSha256;
 const root=await mkdtemp(join(tmpdir(),'engine11-archive-sandbox-')),copies=[];
 for(const label of ['copy-a','copy-b']){const dir=join(root,label);await mkdir(dir);const path=join(dir,version+'.archive.json');await writeFile(path,serialized,{flag:'wx'});const retrieved=await readFile(path);if(digest(retrieved)!==digest(serialized))throw new Error('COPY_TRANSPORT_HASH');const restored=restoreResearch(JSON.parse(retrieved));if(restored.length!==entries.length||restored.some((x,i)=>x.name!==entries[i].name||!x.bytes.equals(Buffer.from(entries[i].bytes))))throw new Error('COPY_RESTORE_FAILURE');copies.push({label,path,archiveSha256:digest(retrieved),restoredRawHashes:restored.map(x=>({name:x.name,sha256:digest(x.bytes)})),exactRestore:true});}
 return {schemaVersion:'engine11.two-copy-sandbox-proof.v1',version,manifest:archive.manifest,copies,archiveFileBytes:serialized.length,backupIndependenceVerified:false,durable:false,privateDestinationApproved:false,storageTransferAuthorized:false,productionStorageTouched:false};
}
