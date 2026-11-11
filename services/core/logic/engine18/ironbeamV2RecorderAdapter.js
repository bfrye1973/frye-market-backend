// Engine 18 Gate 1 Phase 2: synthetic-only Ironbeam v2 frame adapter.
// Pure classifier: never creates a socket and never records a licensed feed.
// No raw payloads or vendor error strings are included in diagnostics.
const MSG_CLASSES=new Set(['market','control','error','unknown']);
const KNOWN={d:'depth',tr:'trade',q:'quote',p:'heartbeat'};
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clampBucket=x=>Number.isFinite(x)?Math.min(10000,Math.max(0,Math.floor(x))):0;
function summarizeDepth(payload){
 const summary={bidCount:0,askCount:0,zeroSize:0,levelIndexCount:0,missingIndex:0,nonArraySides:0};
 const candidates=[];
 const d=payload.d;
 if(Array.isArray(d))candidates.push(...d.filter(isObject));
 else if(isObject(d))candidates.push(d);
 else{summary.nonArraySides++;return summary;}
 for(const ob of candidates){
  const sides=[ob.bids,ob.asks,ob.b,ob.a,ob.bid,ob.ask];
  // Do not count both aliases if both are present: probe schema, do not assert semantics.
  const bid=Array.isArray(ob.bids)?ob.bids:Array.isArray(ob.b)?ob.b:Array.isArray(ob.bid)?ob.bid:null;
  const ask=Array.isArray(ob.asks)?ob.asks:Array.isArray(ob.a)?ob.a:Array.isArray(ob.ask)?ob.ask:null;
  for(const [side,rows] of [['bid',bid],['ask',ask]]){
   if(!rows){summary.nonArraySides++;continue;}
   summary[side+'Count']+=rows.length;
   for(const entry of rows){
    if(!isObject(entry)){summary.missingIndex++;continue;}
    if(Object.hasOwn(entry,'l'))summary.levelIndexCount++;else summary.missingIndex++;
    if(entry.sz===0||entry.sz==='0')summary.zeroSize++;
   }
  }
 }
 return summary;
}
function frameShape(input){
 let raw,rawEncoding;
 if(typeof input==='string'){raw=input;rawEncoding='utf8';}
 else if(Buffer.isBuffer(input)||input instanceof Uint8Array){raw=Buffer.from(input);rawEncoding='base64';}
 else throw Error('SYNTHETIC_FRAME_TYPE_REQUIRED');
 return {raw,rawEncoding};
}
export function classifyIronbeamRawFrame(input,{streamGeneration=0,receivedAt,wallNs,monoNs}={}){
 const f=frameShape(input);
 if(!Number.isSafeInteger(streamGeneration)||streamGeneration<0)throw Error('SYNTHETIC_GENERATION_INVALID');
 let parsed=null,malformed=false;
 if(typeof f.raw==='string'){
  try{parsed=JSON.parse(f.raw);}catch{malformed=true;}
 }else malformed=true; // Unknown binary framing: preserve bytes, never decode speculatively.
 let kind='unknown',msgClass='unknown',statusCode=null,depth=null;
 if(malformed){kind='malformed';statusCode='MALFORMED_FRAME';}
 else if(isObject(parsed)){
  const keys=Object.keys(KNOWN).filter(k=>Object.hasOwn(parsed,k));
  if(keys.includes('d')){kind='depth';msgClass='market';depth=summarizeDepth(parsed);}
  else if(keys.includes('tr')){kind='trade';msgClass='market';}
  else if(keys.includes('q')){kind='quote';msgClass='market';}
  else if(keys.includes('p')){kind='heartbeat';msgClass='control';}
  else if(keys.length===0){
   // Only known simple acknowledgments/status; unknowns still preserved.
   if(Object.hasOwn(parsed,'error')){kind='error';msgClass='error';statusCode='SOURCE_ERROR';}
   else if(Object.hasOwn(parsed,'status')||Object.hasOwn(parsed,'subscriptions')){kind='status';msgClass='control';}
  }
 }else{kind='malformed';statusCode='MALFORMED_FRAME';}
 // Vendor-level 't' meaning is UNVERIFIED; do not coerce it to an exchange clock.
 const meta={kind,msgClass,statusCode,streamGeneration,raw:f.raw,rawEncoding:f.rawEncoding,
  exchangeTimeNs:null,exchangeTimeQuality:'UNVERIFIED'};
 if(receivedAt!==undefined)meta.at=receivedAt;
 if(wallNs!==undefined)meta.wallNs=wallNs;
 if(monoNs!==undefined)meta.monoNs=monoNs;
 return {capture:meta,diagnostic:{kind,depth}};
}
export class IronbeamFrameShapeDiagnostics{
 constructor(){this.counts={total:0,depth:0,trade:0,quote:0,heartbeat:0,status:0,error:0,unknown:0,malformed:0,acceptedDepth:0,rejectedDepth:0,zeroSize:0,levelIndexCount:0,missingIndex:0,nonArraySides:0,reconnects:0,connections:0,disconnections:0};this.bids={};this.asks={};this.intervalsMs={under10:0,under100:0,under1000:0,over1000:0};this.previousMonoNs=null;this.lastReceivedWallNs=null;}
 observe(result,{receivedMonoNs,receivedWallNs}={}){
  const d=result?.diagnostic;
  if(!d)throw Error('diagnostic missing');
  this.counts.total++;
  this.counts[d.kind]=(this.counts[d.kind]||0)+1;
  if(d.kind==='depth'){
   if(d.depth&&d.depth.nonArraySides===0)this.counts.acceptedDepth++;else this.counts.rejectedDepth++;
   for(const k of ['zeroSize','levelIndexCount','missingIndex','nonArraySides'])this.counts[k]+=d.depth?.[k]||0;
   for(const [table,n] of [[this.bids,d.depth?.bidCount],[this.asks,d.depth?.askCount]]){
    const key=String(clampBucket(n));table[key]=(table[key]||0)+1;
   }
  }
  if(receivedMonoNs!=null){
   const current=BigInt(receivedMonoNs);
   if(this.previousMonoNs!==null&&current>=this.previousMonoNs){
    const ms=Number((current-this.previousMonoNs)/1000000n);
    const key=ms<10?'under10':ms<100?'under100':ms<1000?'under1000':'over1000';this.intervalsMs[key]++;
   }
   this.previousMonoNs=current;
  }
  if(receivedWallNs!=null)this.lastReceivedWallNs=String(receivedWallNs);
 }
 event(code){
  if(code==='CONNECTED')this.counts.connections++;
  else if(code==='DISCONNECTED')this.counts.disconnections++;
  else if(code==='RECONNECT')this.counts.reconnects++;
 }
 summary(){return JSON.parse(JSON.stringify({schema:'engine18.ironbeam.shape.v1',counts:this.counts,bidLevelHistogram:this.bids,askLevelHistogram:this.asks,intervalsMs:this.intervalsMs,lastReceivedWallNs:this.lastReceivedWallNs,feedSemantics:'UNVERIFIED',conflation:'UNVERIFIED'}));}
}
export function sanitizedRecorderControl(code,streamGeneration=0){
 if(!['CONNECTED','SUBSCRIBED','DISCONNECTED','RECONNECT','AUTH_FAILED','GAP','CLOCK_SAMPLE'].includes(code))throw Error('unsafe control code');
 return {raw:'',msgClass:code==='AUTH_FAILED'?'error':'control',statusCode:code,streamGeneration};
}
