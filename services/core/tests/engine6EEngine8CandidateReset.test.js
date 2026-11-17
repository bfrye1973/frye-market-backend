import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function inspect(dir,candidateId,planId){
 const script=`import {getEngine8DuplicateState} from "./logic/trading/engine8DuplicateState.js";
 const result=getEngine8DuplicateState({strategyId:"intraday_scalp@10m",candidateId:${JSON.stringify(candidateId)},planId:${JSON.stringify(planId)}});
 console.log(JSON.stringify({candidateAlreadyOrdered:result.candidateAlreadyOrdered,
   orderExistsForPlanId:result.orderExistsForPlanId,acceptanceTradeCompleted:result.acceptanceTradeCompleted,
   newPaperOrdersAllowed:result.newPaperOrdersAllowed,activeTradeIdExists:result.activeTradeIdExists,
   openTradeForStrategy:result.openTradeForStrategy}));`;
 const child=spawnSync(process.execPath,["--input-type=module","-e",script],{
   cwd:core,encoding:"utf8",env:{...process.env,ENGINE8_PAPER_DATA_DIR:dir}});
 assert.equal(child.status,0,child.stderr);
 return JSON.parse(child.stdout);
}
test("Engine8 duplicate protections reset per fresh candidate but preserve acceptance lock",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine6e-e8state-"));
 try{
   fs.writeFileSync(path.join(dir,"paper-orders.json"),JSON.stringify([
     {candidateId:"A",planId:"PLAN-A",strategyId:"intraday_scalp@10m",status:"CLOSED"}]));
   fs.writeFileSync(path.join(dir,"engine8-paper-acceptance-state.json"),JSON.stringify({
     acceptanceTradeCompleted:false,newPaperOrdersAllowed:true}));
   const duplicate=inspect(dir,"A","PLAN-A");
   assert.equal(duplicate.candidateAlreadyOrdered,true);
   assert.equal(duplicate.orderExistsForPlanId,true);
   const fresh=inspect(dir,"B","PLAN-B");
   assert.equal(fresh.candidateAlreadyOrdered,false);
   assert.equal(fresh.orderExistsForPlanId,false);
   assert.equal(fresh.acceptanceTradeCompleted,false);
   assert.equal(fresh.newPaperOrdersAllowed,true);
   fs.writeFileSync(path.join(dir,"engine8-paper-acceptance-state.json"),JSON.stringify({
     acceptanceTradeCompleted:true,newPaperOrdersAllowed:false,tradeId:"CLOSED-ACCEPTANCE"}));
   const lockedFresh=inspect(dir,"B","PLAN-B");
   assert.equal(lockedFresh.candidateAlreadyOrdered,false);
   assert.equal(lockedFresh.acceptanceTradeCompleted,true);
   assert.equal(lockedFresh.newPaperOrdersAllowed,false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
