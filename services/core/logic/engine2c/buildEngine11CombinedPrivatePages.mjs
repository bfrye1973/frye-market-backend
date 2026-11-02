// Engine 2E / Engine 11 — deterministic private-page builder for the verified
// 2020+ Continuous ES Unadjusted research package. Source .json.gz files are
// read-only. This adds serving metadata only; it never changes source OHLCV.
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createGunzip} from "node:zlib";
import {pipeline} from "node:stream/promises";
import {Writable} from "node:stream";
import path from "node:path";

const FRAMES=["5m","10m","1h","4h","1d","1w","1mo"];
const sha=x=>createHash("sha256").update(x).digest("hex");
const cursor=(frame,index)=>index===0?null:Buffer.from(`${frame}:${index}`).toString("base64url");

async function readGzipJson(file){
 let chunks=[];
 await pipeline(createReadStream(file),createGunzip(),new Writable({write(c,e,cb){chunks.push(c);cb();}}));
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function buildEngine11CombinedPrivatePages({combinedRoot,outRoot}={}){
 if(!path.isAbsolute(combinedRoot)||!path.isAbsolute(outRoot))throw Error("ABSOLUTE_PATH_REQUIRED");
 const manifest=JSON.parse(await readFile(path.join(combinedRoot,"manifest.json"),"utf8"));
 const verification=JSON.parse(await readFile(path.join(combinedRoot,"combined-verification.json"),"utf8"));
 if(manifest.status!=="PASS_ISOLATED_RESEARCH_PACKAGE_ONLY_NOT_SERVING_AUTHORIZED"||
    verification.status!=="PASS_SEVEN_FRAMES_RESEARCH_ONLY_NOT_PRODUCTION_APPROVED"||
    verification.problems?.length)throw Error("COMBINED_PACKAGE_NOT_VERIFIED");
 const dataset=manifest.version,basis=manifest.priceBasisVersion;
 if(dataset!==verification.datasetVersion||basis!==verification.priceBasisVersion)throw Error("COMBINED_IDENTITY_MISMATCH");
 const folder="continuousRaw2020plus",dir=path.join(outRoot,folder);
 await mkdir(dir,{recursive:true});
 const catalog={schema:"engine2c.private-history-catalog.v2",view:"UNADJUSTED",folder,datasetVersion:dataset,priceBasisVersion:basis,researchOnly:true,structuralEligible:false,executionPriceAuthority:false,sourceManifestSha256:sha(await readFile(path.join(combinedRoot,"manifest.json"))),frames:{}};
 let total=0,pageTotal=0;
 for(const frame of FRAMES){
   const meta=manifest.frames?.[frame]; if(!meta)throw Error("FRAME_MANIFEST_MISSING_"+frame);
   const bytes=await readFile(path.join(combinedRoot,meta.file));
   if(sha(bytes)!==meta.sha256)throw Error("FRAME_SOURCE_HASH_"+frame);
   const src=await readGzipJson(path.join(combinedRoot,meta.file));
   if(src?.frame!==frame||!Array.isArray(src?.rows)||src.rows.length!==meta.combinedRows)throw Error("FRAME_SOURCE_CONTRACT_"+frame);
   const asc=[...src.rows];
   for(let i=1;i<asc.length;i++)if(Date.parse(asc[i].timestampUtc)<=Date.parse(asc[i-1].timestampUtc))throw Error("FRAME_SOURCE_ORDER_"+frame);
   const desc=asc.reverse(),pages=[];
   for(let offset=0,pageIndex=0;offset<desc.length;offset+=1000,pageIndex++){
     const requestCursor=cursor(frame,pageIndex),nextCursor=offset+1000<desc.length?cursor(frame,pageIndex+1):null;
     const rows=desc.slice(offset,offset+1000).map(r=>({...r,priceBasisVersion:basis,structuralEligible:false,executionPriceAuthority:false}));
     const page={schema:"engine2c.private-history-page.v2",datasetVersion:dataset,priceBasisVersion:basis,frame,direction:"DESC",requestCursor,nextCursor,researchOnly:true,structuralEligible:false,executionPriceAuthority:false,rows};
     const body=JSON.stringify(page),name=`${folder}-${frame}-${String(pageIndex).padStart(4,"0")}.json`;
     await writeFile(path.join(dir,name),body,{mode:0o600});
     pages.push({name,requestCursor,nextCursor,rows:rows.length,sha256:sha(body)});
     pageTotal++;
   }
   catalog.frames[frame]={rows:desc.length,firstUtc:meta.firstUtc,lastUtc:meta.lastUtc,sourceSha256:meta.sha256,pages};
   total+=desc.length;
 }
 if(total!==manifest.totalRows)throw Error("TOTAL_ROW_MISMATCH_"+total);
 await writeFile(path.join(dir,folder+"-catalog.json"),JSON.stringify(catalog,null,2),{mode:0o600});
 return {datasetVersion:dataset,priceBasisVersion:basis,totalRows:total,pages:pageTotal,folder,catalog};
}

if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 buildEngine11CombinedPrivatePages({combinedRoot:path.resolve(process.argv[2]||"."),outRoot:path.resolve(process.argv[3]||"./engine11-private-pages")})
  .then(x=>console.log("ENGINE11_2020PLUS_PRIVATE_PAGES_READY",JSON.stringify({datasetVersion:x.datasetVersion,priceBasisVersion:x.priceBasisVersion,totalRows:x.totalRows,pages:x.pages,folder:x.folder})))
  .catch(e=>{console.error("ENGINE11_2020PLUS_PRIVATE_PAGES_FAILED",e.message);process.exitCode=1;});
}
