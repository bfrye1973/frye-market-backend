import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {gzipSync} from 'node:zlib';
import {capture,digest} from '../../../logic/engine11/finalityResearchV1/sourceCapture.js';
import {buildPlan,nano} from '../../../logic/engine11/nodeReconciliationResearchV1/plan.js';
import {captureEngine22Publications} from '../../../logic/engine11/finalCompatibilityResearchV1/comparePublications.js';
const sourceRoot=path.resolve(process.argv[2]??'registry-source'),out=process.argv[3]??'research-evidence';
const importer=await import(pathToFileURL(path.join(sourceRoot,'services/core/scripts/auditEngine22NodeRegistryV1.mjs')).href);
const bytes=importer.readOriginalOwnerWorkbookBytes(),archive=importer.readWorkbookCellArchive(),intake=importer.importAllSourceCells(archive),plan=buildPlan(intake.allNodes);
const apiKey=process.env.POLYGON_API_KEY;if(!apiKey)throw Error('EXISTING_PROVIDER_ENTITLEMENT_UNAVAILABLE');
const samples=new Array(plan.queries.length);let index=0;
const requestFor=q=>'https://api.massive.com/futures/v1/'+(q.purpose==='CONTRACT_METADATA'?'contracts?'+new URLSearchParams({ticker:q.contract.ticker,product_code:'ES',date:q.date,limit:'100'}):'aggs/'+q.contract.ticker+'?'+new URLSearchParams({resolution:q.resolution,'window_start.gte':nano(q.from),'window_start.lt':nano(q.to),sort:'window_start.asc',limit:'1000'}));
async function worker(){while(index<plan.queries.length){const i=index++,q=plan.queries[i];samples[i]={query:q,...await capture({request:requestFor(q),apiKey,maxPages:2,maxRows:10000})};if((i+1)%25===0)console.log('Queries captured '+(i+1)+'/'+plan.queries.length);}}
await Promise.all([worker(),worker(),worker()]);
let published;
try{const url='https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES&includeContext=1',response=await fetch(url,{signal:AbortSignal.timeout(45000)}),body=Buffer.from(await response.arrayBuffer()),s=JSON.parse(body),strategy=s?.strategies?.['intraday_scalp@10m']?.engine22WaveStrategy;
 const numericPrices=[];function scan(v,p){if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v))scan(x,p+'.'+k);}else if(typeof v==='number'&&v>1000&&/(fib|levels|projected|retracement|extension|targetModel|correctionModel|invalidation)/i.test(p))numericPrices.push({sourcePath:p,price:v,officialApproval:'UNKNOWN'});}
 if(strategy)scan(strategy,'strategies["intraday_scalp@10m"].engine22WaveStrategy');
 published={url,httpStatus:response.status,observedAt:new Date().toISOString(),bodySha256:digest(body),selected:captureEngine22Publications(s),numericPrices};
}catch(error){published={state:'UNAVAILABLE',error:String(error)}}
const provenance=JSON.parse(await fs.readFile(path.join(sourceRoot,'services/core/data/engine22/node-registry/reconciliation-evidence.v1.json'),'utf8'));
const evidence={schemaVersion:'engine11.node-reconciliation-original.research.v1',asOf:new Date().toISOString(),workbookSha256:digest(bytes),registrySha:plan.registrySha,plan,intake:{allNodes:intake.allNodes,fibs:intake.fibs},legacyProvenance:provenance,samples,published,canonicalEligible:false,structuralEligible:false};
await fs.mkdir(out,{recursive:true});const original=Buffer.from(JSON.stringify(evidence));await fs.writeFile(path.join(out,'node-reconciliation-original.json.gz'),gzipSync(original));
const manifest={schemaVersion:'engine11.node-reconciliation-manifest.research.v1',asOf:evidence.asOf,originalUncompressedSha256:digest(original),workbookSha256:evidence.workbookSha256,nodeCount:intake.allNodes.length,fibCount:intake.fibs.length,queryCount:samples.length,successfulQueries:samples.filter(s=>!s.failure).length,rows:samples.reduce((a,s)=>a+s.rows.length,0),failures:samples.filter(s=>s.failure).map(s=>({queryId:s.query.queryId,purpose:s.query.purpose,contract:s.query.contract.full,failure:s.failure})),receiptCount:samples.reduce((a,s)=>a+s.receipts.length,0),structuralEligible:false};
await fs.writeFile(path.join(out,'node-reconciliation-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
