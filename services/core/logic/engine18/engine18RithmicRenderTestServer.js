// Standalone read-only Rithmic Test connectivity probe on dedicated Render Free service.
// Does not import any live trading, chart, Ironbeam, or recording code.
// No authentication data or raw market data is exposed over HTTP or persisted.
import http from 'node:http';
import {probeRithmicTest} from './engine18RithmicTestProbe.js';
import {probeRithmicDbo} from './engine18RithmicDboEntitlementProbe.js';
import {runConformance} from './engine18RithmicConformanceTest.js';
const port=Number(process.env.PORT||10000);
const host='0.0.0.0';
const status={phase:'STARTING',readOnly:true,attempts:0,completed:false,connected:false};
function limitedText(x){return typeof x==='string'&&/^[0-9]{1,6}$/.test(x)?x:'UNRECOGNIZED'}
const app=http.createServer((req,res)=>{
 if(req.url!=='/health'||req.method!=='GET'){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
 // Do not expose system names, vendor codes, credential details, or market data.
 res.end(JSON.stringify({service:'engine18.rithmicTestProbe.v1',phase:status.phase,
  readOnly:true,completed:status.completed,connected:status.connected}));
});
app.listen(port,host,()=>{
 console.log('RITHMIC_TEST_SERVICE_READY readOnly=true noRecorder=true noTrading=true');
 if(process.env.RITHMIC_TEST_CONFORMANCE_LOGIN_ENABLED==='YES'){
  if(status.attempts++)return;
  status.phase='CONFORMANCE_STARTING';
  console.log('RITHMIC_CONFORMANCE_SESSION_START requestedPlant=ORDER_PLANT trading=false');
  runConformance({maxRunMs:2*60*60*1000,onStatus:state=>{
    status.phase=state.phase;status.connected=state.connected===true;
    if(state.phase==='CONNECTED'&&state.heartbeatResponses===0)
      console.log('RITHMIC_CONFORMANCE_CONNECTED authenticated=true plant=ORDER_PLANT readOnly=true');
    if(state.phase==='STOPPED')console.log('RITHMIC_CONFORMANCE_STOP '+state.stopReason);
  }}).catch(()=>{status.phase='CONFORMANCE_FAILED';status.connected=false;
    console.log('RITHMIC_CONFORMANCE_FAILED sanitized');
  }).finally(()=>{status.completed=true;status.connected=false;});
  return;
 }
 if(process.env.RITHMIC_TEST_CONNECT_ENABLED!=='YES'){
  status.phase='DISABLED';status.completed=true;
  console.log('RITHMIC_TEST_CONNECT_DISABLED');
  return;
 }
 if(status.attempts!==0)return;
 status.attempts=1;status.phase='PROBING';
 const doDbo=process.env.RITHMIC_TEST_DBO_PROBE_ENABLED==='YES';
 const operation=doDbo?probeRithmicDbo({timeoutMs:30000}):probeRithmicTest({timeoutMs:12000});
 operation.then(result=>{
  if(doDbo){
   status.phase=result.stage==='DBO_ENTITLEMENT'?'DBO_OBSERVED':'DBO_BLOCKED';
   console.log('RITHMIC_TEST_DBO_RESULT '+JSON.stringify({
    stage:result.stage,authenticated:result.authenticated===true,
    reason:result.reason,counts:result.counts,codes:result.codes,
    sawOrderUpdate:result.sawOrderUpdate===true,bookValid:false,readOnly:true,
    observedMs:result.observedMs,snapshotOrders:result.snapshotOrders,
    snapshotLevels:result.snapshotLevels,distinctSnapshotPrices:result.distinctSnapshotPrices,
    bestBid:result.bestBid,bestAsk:result.bestAsk,
    updateKinds:result.updateKinds,firstSequence:result.firstSequence,
    lastSequence:result.lastSequence,
    nonIncreasingSequences:result.nonIncreasingSequences,
    positiveSequenceJumps:result.positiveSequenceJumps,
    firstUpdateElapsedMs:result.firstUpdateElapsedMs,
    lastUpdateElapsedMs:result.lastUpdateElapsedMs,
    updateCountsPerSecond:result.updateCountsPerSecond}));
   return;
  }
  status.phase=result.stage==='LOGIN'&&result.authenticated?'AUTHENTICATED':
    result.stage==='LOGIN'?'LOGIN_REJECTED':'SYSTEM_UNAVAILABLE';
  console.log('RITHMIC_TEST_RESULT '+JSON.stringify({
    stage:result.stage,authenticated:result.authenticated===true,
    testAvailable:result.testAvailable===true,
    responseCodes:(result.rpCodes||[]).map(limitedText),
    readOnly:true,receivedDbo:false
  }));
 }).catch(()=>{
  status.phase='PROBE_FAILED';
  // Do not print errors, server strings, response bodies or credentials.
  console.log('RITHMIC_TEST_PROBE_FAILED connection_or_protocol_error');
 }).finally(()=>{status.completed=true;});
});
