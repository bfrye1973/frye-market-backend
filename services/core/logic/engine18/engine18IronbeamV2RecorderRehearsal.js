// Engine18 Ironbeam v2 read-only transport rehearsal.
// NO LIVE CAPTURE: this constructor accepts ONLY the synthetic host and
// injected fake transport. Real Ironbeam wiring requires a reviewed gate.
// Follows existing Engine18 monitor v2 endpoint order, never alters it.
const MOCK_ORIGIN='https://synthetic.ironbeam.invalid';
const PHYSICAL_ES='XCME:ES.Z26';
const SUBS=Object.freeze(['quotes','depths','trades']);
function ensureId(id){
 if(typeof id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(id))throw Error('invalid synthetic stream identity');
 return id;
}
export function createEngine18IronbeamV2RecorderRehearsal({
 supervisor,fetchImpl,WebSocketImpl,endpoint=MOCK_ORIGIN,physicalContract=PHYSICAL_ES,
 credentials={username:'MOCK_USER',password:'MOCK_PASS',apiKey:'MOCK_KEY'}
}={}){
 if(endpoint!==MOCK_ORIGIN||typeof fetchImpl!=='function'||typeof WebSocketImpl!=='function')
  throw Error('real Ironbeam transport disabled; synthetic injected transport only');
 if(!supervisor||typeof supervisor.open!=='function'||typeof supervisor.frame!=='function'||
    typeof supervisor.subscription!=='function'||typeof supervisor.socketEvent!=='function')
  throw Error('isolated durable supervisor required');
 if(physicalContract!==PHYSICAL_ES)throw Error('unverified physical contract mapping');
 let closed=false,current=null,lastGeneration=0;
 const asyncOps=new Set(),errors=[];
 const recordWork=p=>{
  const tracked=Promise.resolve(p).catch(()=>{errors.push('RECORDER_REHEARSAL_FAILURE');});
  asyncOps.add(tracked);tracked.finally(()=>asyncOps.delete(tracked));return tracked;
 };
 async function request(path,token,method='GET',body){
  const response=await fetchImpl(MOCK_ORIGIN+path,{
   method,headers:{Accept:'application/json',
    ...(body?{'Content-Type':'application/json'}:{}),
    ...(token?{Authorization:'Bearer '+token}:{})},
   ...(body?{body:JSON.stringify(body)}:{})
  });
  if(!response?.ok)throw Error('synthetic v2 endpoint refused');
  const out=await response.json();
  if(out?.status==='ERROR')throw Error('synthetic v2 subscription rejected');
  return out;
 }
 function attachFrame(socket,ticket){
  socket.addEventListener('message',event=>{
   // The ticket is immutable and remains attached to the OLD connection.
   // Do not substitute whichever generation happened to open most recently.
   recordWork(supervisor.frame(ticket,event.data));
  });
  socket.addEventListener('error',()=>{
   recordWork(supervisor.socketEvent(ticket,'WS_ERROR',{reason:'TRANSPORT_FAILURE'}));
  });
  socket.addEventListener('close',event=>{
   const code=Number.isInteger(event?.code)&&event.code>=1000&&event.code<=4999?event.code:null;
   recordWork(supervisor.socketEvent(ticket,'DISCONNECTED',{reason:'REMOTE_CLOSE',closeCode:code}));
  });
 }
 async function connect(){
  if(closed)throw Error('recorder rehearsal stopped');
  const auth=await request('/v2/auth',null,'POST',{
   username:credentials.username,password:credentials.password,apiKey:credentials.apiKey
  });
  if(typeof auth?.token!=='string'||!auth.token)throw Error('synthetic authentication missing token');
  const created=await request('/v2/stream/create',auth.token);
  const streamId=ensureId(created?.streamId);
  const {socket:ticket,ack}=supervisor.open({connectionId:'stream_'+streamId});
  await ack;
  const endpoint='wss://synthetic.ironbeam.invalid/v2/stream/'+encodeURIComponent(streamId)+
   '?token='+encodeURIComponent(auth.token);
  const ws=new WebSocketImpl(endpoint);
  attachFrame(ws,ticket);
  current={socket:ws,ticket,streamId};lastGeneration=ticket.generation;
  // Subscription receipts are local controls and never include Bearer tokens.
  for(const type of SUBS){
   let status='FAILED';
   try{
    await request('/v2/market/'+type+'/subscribe/'+encodeURIComponent(streamId)+
     '?symbols='+encodeURIComponent(physicalContract),auth.token);
    status='SUCCESS';
   }finally{
    await supervisor.subscription(ticket,{feedType:type,physicalContract,streamId,status});
   }
  }
  return Object.freeze({streamId,generation:ticket.generation,socket:ws,ticket});
 }
 async function drain(){await Promise.all([...asyncOps]);}
 function stop(){closed=true;try{current?.socket?.close();}catch{}}
 function status(){return Object.freeze({
  schema:'engine18.ironbeam.rehearsal.v1',mode:'SYNTHETIC_ONLY',
  active:!closed,latestGeneration:lastGeneration,recordingIssues:errors.length,
  contract:physicalContract,feedSemantics:'UNVERIFIED'
 });}
 return Object.freeze({connect,drain,stop,status});
}
