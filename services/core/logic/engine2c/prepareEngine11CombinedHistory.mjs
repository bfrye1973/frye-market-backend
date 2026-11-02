// Engine 2E — prepare verified Engine11 2020+ ready-to-serve private pages.
// Render downloads, verifies and activates the prebuilt GitHub Actions artifact.
// It never rebuilds candles or mutates the legacy archive.
import {createHash} from "node:crypto";
import {createWriteStream} from "node:fs";
import {mkdtemp,mkdir,readFile,readdir,rename,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {spawn} from "node:child_process";
import path from "node:path";

const ARTIFACT="engine11-2020plus-private-history-pages-v1";
const REPO="bfrye1973/frye-market-backend";
const DATASET="research-dataset:2e555ba83cbf25466d3e8d157371cc423401f30a25ed35b33a95fca5f81aaae2";
const BASIS="price-basis:04ec3639248269336f8df3626c6c9a3eb119ac18cbc39429addbbb2f24d22b15";
const EXPECTED_ROWS=757479;
const EXPECTED_PAGES=762;
const FRAMES=["5m","10m","1h","4h","1d","1w","1mo"];
const sha=x=>createHash("sha256").update(x).digest("hex");

async function artifactURL(token){
 if(!token)throw Error("ENGINE11_GITHUB_TOKEN_REQUIRED");
 const h={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
 const r=await fetch(`https://api.github.com/repos/${REPO}/actions/artifacts?per_page=100`,{headers:h,signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error("ENGINE11_PAGE_ARTIFACT_LIST_"+r.status);
 const a=(await r.json()).artifacts?.filter(x=>x.name===ARTIFACT&&!x.expired).sort((x,y)=>Date.parse(y.created_at)-Date.parse(x.created_at))[0];
 if(!a)throw Error("ENGINE11_PAGE_ARTIFACT_UNAVAILABLE");
 const d=await fetch(`https://api.github.com/repos/${REPO}/actions/artifacts/${a.id}/zip`,{headers:h,redirect:"manual",signal:AbortSignal.timeout(25000)});
 if(![301,302,303,307,308].includes(d.status))throw Error("ENGINE11_PAGE_ARTIFACT_DOWNLOAD_"+d.status);
 const u=d.headers.get("location");
 if(!u||new URL(u).protocol!=="https:")throw Error("ENGINE11_PAGE_ARTIFACT_REDIRECT_INVALID");
 return {url:u,id:a.id,digest:a.digest??null};
}

async function download(url,dest){
 const r=await fetch(url,{redirect:"follow",signal:AbortSignal.timeout(180000)});
 if(!r.ok||!r.body)throw Error("ENGINE11_PAGE_DOWNLOAD_"+r.status);
 const f=createWriteStream(dest,{flags:"wx",mode:0o600});
 const {pipeline}=await import("node:stream/promises");
 const {Readable}=await import("node:stream");
 await pipeline(Readable.fromWeb(r.body),f);
}

function run(bin,args){
 return new Promise((resolve,reject)=>{
  const p=spawn(bin,args,{stdio:["ignore","ignore","pipe"]});let e="";
  p.stderr.on("data",b=>e+=b.toString().slice(0,2000));
  p.on("error",reject);
  p.on("close",n=>n===0?resolve():reject(Error("ENGINE11_PAGE_EXTRACT_FAILED "+e)));
 });
}

export async function verifyEngine11PreparedPages(dir){
 const summary=JSON.parse(await readFile(path.join(dir,"private-pages-verification.json"),"utf8"));
 const catalogBytes=await readFile(path.join(dir,"continuousRaw2020plus-catalog.json"));
 const catalog=JSON.parse(catalogBytes);
 if(summary.schema!=="engine11.private-history-pages.verification.v1"||
    summary.sourceArtifactId!==13158459519||
    summary.datasetVersion!==DATASET||summary.priceBasisVersion!==BASIS||
    summary.totalRows!==EXPECTED_ROWS||summary.pageCount!==EXPECTED_PAGES||
    summary.catalogSha256!==sha(catalogBytes)||
    summary.researchOnly!==true||summary.structuralEligible!==false||summary.executionPriceAuthority!==false)
   throw Error("ENGINE11_PAGE_SUMMARY_INVALID");
 if(catalog.datasetVersion!==DATASET||catalog.priceBasisVersion!==BASIS||
    catalog.researchOnly!==true||catalog.structuralEligible!==false||catalog.executionPriceAuthority!==false)
   throw Error("ENGINE11_PAGE_CATALOG_INVALID");

 let rows=0,pages=0;
 for(const frame of FRAMES){
   const group=catalog.frames?.[frame];
   if(!group||!Array.isArray(group.pages))throw Error("ENGINE11_FRAME_CATALOG_"+frame);
   let cursor=null,sum=0;
   for(const entry of group.pages){
     if(entry.requestCursor!==cursor)throw Error("ENGINE11_CURSOR_CHAIN_"+frame);
     const full=path.join(dir,entry.name);
     const bytes=await readFile(full);
     if(sha(bytes)!==entry.sha256)throw Error("ENGINE11_PAGE_HASH_"+frame);
     const p=JSON.parse(bytes);
     if(p.datasetVersion!==DATASET||p.priceBasisVersion!==BASIS||p.frame!==frame||
        p.direction!=="DESC"||p.requestCursor!==entry.requestCursor||
        p.nextCursor!==entry.nextCursor||p.researchOnly!==true||
        p.structuralEligible!==false||p.executionPriceAuthority!==false||
        !Array.isArray(p.rows)||p.rows.length!==entry.rows||p.rows.length>1000)
       throw Error("ENGINE11_PAGE_CONTRACT_"+frame);
     for(const r of p.rows){
       if(r.frame!==frame||r.priceBasisVersion!==BASIS||
          r.structuralEligible!==false||r.executionPriceAuthority!==false||
          typeof r.researchCandleId!=="string"||!Number.isFinite(Date.parse(r.timestampUtc))||
          !r.prices||!["open","high","low","close"].every(k=>Number.isFinite(r.prices[k])))
         throw Error("ENGINE11_ROW_CONTRACT_"+frame);
     }
     sum+=p.rows.length;pages++;cursor=p.nextCursor;
   }
   if(sum!==group.rows||cursor!==null)throw Error("ENGINE11_FRAME_TERMINAL_"+frame);
   rows+=sum;
 }
 if(rows!==EXPECTED_ROWS||pages!==EXPECTED_PAGES)throw Error("ENGINE11_PAGE_TOTALS_"+rows+"_"+pages);
 return {datasetVersion:DATASET,priceBasisVersion:BASIS,totalRows:rows,pages,summary,catalog};
}

export async function prepareEngine11CombinedHistory({root,githubToken}={}){
 if(!path.isAbsolute(root))throw Error("ENGINE11_PRIVATE_ROOT_NOT_CONFIGURED");
 const pagesRoot=path.join(root,"pages");
 const target=path.join(pagesRoot,"continuousRaw2020plus");
 try{
   const good=await verifyEngine11PreparedPages(target);
   return {...good,root:pagesRoot,reused:true};
 }catch{}

 await mkdir(pagesRoot,{recursive:true,mode:0o700});
 const staging=await mkdtemp(path.join(pagesRoot,".engine11-2020plus-staging-"));
 try{
   const a=await artifactURL(githubToken);
   const zip=path.join(staging,"pages.zip");
   const extracted=path.join(staging,"extracted");
   await download(a.url,zip);
   await mkdir(extracted);
   await run("unzip",["-q",zip,"-d",extracted]);

   const direct=path.join(extracted,"continuousRaw2020plus-catalog.json");
   const nested=path.join(extracted,"continuousRaw2020plus","continuousRaw2020plus-catalog.json");
   let source;
   if(await stat(direct).then(x=>x.isFile()).catch(()=>false))source=extracted;
   else if(await stat(nested).then(x=>x.isFile()).catch(()=>false))source=path.join(extracted,"continuousRaw2020plus");
   else throw Error("ENGINE11_PAGE_ARTIFACT_LAYOUT_INVALID");

   const verified=await verifyEngine11PreparedPages(source);
   const replacement=path.join(pagesRoot,".continuousRaw2020plus-ready");
   await rm(replacement,{recursive:true,force:true});
   await rename(source,replacement);
   await rm(target,{recursive:true,force:true});
   await rename(replacement,target);
   return {...verified,root:pagesRoot,reused:false,artifactId:a.id,artifactDigest:a.digest};
 }finally{
   await rm(staging,{recursive:true,force:true});
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 prepareEngine11CombinedHistory({
   root:process.env.ENGINE2C_PRIVATE_ROOT||"/opt/render/project/src/.engine2c-private",
   githubToken:process.env.ENGINE2C_GITHUB_TOKEN||process.env.LIVE_GITHUB_TOKEN||process.env.GITHUB_TOKEN||process.env.GH_TOKEN
 }).then(v=>console.log("ENGINE11_2020PLUS_PRIVATE_HISTORY_READY",JSON.stringify({
   datasetVersion:v.datasetVersion,priceBasisVersion:v.priceBasisVersion,totalRows:v.totalRows,pages:v.pages,
   artifactId:v.artifactId??null,reused:v.reused===true
 }))).catch(e=>{console.error("ENGINE11_2020PLUS_PRIVATE_HISTORY_FAILED",e.message);process.exitCode=1;});
}
