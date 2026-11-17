// Standalone read-only Rithmic Test connectivity probe on dedicated Render Free service.
// Does not import any live trading, chart, Ironbeam, or recording code.
// No authentication data or raw market data is exposed over HTTP or persisted.
import http from 'node:http';
import {probeRithmicTest} from './engine18RithmicTestProbe.js';
const port=Number(process.env.PORT||10000);
const host='0.0.0.0';
const status={phase:'STARTING',readOnly:true,attempts:0,completed:false};
function limitedText(x){return typeof x==='string'&&/^[0-9]{1,6}$/.test(x)?x:'UNRECOGNIZED'}
const app=http.createServer((req,res)=>{
 if(req.url!=='/health'||req.method!=='GET'){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
 // Do not expose system names, vendor codes, credential details, or market data.
 res.end(JSON.stringify({service:'engine18.rithmicTestProbe.v1',phase:status.phase,
  readOnly:true,completed:status.completed}));
});
app.listen(port,host,()=>{
 console.log('RITHMIC_TEST_SERVICE_READY readOnly=true noRecorder=true noTrading=true');
 if(process.env.RITHMIC_TEST_CONNECT_ENABLED!=='YES'){
  status.phase='DISABLED';status.completed=true;
  console.log('RITHMIC_TEST_CONNECT_DISABLED');
  return;
 }
 if(status.attempts!==0)return;
 status.attempts=1;status.phase='PROBING';
 probeRithmicTest({timeoutMs:12000}).then(result=>{
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
