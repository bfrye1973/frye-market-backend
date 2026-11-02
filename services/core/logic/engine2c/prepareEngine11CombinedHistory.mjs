// Engine 2E — isolated preparation of Engine11 verified 2020+ combined archive
// into private paginated serving files. Never removes the legacy archive.
import {createWriteStream} from "node:fs";
import {mkdtemp,mkdir,rename,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {spawn} from "node:child_process";
import path from "node:path";
import {buildEngine11CombinedPrivatePages} from "./buildEngine11CombinedPrivatePages.mjs";

const ARTIFACT="engine11-2020plus-continuous-unadjusted-research-only";
const REPO="bfrye1973/frye-market-backend";
async function artifactURL(token){
 if(!token)throw Error("ENGINE11_GITHUB_TOKEN_REQUIRED");
 const h={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
 const r=await fetch(`https://api.github.com/repos/${REPO}/actions/artifacts?per_page=100`,{headers:h,signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error("ENGINE11_ARTIFACT_LIST_"+r.status);
 const a=(await r.json()).artifacts?.filter(x=>x.name===ARTIFACT&&!x.expired).sort((x,y)=>Date.parse(y.created_at)-Date.parse(x.created_at))[0];
 if(!a)throw Error("ENGINE11_COMBINED_ARTIFACT_UNAVAILABLE");
 const d=await fetch(`https://api.github.com/repos/${REPO}/actions/artifacts/${a.id}/zip`,{headers:h,redirect:"manual",signal:AbortSignal.timeout(25000)});
 if(![301,302,303,307,308].includes(d.status))throw Error("ENGINE11_ARTIFACT_DOWNLOAD_"+d.status);
 const u=d.headers.get("location"); if(!u||new URL(u).protocol!=="https:")throw Error("ENGINE11_ARTIFACT_REDIRECT_INVALID");
 return {url:u,id:a.id,digest:a.digest??null};
}
async function download(url,dest){
 const r=await fetch(url,{redirect:"follow",signal:AbortSignal.timeout(180000)});if(!r.ok||!r.body)throw Error("ENGINE11_DOWNLOAD_"+r.status);
 const f=createWriteStream(dest,{flags:"wx",mode:0o600});
 const {pipeline}=await import("node:stream/promises");const {Readable}=await import("node:stream");
 await pipeline(Readable.fromWeb(r.body),f);
}
function run(bin,args){return new Promise((res,rej)=>{const p=spawn(bin,args,{stdio:["ignore","ignore","pipe"]});let e="";p.stderr.on("data",b=>e+=b.toString().slice(0,1500));p.on("error",rej);p.on("close",n=>n===0?res():rej(Error("ENGINE11_EXTRACT_FAILED "+e)));});}

export async function prepareEngine11CombinedHistory({root,githubToken}={}){
 if(!path.isAbsolute(root))throw Error("ENGINE11_PRIVATE_ROOT_NOT_CONFIGURED");
 const pagesRoot=path.join(root,"pages"),target=path.join(pagesRoot,"continuousRaw2020plus");
 try{if((await stat(path.join(target,"continuousRaw2020plus-catalog.json"))).isFile())return {root:pagesRoot,reused:true};}catch{}
 await mkdir(pagesRoot,{recursive:true,mode:0o700});
 const temp=await mkdtemp(path.join(tmpdir(),"engine11-2020plus-"));
 try{
  const a=await artifactURL(githubToken),zip=path.join(temp,"combined.zip"),combined=path.join(temp,"combined"),built=path.join(temp,"built");
  await download(a.url,zip);await mkdir(combined);await run("unzip",["-q",zip,"-d",combined]);
  const result=await buildEngine11CombinedPrivatePages({combinedRoot:combined,outRoot:built});
  if(result.datasetVersion!=="research-dataset:2e555ba83cbf25466d3e8d157371cc423401f30a25ed35b33a95fca5f81aaae2"||
     result.priceBasisVersion!=="price-basis:04ec3639248269336f8df3626c6c9a3eb119ac18cbc39429addbbb2f24d22b15"||
     result.totalRows!==757479)throw Error("ENGINE11_PREP_IDENTITY_MISMATCH");
  await rename(path.join(built,"continuousRaw2020plus"),target);
  return {...result,root:pagesRoot,reused:false,artifactId:a.id,artifactDigest:a.digest};
 }finally{await rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 prepareEngine11CombinedHistory({root:process.env.ENGINE2C_PRIVATE_ROOT||"/opt/render/project/src/.engine2c-private",githubToken:process.env.ENGINE2C_GITHUB_TOKEN||process.env.LIVE_GITHUB_TOKEN||process.env.GITHUB_TOKEN||process.env.GH_TOKEN})
 .then(v=>console.log("ENGINE11_2020PLUS_PRIVATE_HISTORY_READY",JSON.stringify(v)))
 .catch(e=>{console.error("ENGINE11_2020PLUS_PRIVATE_HISTORY_FAILED",e.message);process.exitCode=1;});
}
