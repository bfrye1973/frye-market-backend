import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createResearchHistoricalHandler,RESEARCH_VIEWS} from '../../logic/engine2c/researchHistoricalServingV2.js';
const [v,v2020]=RESEARCH_VIEWS.UNADJUSTED;
const query={view:'UNADJUSTED',frame:'10m',direction:'DESC',limit:'1000',datasetVersion:v.dataset,priceBasisVersion:v.basis};
const verifier=async()=>({authenticated:true,subject:'test-owner'});
const permitted=async()=>true;
const sha=b=>createHash('sha256').update(b).digest('hex');
test('disabled by default even with supplied query and data path',async()=>{
 const h=createResearchHistoricalHandler({verifySession:verifier,authorizeViewer:permitted});
 const r=await h({query});assert.equal(r.status,404);assert.match(r.headers['Cache-Control'],/no-store/);
});
test('authentication and viewer entitlement each fail closed',async()=>{
 const base={enabled:true,licensedAudience:true,privateRoot:'/tmp',verifySession:verifier,authorizeViewer:permitted};
 assert.equal((await createResearchHistoricalHandler({...base,verifySession:undefined})({query})).status,404);
 assert.equal((await createResearchHistoricalHandler({...base,verifySession:async()=>null})({query})).status,401);
 assert.equal((await createResearchHistoricalHandler({...base,authorizeViewer:async()=>false})({query})).status,403);
 assert.equal((await createResearchHistoricalHandler({...base,authorizeViewer:async()=>{throw Error('deny')}})({query})).status,403);
 assert.equal((await createResearchHistoricalHandler({...base})({method:'POST',query})).status,405);
});
test('serves one pinned page from private folder and rejects modified data',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'e2c-secure-test-'));
 try{
  const dir=path.join(root,'continuousRaw');await mkdir(dir);
  const page={datasetVersion:v.dataset,priceBasisVersion:v.basis,frame:'10m',direction:'DESC',requestCursor:null,researchOnly:true,structuralEligible:false,executionPriceAuthority:false,rows:[{researchCandleId:'example-private-test',frame:'10m',priceBasisVersion:v.basis,structuralEligible:false,executionPriceAuthority:false,timestampUtc:'2026-10-15T12:00:00Z',prices:{open:5000,high:5001,low:4999,close:5000}}],nextCursor:null};
  const bytes=JSON.stringify(page),name='continuousRaw-10m-0000.json';
  await writeFile(path.join(dir,name),bytes);
  const catalog={datasetVersion:v.dataset,priceBasisVersion:v.basis,researchOnly:true,structuralEligible:false,executionPriceAuthority:false,frames:{'10m':{pages:[{name,requestCursor:null,nextCursor:null,rows:1,sha256:sha(bytes)}]}}};
  await writeFile(path.join(dir,'continuousRaw-catalog.json'),JSON.stringify(catalog));
  const h=createResearchHistoricalHandler({enabled:true,licensedAudience:true,verifySession:verifier,authorizeViewer:permitted,privateRoot:root});
  const good=await h({query});assert.equal(good.status,200);assert.equal(JSON.parse(good.body).rows.length,1);
  assert.equal((await h({query:{...query,limit:'5000'}})).status,400);
  assert.equal((await h({query:{...query,priceBasisVersion:'wrong'}})).status,400);
  assert.equal((await h({query:{...query,cursor:'invalid'}})).status,404);
  await writeFile(path.join(dir,name),bytes+' ');assert.equal((await h({query})).status,503);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('accepts the 2020plus immutable version without removing legacy rollback version',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'e2c-2020plus-test-'));
 try{
  const dir=path.join(root,v2020.folder);await mkdir(dir);
  const row={researchCandleId:'engine11-2020plus-test',frame:'1d',priceBasisVersion:v2020.basis,structuralEligible:false,executionPriceAuthority:false,timestampUtc:'2020-03-03T00:00:00.000Z',prices:{open:2998.75,high:3129.5,low:2976.5,close:3110.75}};
  const page={datasetVersion:v2020.dataset,priceBasisVersion:v2020.basis,frame:'1d',direction:'DESC',requestCursor:null,nextCursor:null,researchOnly:true,structuralEligible:false,executionPriceAuthority:false,rows:[row]};
  const bytes=JSON.stringify(page),name=v2020.folder+'-1d-0000.json';await writeFile(path.join(dir,name),bytes);
  const catalog={datasetVersion:v2020.dataset,priceBasisVersion:v2020.basis,researchOnly:true,structuralEligible:false,executionPriceAuthority:false,frames:{'1d':{pages:[{name,requestCursor:null,nextCursor:null,rows:1,sha256:sha(bytes)}]}}};
  await writeFile(path.join(dir,v2020.folder+'-catalog.json'),JSON.stringify(catalog));
  const h=createResearchHistoricalHandler({enabled:true,licensedAudience:true,verifySession:verifier,authorizeViewer:permitted,privateRoot:root});
  const q={view:'UNADJUSTED',frame:'1d',direction:'DESC',limit:'1000',datasetVersion:v2020.dataset,priceBasisVersion:v2020.basis};
  const r=await h({query:q});assert.equal(r.status,200);assert.equal(JSON.parse(r.body).rows[0].prices.close,3110.75);
  assert.equal((await h({query:{...q,datasetVersion:v.dataset}})).status,400);
 }finally{await rm(root,{recursive:true,force:true});}
});
