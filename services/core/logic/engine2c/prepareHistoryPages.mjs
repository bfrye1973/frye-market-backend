// Engine2C research-only startup preparation. NEVER exposes archives as static assets.
// Reuses the 480 immutable page files already verified against Engine11 pageDataset.
// Source bundle must be supplied via a short-lived, private, server-side download URL.
// No Massive calls, adjusted-price calculations, Replay or trading changes.
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdtemp,mkdir,readFile,readdir,rename,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import path from 'node:path';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const EXPECTED_SHA='9fe8c22ba49e4c64e3f2432d8a8f67279b8073da950d570393275a56f60562c4';
export const VIEWS=Object.freeze({
  continuousRaw:{dataset:'research-dataset:5224f595326ff44d424a9a3ada59fcf548ac5efa4c1e25eb7f4e141331b290f5',basis:'price-basis:d4ff32a184e2236d5bcb6551637253517ec694f7cbdcb8d34afd2f017a35f569',counts:[141181,70596,11776,2794,490,97,16]},
  continuousAdjustedClose:{dataset:'research-dataset:9caaa3723b576f09bb4040a44c9da3f2a6e0fd5f0bc177f809802e4b80b9a0a4',basis:'price-basis:40baff5124d2cae5b6678813329ed7aab1f47a3ac947555390f8ac7cd212c655',counts:[141181,70596,11776,2794,490,97,16]},
  actualESZ2026:{dataset:'research-dataset:ec592b47b697dc860a47b61dd713d45602d293c8797e1b52fc924a7459d68ac0',basis:'price-basis:98e08538fb38efedcb944e54232df4af396383ed6014c0bc1ef874f228dde05e',counts:[7980,4066,688,167,32,6,2]}
});
const FRAMES=['5m','10m','1h','4h','1d','1w','1mo'];
function run(bin,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{stdio:['ignore','ignore','pipe']});
    let error='';
    child.stderr.on('data',b=>{error+=b.toString().slice(0,1200);});
    child.on('error',reject);child.on('close',n=>n===0?resolve():reject(new Error('PRIVATE_EXTRACT_FAILED: '+error)));
  });
}
async function githubArtifactURL({token,repository='bfrye1973/Frye-Dashboard',name='engine2c-historical-pages-private'}){
  if(!token)throw Error('ENGINE2C_GITHUB_TOKEN_REQUIRED');
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const list=await fetch('https://api.github.com/repos/'+repository+'/actions/artifacts?per_page=100',{headers,signal:AbortSignal.timeout(25000)});
  if(!list.ok)throw Error('ENGINE2C_GITHUB_ARTIFACT_LIST_'+list.status);
  const body=await list.json();
  const artifact=(body.artifacts||[]).filter(x=>x.name===name&&!x.expired).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
  if(!artifact)throw Error('ENGINE2C_GITHUB_ARTIFACT_UNAVAILABLE');
  const response=await fetch('https://api.github.com/repos/'+repository+'/actions/artifacts/'+artifact.id+'/zip',{
    headers,redirect:'manual',signal:AbortSignal.timeout(25000)
  });
  if(![301,302,303,307,308].includes(response.status))throw Error('ENGINE2C_GITHUB_ARTIFACT_DOWNLOAD_'+response.status);
  const address=response.headers.get('location');
  if(!address||new URL(address).protocol!=='https:')throw Error('ENGINE2C_GITHUB_REDIRECT_INVALID');
  return address;
}
async function download(url,dest){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:')throw Error('PRIVATE_ARCHIVE_HTTPS_REQUIRED');
  const r=await fetch(parsed,{redirect:'follow',signal:AbortSignal.timeout(150000)});
  if(!r.ok||!r.body)throw Error('PRIVATE_ARCHIVE_DOWNLOAD_'+r.status);
  const file=createWriteStream(dest,{flags:'wx',mode:0o600});
  try{
    const {pipeline}=await import('node:stream/promises');
    const {Readable}=await import('node:stream');
    await pipeline(Readable.fromWeb(r.body),file);
  }catch(e){file.destroy();throw e;}
}
export async function verifyPages(root){
  let count=0,pages=0;
  for(const [folder,pins] of Object.entries(VIEWS)){
    const dir=path.join(root,folder);
    const cat=JSON.parse(await readFile(path.join(dir,folder+'-catalog.json'),'utf8'));
    if(cat.view!==folder||cat.datasetVersion!==pins.dataset||cat.priceBasisVersion!==pins.basis||cat.researchOnly!==true||cat.structuralEligible!==false||cat.executionPriceAuthority!==false)throw Error('HISTORY_CATALOG_MISMATCH_'+folder);
    for(let i=0;i<FRAMES.length;i++){
      const frame=FRAMES[i],group=cat.frames?.[frame];
      if(group?.rows!==pins.counts[i]||!Array.isArray(group.pages))throw Error('HISTORY_FRAME_COUNT_'+folder+'_'+frame);
      let lastCursor=null,n=0;
      for(const entry of group.pages){
        if(!/^[a-zA-Z0-9_-]+\.json$/.test(entry.name)||entry.requestCursor!==lastCursor)throw Error('HISTORY_CURSOR_CHAIN_'+folder+'_'+frame);
        const buf=await readFile(path.join(dir,entry.name));
        if(buf.length>2000000||sha(buf)!==entry.sha256)throw Error('HISTORY_PAGE_HASH_'+folder+'_'+frame);
        const p=JSON.parse(buf);
        if(p.requestCursor!==entry.requestCursor||p.nextCursor!==entry.nextCursor||p.rows?.length!==entry.rows||p.datasetVersion!==pins.dataset||p.priceBasisVersion!==pins.basis||p.frame!==frame||p.researchOnly!==true||p.structuralEligible!==false||p.executionPriceAuthority!==false)throw Error('HISTORY_PAGE_CONTRACT_'+folder+'_'+frame);
        n+=p.rows.length;pages++;lastCursor=p.nextCursor;
      }
      if(n!==group.rows||lastCursor!==null)throw Error('HISTORY_PAGE_TERMINAL_'+folder+'_'+frame);
      count+=n;
    }
  }
  if(count!==466841||pages!==480)throw Error('HISTORY_ARCHIVE_TOTAL_MISMATCH_'+count+'_'+pages);
  return {count,pages};
}
export async function prepareHistory({url,root,githubToken,githubRepo,artifactName}){
  if(!path.isAbsolute(root))throw Error('HISTORY_PRIVATE_ROOT_NOT_CONFIGURED');
  // Refuse accidental use of Replay or public web directories.
  if(root.startsWith('/var/data/replay')||root.includes('/public/')||root.includes('/build/'))throw Error('INVALID_HISTORY_STORAGE_LOCATION');
  const existing=path.join(root,'pages');
  try{
    const good=await verifyPages(existing);
    return {...good,root:existing,reused:true};
  }catch{}
  await mkdir(root,{recursive:true,mode:0o700});
  const temporary=await mkdtemp(path.join(root,'.staging-'));
  try{
    const zip=path.join(temporary,'pages.zip');
    const sourceURL=githubToken?await githubArtifactURL({token:githubToken,repository:githubRepo, name:artifactName}):url;
    if(!sourceURL)throw Error('HISTORY_PRIVATE_SOURCE_NOT_CONFIGURED');
    await download(sourceURL,zip);
    // Page SHA-256 hashes, dataset/basis identity and every total are checked
    // below. GitHub-generated ZIP envelope hashes can change between uploads.
    await run('unzip',['-q',zip,'-d',temporary]);
    const wrapped=path.join(temporary,'pages');
    const source=(await stat(path.join(wrapped,'continuousRaw')).then(x=>x.isDirectory()).catch(()=>false))?wrapped:temporary;
    const verified=await verifyPages(source);
    try{await rm(existing,{recursive:true,force:true});}catch{}
    if(source===temporary){
      await mkdir(existing,{recursive:true,mode:0o700});
      for(const folder of Object.keys(VIEWS))await rename(path.join(temporary,folder),path.join(existing,folder));
    }else await rename(source,existing);
    return {...verified,root:existing,reused:false};
  }finally{await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  prepareHistory({url:process.env.ENGINE2C_HISTORY_BUNDLE_URL,githubToken:process.env.ENGINE2C_GITHUB_TOKEN,githubRepo:'bfrye1973/Frye-Dashboard',artifactName:process.env.ENGINE2C_HISTORY_ARTIFACT_NAME||'engine2c-historical-pages-private',root:process.env.ENGINE2C_PRIVATE_ROOT||'/opt/render/project/src/.engine2c-private'})
    .then(v=>console.log('ENGINE2C_PRIVATE_HISTORY_READY',JSON.stringify({count:v.count,pages:v.pages})))
    .catch(e=>{console.error('ENGINE2C_HISTORY_PREP_FAILED',e.message);process.exitCode=1;});
}
