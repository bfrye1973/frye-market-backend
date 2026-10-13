import fs from 'node:fs/promises';
import {hash} from '../../../logic/engine11/acceptanceResearchV1/eligibility.js';
import {captureEngine22Publications,comparePublications} from '../../../logic/engine11/finalCompatibilityResearchV1/comparePublications.js';
const urls=[['core','https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES&includeContext=1'],['previewUpstream','https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES'],['overlay','https://engine2b-preview-api.onrender.com/api/v1/engine2/chart-overlays/v1?symbol=ES'],['candles','https://frye-market-backend-1.onrender.com/api/v1/futures/ohlc?symbol=ES&timeframe=10m&limit=3&debug=1']];
const captures={},data={};
for(const [name,url] of urls){const startedAt=new Date().toISOString();try{const response=await fetch(url,{signal:AbortSignal.timeout(45000),headers:{Accept:'application/json'}});const bytes=Buffer.from(await response.arrayBuffer());let payload;try{payload=JSON.parse(bytes.toString('utf8'))}catch{};data[name]=payload;let selected=null;
if(name==='core'||name==='previewUpstream')selected=captureEngine22Publications(payload??{});
else if(name==='overlay')selected=payload;
else if(payload)selected={requestedSymbol:payload.requestedSymbol,resolvedSymbol:payload.resolvedSymbol,productCode:payload.productCode,timeframe:payload.timeframe,resolution:payload.resolution,resolver:payload.resolver,startDate:payload.startDate,endDate:payload.endDate,count:payload.count,firstBar:payload.firstBar,lastBar:payload.lastBar};
captures[name]={url,startedAt,observedAt:new Date().toISOString(),httpStatus:response.status,bodySha256:hash(bytes),etag:response.headers.get('etag'),selected};}catch(error){captures[name]={url,startedAt,observedAt:new Date().toISOString(),state:'UNAVAILABLE',error:String(error)}}}
const comparison=comparePublications({core:captures.core?.selected??{},previewSource:captures.previewUpstream?.selected??{},overlay:data.overlay??{},candles:data.candles??{}});
const result={schemaVersion:'engine11.final-compatibility-evidence.v1',captures,comparison,privateSourceArchiveTransferred:false,productionChanges:0};
await fs.mkdir('research-evidence',{recursive:true});await fs.writeFile('research-evidence/final-compatibility.json',JSON.stringify(result,null,2));console.log(JSON.stringify({captures:Object.fromEntries(Object.entries(captures).map(([k,v])=>[k,{status:v.httpStatus,state:v.state}])),conflict:comparison.conflict,chart:comparison.chart,approval:comparison.approval}));
