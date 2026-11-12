import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function prepare(store,id,plan){
 const code=`import {prepareEngine8PaperExecution} from "./logic/trading/engine8PaperExecutor.js";
 const r=await prepareEngine8PaperExecution({engine8PaperOrder:{
   status:"READY_TO_CREATE_PAPER_ORDER",executable:true,paperOnly:true,
   realExecutionAllowed:false,brokerExecutionAllowed:false,schwabExecutionAllowed:false,
   candidateId:${JSON.stringify(id)},planId:${JSON.stringify(plan)},
   zoneId:"ZONE-ENTRY",strategyId:"intraday_scalp@10m",symbol:"ES",direction:"LONG",
   setupType:"NEGOTIATED_ZONE_ROTATION",snapshotTime:"2026-11-11T22:00:00Z",
   finalContracts:3,officialEntryPrice:7500,officialStopPrice:7490,officialStopDistancePoints:10
 }});
 console.log(JSON.stringify({status:r.status,ok:r.ok,orderCreated:r.orderCreated,
   duplicateBlocked:r.duplicateBlocked,tradeId:r.tradeId,reasonCodes:r.reasonCodes}));`;
 const result=spawnSync(process.execPath,["--input-type=module","-e",code],{
   cwd:core,encoding:"utf8",env:{...process.env,ENGINE8_PAPER_DATA_DIR:store,
     ENGINE8_LIVE_TRADING_ENABLED:"0",ENGINE8_ALLOW_LIVE_FUTURES:"0"}});
 assert.equal(result.status,0,result.stderr);
 return JSON.parse(result.stdout);
}
test("actual Engine8 preparation accepts fresh candidate and rejects old identities without creating any orders",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine6e-prepare-"));
 try{
  fs.writeFileSync(path.join(dir,"paper-orders.json"),JSON.stringify([{candidateId:"OLD",planId:"OLDPLAN",status:"CLOSED"}]));
  fs.writeFileSync(path.join(dir,"engine8-paper-acceptance-state.json"),
    JSON.stringify({acceptanceTradeCompleted:false,newPaperOrdersAllowed:true}));
  const old=prepare(dir,"OLD","OLDPLAN");
  assert.equal(old.status,"DUPLICATE_ORDER_BLOCKED");
  assert.equal(old.orderCreated,false);
  const fresh=prepare(dir,"FRESH","FRESHPLAN");
  assert.equal(fresh.status,"READY_FOR_PAPER_EXECUTION_CALL");
  assert.equal(fresh.orderCreated,false);
  assert.equal(fresh.tradeId,null);
  fs.writeFileSync(path.join(dir,"engine8-paper-acceptance-state.json"),
    JSON.stringify({acceptanceTradeCompleted:true,newPaperOrdersAllowed:false}));
  const locked=prepare(dir,"FRESH","FRESHPLAN");
  assert.equal(locked.status,"DUPLICATE_ORDER_BLOCKED");
  assert.equal(locked.orderCreated,false);
  assert.equal(fs.readdirSync(dir).length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
