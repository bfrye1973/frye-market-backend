// Isolated Engine11 evidence: select ONLY exact October-30 Engine2C private pages.
// Do not select latest artifact by name, no Massive requests, no mutations.
import {execFileSync} from 'node:child_process';
import {writeFileSync,appendFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const repo=process.env.ENGINE11_PRIVATE_HISTORY_REPO||'bfrye1973/Frye-Dashboard';
const name='engine2c-historical-pages-private';
const expected={
 dataset:'research-dataset:a0c81ce398869440b1b9cd42b94ced0101923356c4c860a9c13232a1f98f3c91',
 basis:'price-basis:fcbfa10815555415c8afdfddbbc28a96a4f42207db162a0db853b549546b3908',
 counts:[144999,72505,12094,2868,503,99,16],
};
const frames=['5m','10m','1h','4h','1d','1w','1mo'];
const artifacts=[];
for(let page=1;page<=3;page++){
 const response=JSON.parse(execFileSync('gh',['api','repos/'+repo+'/actions/artifacts?per_page=100&page='+page],{encoding:'utf8',maxBuffer:8e6}));
 artifacts.push(...(response.artifacts||[]).filter(x=>x.name===name&&!x.expired));
 if((response.artifacts||[]).length<100)break;
}
artifacts.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
const tmp=mkdtempSync(path.join(tmpdir(),'engine11-pin-'));
const diagnostics=[];
let selected=null;
try{
 for(const a of artifacts){
  const zip=path.join(tmp,String(a.id)+'.zip');
  try{
   const bytes=execFileSync('gh',['api','repos/'+repo+'/actions/artifacts/'+a.id+'/zip'],{maxBuffer:180e6,timeout:180000});
   writeFileSync(zip,bytes);
   let catalog=null;
   for(const loc of ['continuousRaw/continuousRaw-catalog.json','pages/continuousRaw/continuousRaw-catalog.json']){
    try{catalog=JSON.parse(execFileSync('unzip',['-p',zip,loc],{encoding:'utf8',maxBuffer:2e6,stdio:['ignore','pipe','ignore']}));break;}catch{}
   }
   if(!catalog){diagnostics.push({artifact:a.id,status:'CATALOG_MISSING'});continue;}
   const counts=frames.map(f=>catalog.frames?.[f]?.rows??null);
   const matched=catalog.view==='continuousRaw'&&catalog.datasetVersion===expected.dataset&&catalog.priceBasisVersion===expected.basis&&counts.every((n,i)=>n===expected.counts[i])&&catalog.researchOnly===true&&catalog.structuralEligible===false&&catalog.executionPriceAuthority===false;
   diagnostics.push({artifact:a.id,status:matched?'EXACT_PIN_MATCH':'MISMATCH',datasetVersion:catalog.datasetVersion,priceBasisVersion:catalog.priceBasisVersion,counts});
   if(matched){selected=a.id;break;}
  }catch(e){diagnostics.push({artifact:a.id,status:'DOWNLOAD_OR_PARSE_ERROR',reason:String(e.message).slice(0,170)});}
 }
 console.log('ENGINE11_PRIVATE_HISTORY_PIN_SELECTION',JSON.stringify({selectedArtifact:selected,inspected:diagnostics,expected}));
 if(!selected)throw Error('EXACT_OCT30_PRIVATE_HISTORY_ARCHIVE_NOT_FOUND_DO_NOT_USE_OLDER_ARTIFACT');
 if(!process.env.GITHUB_ENV)throw Error('GITHUB_ENV_REQUIRED');
 appendFileSync(process.env.GITHUB_ENV,'ENGINE11_EXISTING_ARTIFACT='+selected+'\n');
}finally{rmSync(tmp,{recursive:true,force:true});}
