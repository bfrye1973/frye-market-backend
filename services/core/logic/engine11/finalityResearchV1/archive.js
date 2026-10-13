import { gzipSync,gunzipSync } from 'node:zlib';
import { digest } from './sourceCapture.js';
export function packResearch(entries,{maxBytes=128*1024*1024}={}){
 if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>256*1024*1024)throw new Error('ARCHIVE_BYTE_BUDGET');
 if(!Array.isArray(entries)||!entries.length||entries.length>1000)throw new Error('ARCHIVE_ENTRIES');
 let total=0;const seen=new Set();const files=entries.map(({name,bytes})=>{if(typeof name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)||name.includes('..')||seen.has(name))throw new Error('ARCHIVE_NAME');seen.add(name);const raw=Buffer.from(bytes);total+=raw.length;if(total>maxBytes)throw new Error('ARCHIVE_BYTE_BUDGET');const zip=gzipSync(raw);return {name,rawBytes:raw.length,rawSha256:digest(raw),gzipBytes:zip.length,gzipSha256:digest(zip),gzipBase64:zip.toString('base64')};});
 const manifest={schemaVersion:'engine11.research-archive.v1',files:files.map(({gzipBase64,...x})=>x),totalRawBytes:total,purpose:'LOCAL_OR_CI_SANDBOX_ONLY',durable:false,structuralEligible:false};
 return {manifest,manifestSha256:digest(JSON.stringify(manifest)),files};
}
export function restoreResearch(archive,{maxBytes=128*1024*1024}={}){
 if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>256*1024*1024)throw new Error('RESTORE_BYTE_BUDGET');
 if(!archive?.manifest||archive.manifest.schemaVersion!=='engine11.research-archive.v1'||digest(JSON.stringify(archive.manifest))!==archive.manifestSha256||archive.manifest.files.length!==archive.files.length)throw new Error('ARCHIVE_MANIFEST');
 let total=0;const names=new Set();const restored=[];
 for(let i=0;i<archive.files.length;i++){const file=archive.files[i],meta=archive.manifest.files[i];if(typeof file.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file.name)||file.name.includes('..')||names.has(file.name)||JSON.stringify(Object.fromEntries(Object.entries(file).filter(([k])=>k!=='gzipBase64')))!==JSON.stringify(meta))throw new Error('ARCHIVE_NAME_OR_METADATA');names.add(file.name);
  if(!Number.isInteger(file.rawBytes)||file.rawBytes<0||file.rawBytes>maxBytes-total)throw new Error('RESTORE_BYTE_BUDGET');const zipped=Buffer.from(file.gzipBase64,'base64');if(zipped.length!==file.gzipBytes||digest(zipped)!==file.gzipSha256)throw new Error('ARCHIVE_COMPRESSED_DIGEST');const raw=gunzipSync(zipped,{maxOutputLength:Math.max(1,file.rawBytes)});if(raw.length!==file.rawBytes||digest(raw)!==file.rawSha256)throw new Error('ARCHIVE_RAW_DIGEST');total+=raw.length;restored.push({name:file.name,bytes:raw});}
 if(total!==archive.manifest.totalRawBytes)throw new Error('ARCHIVE_TOTAL');return restored;
}
