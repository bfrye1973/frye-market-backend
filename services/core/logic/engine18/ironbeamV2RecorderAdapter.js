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
 if(Array.isArray(d)){candidates.push(...d.filter(isObject));if(!candidates.length)summary.nonArraySides++;}
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

export class SyntheticIronbeamRecorderTap {
 constructor({recorder,diagnostics=new IronbeamFrameShapeDiagnostics(),authorized=false}={}){
  if(authorized!==false)throw Error('licensed Ironbeam recording NOT AUTHORIZED');
  if(!recorder||typeof recorder.offer!=='function')throw Error('synthetic recorder required');
  this.recorder=recorder;this.diagnostics=diagnostics;this.generation=0;this.connected=false;
 }
 captureSource(frame,{at}={}){
  // Timestamp and snapshot source bytes, no JSON parsing, no disk operations.
  const source=frameShape(frame);
  const receipt=this.recorder.capture({raw:source.raw,rawEncoding:source.rawEncoding,
    msgClass:'unknown',streamGeneration:this.generation,at});
  return {source,receipt};
 }
 persistCaptured({source,receipt}){
  // Classification after the reader has received the original event; preserve
  // receipt clock/generation even when processing is deferred.
  const parsed=classifyIronbeamRawFrame(source.raw,{streamGeneration:receipt.streamGeneration});
  const classified=Object.freeze({...receipt,msgClass:parsed.capture.msgClass,
    statusCode:parsed.capture.statusCode});
  return this.recorder.offerCaptured(classified).then(ack=>{
   this.diagnostics.observe(parsed,{receivedWallNs:ack.receivedWallNs,receivedMonoNs:ack.receivedMonoNs});
   return ack;
  });
 }
 onFrame(frame,{at}={}){return this.persistCaptured(this.captureSource(frame,{at}));}
 captureControl(code,{at}={}){
  if(code==='CONNECTED'||code==='RECONNECT'){this.generation++;this.connected=true;}
  if(code==='DISCONNECTED')this.connected=false;
  const safe=sanitizedRecorderControl(code,this.generation);
  return Object.freeze({code,receipt:this.recorder.capture({...safe,at})});
 }
 async persistControl({code,receipt}){
  const ack=await this.recorder.offerCaptured(receipt);
  this.diagnostics.event(code);
  if(code==='RECONNECT')this.recorder.onReconnect?.();
  return ack;
 }
 onControl(code,{at}={}){return this.persistControl(this.captureControl(code,{at}));}
 safeDiagnostics(){return this.diagnostics.summary();}
}

/**
 * An injectable synthetic WebSocket constructor for the existing Engine 18
 * monitor's WebSocketImpl seam. No edits to the production monitor are needed.
 * It never creates a connection itself; a synthetic BaseWebSocket is required.
 * Market reader handlers run immediately; raw recording occurs in parallel and errors
 * are reported separately. No guarantee of durable capture when source cannot pause.
 * Licensed use requires a separate manager-authorized integration/security gate.
 */
export function createSyntheticRecorderWebSocketImpl(BaseWebSocket,{tap,maxInbound=1024,onFailure=()=>{}}={}){
 if(typeof BaseWebSocket!=='function'||!(tap instanceof SyntheticIronbeamRecorderTap))throw Error('synthetic transport and recorder tap required');
 if(!Number.isInteger(maxInbound)||maxInbound<1)throw Error('invalid synthetic ingress cap');
 // This is a NONBLOCKING observation shim, not a durable relay. The reader must not depend
 // on disk throughput. Recorder failure is reported to supervisor while reader continues.
 let previousConnection=false;
 return class SyntheticRecordingWebSocket{
  constructor(...args){
   this.inner=new BaseWebSocket(...args);
   this.pending=0;this.failed=false;this.queue=Promise.resolve();this.lastControl=Promise.resolve();
   this.inner.addEventListener('open',()=>{
    const event=previousConnection?'RECONNECT':'CONNECTED';previousConnection=true;
    this.recordControl(event);
   });
   this.inner.addEventListener('close',()=>this.recordControl('DISCONNECTED'));
   this.inner.addEventListener('error',()=>this.recordControl('GAP'));
   this.inner.addEventListener('message',e=>{
    // Only a small, synchronous receipt stamp + copy precedes the existing
    // reader callback. JSON classification, queueing and disk happen later.
    if(this.failed)return;
    if(this.pending>=maxInbound){this.abort('RECORDER_INGRESS_OVERFLOW');return;}
    let captured;
    try{captured=tap.captureSource(e.data);}catch{this.abort('RECORDER_CAPTURE_FAILED');return;}
    this.pending++;
    // Preserve receipt order without requiring reader to await durable writes.
    const recording=this.queue.then(()=>tap.persistCaptured(captured))
      .catch(()=>this.abort('RECORDER_WRITE_FAILED'))
      .finally(()=>{this.pending--;});
    this.queue=recording.then(()=>{});
   });
  }
  recordControl(code){
   if(this.failed)return;
   let captured;
   try{captured=tap.captureControl(code);}catch{this.abort('RECORDER_CONTROL_FAILED');return;}
   const work=this.queue.then(()=>tap.persistControl(captured))
     .catch(()=>this.abort('RECORDER_CONTROL_FAILED'));
   this.lastControl=work;
   this.queue=work.then(()=>{});
  }
  abort(reason){
   if(this.failed)return;
   this.failed=true;
   tap.recorder.fail(reason);
   // Deliberately DO NOT close the market-data reader's socket.
   // Production recorder will require a separate isolated transport.
   try{onFailure(reason);}catch{}
  }
  addEventListener(type,handler,options){return this.inner.addEventListener(type,handler,options);}
  removeEventListener(type,handler,options){return this.inner.removeEventListener?.(type,handler,options);}
  send(...args){return this.inner.send(...args);}
  close(...args){return this.inner.close(...args);}
  get readyState(){return this.inner.readyState;}
  get bufferedAmount(){return this.inner.bufferedAmount;}
 };
}
