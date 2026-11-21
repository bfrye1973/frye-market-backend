// Engine 22 — read-only October 26 C-down historical evidence inventory.
// IMPORTANT: 3m dashboard snapshots are NOT 5m/10m OHLC bars.
// No network, Polygon, writes, account data, or trading actions.
// Run: node services/core/scripts/auditCDownMorningArchiveReadOnly.js
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const re=/^\d{4}\.json$/;
const iso=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const num=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const owner=(e,d)=>d==="micro"?e?.currentWavelength?.degrees?.micro?.ownerMicroCDown:
  e?.currentWavelength?.degrees?.submicro?.ownerSubmicroCDown;
const safe=o=>o!==null&&typeof o==="object"&&!Array.isArray(o);
const values=o=>safe(o)?Object.entries(o):[];
const rootValue=(s)=>s?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy??null;
const date="2026-10-26";
export function inspectEngine22CDownMorningSnapshots({
  root="/var/data/replay/es",fromHHMM="0400",toHHMM="1200",limit=250,
}={}){
 const day=path.join(root,date);
 if(!/^\d{4}$/.test(fromHHMM)||!/^\d{4}$/.test(toHHMM)||fromHHMM>toHHMM||
  !Number.isInteger(limit)||limit<1||limit>500)return {ok:false,reason:"INVALID_AUDIT_WINDOW"};
 let names;
 try{const st=fs.lstatSync(day);if(!st.isDirectory()||st.isSymbolicLink())throw Error("UNSAFE_DIRECTORY");
   names=fs.readdirSync(day).filter(n=>re.test(n)&&n.slice(0,4)>=fromHHMM&&n.slice(0,4)<=toHHMM).sort();
 }catch(e){return {ok:false,reason:"ARCHIVE_DAY_UNAVAILABLE",detail:e.message};}
 if(!names.length)return {ok:false,reason:"NO_SNAPSHOTS_IN_WINDOW"};
 if(names.length>limit)return {ok:false,reason:"AUDIT_WINDOW_TOO_LARGE",files:names.length};
 const samples=[],errors=[],candidatePaths=new Set();
 for(const name of names){
   const file=path.join(day,name);
   try {
     const st=fs.lstatSync(file);
     if(!st.isFile()||st.isSymbolicLink())throw Error("UNSAFE_SOURCE_FILE");
     const snapshot=JSON.parse(fs.readFileSync(file,"utf8"));
     if(snapshot?.symbol!=="ES")throw Error("NOT_ES_SNAPSHOT");
     const e=rootValue(snapshot);
     const detail={file:name,time:snapshot.snapshotTime??null,
       currentPrice:num(snapshot.currentPrice)??num(snapshot.price),
       engine22Present:Boolean(e),
       micro:{modelVersion:owner(e,"micro")?.version??null,stage:owner(e,"micro")?.stage??null,
         direction:owner(e,"micro")?.direction??null,sourceCountId:owner(e,"micro")?.countId??null},
       submicro:{modelVersion:owner(e,"submicro")?.version??null,
         stage:owner(e,"submicro")?.stage??null,direction:owner(e,"submicro")?.direction??null,
         sourceCountId:owner(e,"submicro")?.countId??null},
       lifecycle:e?.currentLifecycleState??null};
     // Bounded structural discovery, not a validity assertion.
     const stack=[{node:e,path:"engine22WaveStrategy",depth:0}];
     let visits=0;
     while(stack.length&&visits++<1500){
       const item=stack.pop();if(item.depth>6)continue;
       if(Array.isArray(item.node)){
         if(item.node.length>=3&&item.node.some(b=>safe(b)&&
           ["high","h"].some(k=>num(b[k])!==null)&&
           ["low","l"].some(k=>num(b[k])!==null)&&
           ["close","c"].some(k=>num(b[k])!==null)))
           candidatePaths.add(item.path);
         continue;
       }
       for(const [k,v] of values(item.node)){
         if(safe(v)||Array.isArray(v))stack.push({node:v,path:item.path+"."+k,depth:item.depth+1});
       }
     }
     samples.push(detail);
   }catch(error){errors.push({file:name,reason:String(error.message)});}
 }
 const priced=samples.filter(s=>s.currentPrice!==null);
 const lowest=priced.reduce((best,s)=>!best||s.currentPrice<best.currentPrice?s:best,null);
 const highest=priced.reduce((best,s)=>!best||s.currentPrice>best.currentPrice?s:best,null);
 const change=(degree)=>{
   const versions=[...new Set(samples.map(s=>s[degree].modelVersion).filter(Boolean))];
   const stages=[...new Set(samples.map(s=>s[degree].stage).filter(Boolean))];
   return {versions,stages,first:samples[0]?.[degree]??null,last:samples.at(-1)?.[degree]??null};
 };
 return {ok:errors.length===0,mode:"READ_ONLY_SNAPSHOT_EVIDENCE_INVENTORY",
   date,windowArizona:{fromHHMM,toHHMM},snapshotsScanned:samples.length,
   timeRangeUTC:{first:samples[0]?.time??null,last:samples.at(-1)?.time??null},
   priceSamples:priced.length,
   lowSample:lowest?{time:lowest.time,price:lowest.currentPrice,file:lowest.file}:null,
   highSample:highest?{time:highest.time,price:highest.currentPrice,file:highest.file}:null,
   micro:change("micro"),submicro:change("submicro"),
   potentialOhlcArrayPaths:[...candidatePaths].slice(0,25),errors:errors.slice(0,10),
   cCompletionDetected:null,
   completionVerdict:"NOT_TESTABLE_FROM_SNAPSHOT_PRICES_ALONE",
   requiredForBacktest:["AUTHENTICATED_ES_5M_CLOSED_OHLC","PRE_REVERSAL_COUNT_IDENTITY",
     "PREDEFINED_COMPLETION_RULE","NO_FUTURE_BAR_LOOKAHEAD"],
   archiveFilesModified:false,noExecution:true};
}
const direct=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct){const result=inspectEngine22CDownMorningSnapshots({
 root:process.env.ENGINE22_READONLY_ES_ARCHIVE_ROOT||"/var/data/replay/es",
 fromHHMM:process.env.ENGINE22_AUDIT_START_AZ||"0400",
 toHHMM:process.env.ENGINE22_AUDIT_END_AZ||"1200",
});console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}
