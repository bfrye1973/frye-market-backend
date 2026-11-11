// Isolated synthetic recorder child: no real source socket and no trading APIs.
// Run only as a child_process.fork with ENGINE18_SYNTHETIC_WORKER=1.
import {Engine18BufferedRecorder} from './engine18BufferedRecorder.js';
if(process.env.ENGINE18_SYNTHETIC_WORKER!=='1'||typeof process.send!=='function')
 throw Error('isolated synthetic worker disabled');
let recorder=null,queue=Promise.resolve(),faulted=false,cleanExit=false;
const syntheticSlowDiskMs=Number(process.env.ENGINE18_SYNTHETIC_SLOW_DISK_MS||0);
if(!Number.isInteger(syntheticSlowDiskMs)||syntheticSlowDiskMs<0||syntheticSlowDiskMs>100)throw Error('invalid synthetic disk delay');
const sleepWord=new Int32Array(new SharedArrayBuffer(4));
const clock={wallNs:()=>String(BigInt(Date.now())*1000000n),monoNs:()=>String(process.hrtime.bigint())};
function safeSend(item){try{process.send(item);}catch{}}
async function dispatch(message){
 if(!message||typeof message!=='object')throw Error('invalid worker command');
 if(message.type==='INIT'){
  if(recorder)throw Error('worker already initialized');
  if(typeof message.root!=='string'||!message.root.startsWith('/tmp/'))throw Error('synthetic tmp root only');
  recorder=await Engine18BufferedRecorder.openBounded({root:message.root,clock,batchSize:32,flushDelayMs:0,
   testFault:syntheticSlowDiskMs?stage=>{
    if(stage==='BEFORE_FSYNC')Atomics.wait(sleepWord,0,0,syntheticSlowDiskMs);
   }:null});
  safeSend({type:'READY',runId:recorder.writer.runId});return;
 }
 if(!recorder)throw Error('worker not initialized');
 if(message.type==='FRAME'){
  const r=message.receipt;
  if(typeof r?.raw!=='string'||!['utf8','base64'].includes(r.rawEncoding)||
   typeof r.receivedWallNs!=='string'||typeof r.receivedMonoNs!=='string'||
   !Number.isSafeInteger(r.streamGeneration))throw Error('bad synthetic receipt');
  const receipt=Object.freeze({...r,receiptDate:new Date(Number(BigInt(r.receivedWallNs)/1000000n))});
  // Queue without awaiting each ACK; waiting here would serialize fsync per
  // frame and defeat group commits under high-volume input. ACK only after commit.
  recorder.offerCaptured(receipt).then(
   ack=>safeSend({type:'ACK',id:message.id,seq:ack.localSeq}),
   ()=>{recorder.fail('GROUP_COMMIT_FAILED');safeSend({type:'FAILED',reason:'GROUP_COMMIT_FAILED',id:message.id});}
  );
  return;
 }
 if(message.type==='HEALTH'){
  const h=recorder.health();
  safeSend({type:'HEALTH',id:message.id,received:h.received,recorded:h.recorded,failedClosed:h.failedClosed});return;
 }
 if(message.type==='CLOSE'){
  await recorder.close();cleanExit=true;safeSend({type:'CLOSED',lastSeq:recorder.writer.seq});
  process.exitCode=0;return;
 }
 if(message.type==='FAIL'){
  recorder.fail('IPC_TRANSPORT_FAILURE');faulted=true;
  safeSend({type:'FAILED',reason:'IPC_TRANSPORT_FAILURE'});return;
 }
 throw Error('unsupported synthetic worker command');
}
process.on('message',message=>{
 queue=queue.then(()=>dispatch(message)).catch(()=>{
  faulted=true;
  recorder?.fail('WORKER_RECORDING_FAILED');
  safeSend({type:'FAILED',reason:'WORKER_RECORDING_FAILED',id:message?.id});
 });
});

// If the parent is killed, orphaned capture is unsafe. Preserve fsync-committed
// records, NEVER emit a clean STOP, and let the next startup record GAP.
process.on('disconnect',()=>{
 if(!cleanExit){faulted=true;recorder?.fail('PARENT_IPC_DISCONNECTED');process.exit(76);}
 process.exit(0);
});
process.on('SIGTERM',()=>{
 if(!cleanExit)recorder?.fail('WORKER_TERMINATED');
 process.exit(cleanExit?0:76);
});
