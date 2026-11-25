// Standalone Render entry for the Rithmic Paper Step A probe. NOT wired to any
// existing service. Runs at most once per process, only when
// RITHMIC_PAPER_CONNECT_ENABLED=YES; otherwise stays DISABLED. No HTTP exposure of
// market data, credentials, vendor strings or gateway details.
import http from 'node:http';
import {runPaperStepA} from './engine18RithmicPaperProbe.js';
const status={service:'engine18.rithmicPaperStepA.v1',phase:'STARTING',readOnly:true,completed:false};
http.createServer((req,res)=>{
 if(req.method!=='GET'||req.url!=='/health'){res.writeHead(404);res.end();return}
 res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
 res.end(JSON.stringify(status));
}).listen(Number(process.env.PORT||10000),'0.0.0.0',()=>{
 console.log('RITHMIC_PAPER_SERVICE_READY readOnly=true noRecorder=true noTrading=true');
 if(process.env.RITHMIC_PAPER_CONNECT_ENABLED!=='YES'){
  status.phase='DISABLED';status.completed=true;console.log('RITHMIC_PAPER_CONNECT_DISABLED');return}
 status.phase='RUNNING';
 runPaperStepA({onStatus:s=>{status.phase=s.phase}}).then(r=>{
  status.phase=r.verdict;
  console.log('RITHMIC_PAPER_STEP_A_RESULT '+JSON.stringify(r));
 }).catch(()=>{status.phase='FAILED';console.log('RITHMIC_PAPER_STEP_A_FAILED sanitized')})
  .finally(()=>{status.completed=true});
});
