// P0 isolated protected HTTP acceptance. This test runs ONLY inside CI;
// it writes solely to a temporary PAPER/Engine10 store and restores the
// checkout's synthetic snapshot/legacy lifecycle files. No Schwab/broker API.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const coreData=path.join(repoRoot,"services/core/data");
const bridgeFile=path.join(repoRoot,"services/core/jobs/autoExecuteCanonicalPaperTrade.js");
const snapshotFile=path.join(coreData,"strategy-snapshot-es.json");
const legacyFiles=[
  snapshotFile,
  path.join(coreData,"engine8-paper-acceptance-state.json"),
  path.join(coreData,"engine8-paper-lifecycle-state.json"),
];

function fixture(candidateId) {
  const planId="PLAN-"+candidateId;
  const zoneId="ZONE-"+candidateId;
  const snapshotTime="2026-11-16T15:00:00Z";
  const officialTargets=[
    {targetId:"T1",sequence:1,price:7700,role:"TARGET_1",status:"READY"},
    {targetId:"T2",sequence:2,price:7710,role:"TARGET_2",status:"READY"},
    {targetId:"T3",sequence:3,price:7710,role:"TARGET_3",status:"READY"},
  ];
  const threeBlockManagement={
    totalContracts:3,
    blocks:[
      {blockId:"BLOCK_1",contractId:"CONTRACT_1",contracts:1,targetId:"T1",targetPrice:7700,purpose:"ZONE_BOUNDARY"},
      {blockId:"BLOCK_2",contractId:"CONTRACT_2",contracts:1,targetId:"T2",targetPrice:7710,purpose:"DESTINATION_MIDPOINT"},
      {blockId:"BLOCK_3",contractId:"CONTRACT_3",contracts:1,targetId:"T3",targetPrice:7710,purpose:"DESTINATION_MIDPOINT"},
    ],
  };
  const provenance={
    contractVersion:"strategy1.provenance.v1",
    source:"ENGINE7B_FINAL_SIZING",
    laneId:"minute",strategyId:"intraday_scalp@10m",
    candidateId,planId,zoneId,symbol:"ES",direction:"LONG",
    setupType:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupClass:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade:"A+++",identitySetupKey:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion:"engine26.strategy1.v1",
    productionRiskSupportedContracts:1,finalProductionContracts:1,
    finalPaperTestingContracts:3,effectiveOrderedQuantity:3,
    finalContracts:3,finalSizingMode:"PAPER_TESTING_DATA_COLLECTION",
    testingRiskOverrideApplied:true,testingThreeContractPlanQualified:true,
    allocationQualificationSource:"ENGINE7A_TESTING_DATA_COLLECTION",
    finalThreeContractAllocation:{
      block1Contracts:1,block2Contracts:1,block3Contracts:1,totalContracts:3
    },
    officialTargets,threeBlockManagement,runnerPlan:{enabled:false},
    paperOnly:true,realExecutionAllowed:false,brokerExecutionAllowed:false,
    schwabExecutionAllowed:false,liveTradingAllowed:false,
  };
  const engine9={
    planId,planStatus:"OFFICIAL_PLAN_READY",managementReady:true,
    officialEntryPrice:7680,officialStopPrice:7677,officialStopDistancePoints:3,
    officialTargets,threeBlockManagement,runnerPlan:{enabled:false}
  };
  const engine7={
    planId,status:"FINAL_SIZE_READY",allowed:true,executableSizing:true,
    paperOrderSizingReady:true,finalContracts:3,
    officialEntryPrice:7680,officialStopPrice:7677,officialStopDistancePoints:3,
    finalProductionContracts:1,finalPaperTestingContracts:3,
    finalThreeContractAllocation:provenance.finalThreeContractAllocation,
    riskBudgetDollars:150,permissionAdjustedRiskBudget:150,dollarsPerPoint:50,
    rawRiskPerContract:150,estimatedSlippageRiskPerContract:0,
    commissionDollarsPerContractRoundTrip:0,effectiveRiskPerContract:150,
    estimatedTotalRiskDollars:450,
  };
  return {
    status:"READY_TO_CREATE_PAPER_ORDER",executable:true,paperOnly:true,
    realExecutionAllowed:false,brokerExecutionAllowed:false,schwabExecutionAllowed:false,
    candidateId,planId,zoneId,laneId:"minute",strategyId:"intraday_scalp@10m",
    symbol:"ES",direction:"LONG",
    setupType:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupClass:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade:"A+++",identitySetupKey:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion:"engine26.strategy1.v1",snapshotTime,
    finalContracts:3,officialEntryPrice:7680,officialStopPrice:7677,
    officialStopDistancePoints:3,officialTargets,threeBlockManagement,
    runnerPlan:{enabled:false},strategy1Provenance:provenance,
    engine6:{allowed:true,decision:"FAST_INTRADAY_PAPER_ALLOW"},
    engine7PositionSizing:engine7,engine9OfficialManagementPlan:engine9,
  };
}

async function runBridge(env) {
  const child=spawn(process.execPath,[bridgeFile],{
    cwd:repoRoot,env:{...process.env,...env},stdio:["ignore","pipe","pipe"],
  });
  let out="",err="";
  child.stdout.on("data",x=>out+=x.toString());
  child.stderr.on("data",x=>err+=x.toString());
  const code=await new Promise((resolve,reject)=>{
    child.once("error",reject);child.once("close",resolve);
  });
  let payload=null;
  try {payload=JSON.parse(out.trim());}
  catch {throw new Error("BRIDGE_RESULT_NOT_JSON code="+code+" stdout="+out.slice(0,1800)+" stderr="+err.slice(0,1200));}
  return {code,payload,stderr:err};
}

test("P0: real protected HTTP bridge, Engine8 persisted fill, Engine10 OPEN/close, old A blocked, new B eligible",{
  skip:process.env.CI!=="true",
  timeout:90000,
},async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"engine8c-http-"));
  const backup=new Map();
  let server=null;
  const savedEnv={};
  const flags={
    NODE_ENV:"test",
    ENGINE8_PAPER_DATA_DIR:path.join(tmp,"paper"),
    TRADE_JOURNAL_DIR:path.join(tmp,"journal"),
    ENGINE8_ADMIN_SECRET:"CI-ONLY-FAKE-ENGINE8-ADMIN",
    ENGINE8_AUTO_PAPER_EXECUTION_ENABLED:"1",
    ENGINE8_CANONICAL_EXECUTOR_ENABLED:"1",
    ENGINE8_PAPER_ONLY:"1",
    ENGINE8_KILL_SWITCH:"0",
    ENGINE8_LIVE_TRADING_ENABLED:"0",
    ENGINE8_ALLOW_LIVE_FUTURES:"0",
    ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED:"1",
    ENGINE8_PAPER_OPERATOR_DISABLED:"0",
    REPLAY_MODE:"0",
    ENGINE12_REPLAY_MODE:"0",
  };
  try{
    assert.equal(process.env.CI,"true");
    for(const [k,v] of Object.entries(flags)){savedEnv[k]=process.env[k];process.env[k]=v;}
    for(const file of legacyFiles)backup.set(file,fs.existsSync(file)?fs.readFileSync(file):null);
    fs.mkdirSync(coreData,{recursive:true});
    fs.mkdirSync(flags.ENGINE8_PAPER_DATA_DIR,{recursive:true});
    fs.mkdirSync(flags.TRADE_JOURNAL_DIR,{recursive:true});
    fs.writeFileSync(path.join(flags.ENGINE8_PAPER_DATA_DIR,"engine8-paper-acceptance-state.json"),
      JSON.stringify({version:"engine8.paperAcceptanceState.v1",
        acceptanceTradeCompleted:false,newPaperOrdersAllowed:true}));
    const writeSnapshot=(candidateId)=>fs.writeFileSync(snapshotFile,JSON.stringify({
      ok:true,strategies:{"intraday_scalp@10m":{engine8PaperOrder:fixture(candidateId)}}
    }));
    writeSnapshot("CAND-A");

    // Load HTTP route only AFTER fake/isolated environment is established.
    const express=(await import("express")).default;
    const tradingRouter=(await import("../routes/trading.js")).default;
    const journal=await import("../logic/journal/tradeJournalStore.js");
    const lifecycle=await import("../logic/trading/runEngine8PaperLifecycleExecution.js");
    const durable=await import("../logic/trading/engine8PaperDurableStore.js");
    const app=express();
    app.use(express.json());
    app.use("/api/trading",tradingRouter);
    server=await new Promise(resolve=>{
      const s=app.listen(0,"127.0.0.1",()=>resolve(s));
    });
    const base="http://127.0.0.1:"+server.address().port;
    const response=await fetch(base+"/api/trading/paper/execute-canonical",{
      method:"POST",headers:{"content-type":"application/json"},body:"{}",
    });
    assert.equal(response.status,401,"untrusted HTTP caller cannot execute");

    const a=await runBridge({...flags,CORE_BASE_URL:base});
    assert.equal(a.code,0,JSON.stringify(a.payload));
    assert.equal(a.payload.status,"AUTO_PAPER_EXECUTION_COMPLETED");
    assert.equal(a.payload.execution.orderCreated,true);
    assert.equal(a.payload.execution.fillCreated,true);
    assert.equal(a.payload.execution.journalCompleted,true,JSON.stringify(a.payload));
    assert.equal(a.payload.execution.journalPending,false);
    assert.equal(a.payload.execution.candidateId,"CAND-A");
    assert.equal(a.payload.execution.planId,"PLAN-CAND-A");
    const tradeId=a.payload.execution.tradeId;
    assert.ok(tradeId);
    const firstOrders=durable.readPaperStore("paper-orders.json",[]);
    const firstExecutions=durable.readPaperStore("paper-executions.json",[]);
    assert.equal(firstOrders.length,1);
    assert.equal(firstExecutions.length,1);
    assert.equal(firstOrders[0].sourceSignal.candidateId,"CAND-A");
    assert.equal(firstOrders[0].qty,3);
    const opened=await journal.getTradeById(tradeId);
    assert.equal(opened.status,"OPEN");
    assert.equal(opened.qty.originalQty,3);
    assert.equal(opened.qty.remainingQty,3);

    const duplicate=await runBridge({...flags,CORE_BASE_URL:base});
    assert.notEqual(duplicate.code,0);
    assert.equal(durable.readPaperStore("paper-orders.json",[]).length,1);

    // A different candidate cannot open while A's authoritative Engine10
    // PAPER Journal still reports an OPEN position.
    writeSnapshot("CAND-B");
    const activeConflict=await runBridge({...flags,CORE_BASE_URL:base});
    assert.notEqual(activeConflict.code,0);
    assert.equal(durable.readPaperStore("paper-orders.json",[]).length,1);

    const common={
      tradeId,planId:"PLAN-CAND-A",candidateId:"CAND-A",zoneId:"ZONE-CAND-A",
      strategyId:"intraday_scalp@10m",symbol:"ES",direction:"LONG",
      setupType:"NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
      source:"CANONICAL_PAPER_LIFECYCLE_ROUTE",
    };
    const p1=await lifecycle.runEngine8PaperLifecycleExecution({
      ...common,action:"REDUCE",lifecycleEventId:"A-P1",
      fillQuantity:1,fillPrice:7700,remainingQuantity:2,
      targetId:"T1",blockId:"BLOCK_1",
      managementAction:"TAKE_TARGET_1",exitReason:"TARGET_EXIT",
    });
    assert.equal(p1.journalCompleted,true,JSON.stringify(p1));
    assert.equal(p1.remainingQty,2,JSON.stringify(p1));

    const p2=await lifecycle.runEngine8PaperLifecycleExecution({
      ...common,action:"REDUCE",lifecycleEventId:"A-P2",
      fillQuantity:1,fillPrice:7710,remainingQuantity:1,
      targetId:"T2",blockId:"BLOCK_2",
      managementAction:"TAKE_TARGET_2",exitReason:"TARGET_EXIT",
    });
    assert.equal(p2.journalCompleted,true,JSON.stringify(p2));
    assert.equal(p2.remainingQty,1,JSON.stringify(p2));

    const p3=await lifecycle.runEngine8PaperLifecycleExecution({
      ...common,action:"EXIT",lifecycleEventId:"A-P3",
      fillQuantity:1,fillPrice:7710,remainingQuantity:0,
      targetId:"T3",blockId:"BLOCK_3",
      managementAction:"TAKE_TARGET_3",exitReason:"FINAL_EXIT",
    });
    assert.equal(p3.journalCompleted,true,JSON.stringify(p3));
    assert.equal(p3.remainingQty,0,JSON.stringify(p3));
    assert.equal(p3.engine10Status,"CLOSED",JSON.stringify(p3));
    assert.equal((await journal.getTradeById(tradeId)).status,"CLOSED");
    const audit=durable.readPaperStore("engine8-paper-acceptance-state.json",{});
    assert.equal(audit.acceptanceTradeCompleted,true);
    assert.equal(audit.candidateId,"CAND-A");

    writeSnapshot("CAND-A");
    const repeatedClosed=await runBridge({...flags,CORE_BASE_URL:base});
    assert.notEqual(repeatedClosed.code,0);
    writeSnapshot("CAND-B");
    const b=await runBridge({...flags,CORE_BASE_URL:base});
    assert.equal(b.code,0,JSON.stringify(b.payload));
    assert.equal(b.payload.execution.journalCompleted,true);
    assert.equal(b.payload.execution.candidateId,"CAND-B");
    assert.notEqual(b.payload.execution.tradeId,tradeId);
    assert.equal(durable.readPaperStore("paper-orders.json",[]).length,5,
      "A entry/3 exits then B entry must persist unique orders");
    console.log("P0_HTTP_ACCEPTANCE",JSON.stringify({
      a:{candidateId:"CAND-A",orderId:a.payload.execution.orderId,
        executionId:a.payload.execution.executionId,tradeId,
        originalQty:3,afterP1:p1.remainingQty,afterP2:p2.remainingQty,final:p3.remainingQty},
      b:{candidateId:"CAND-B",orderId:b.payload.execution.orderId,
        executionId:b.payload.execution.executionId,tradeId:b.payload.execution.tradeId},
      duplicateDenied:duplicate.code!==0,
      openPositionDenied:activeConflict.code!==0,
      closedCandidateDenied:repeatedClosed.code!==0,
      realBrokerCalls:0,
    }));
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    for(const [file,contents] of backup){
      if(contents===null){if(fs.existsSync(file))fs.rmSync(file,{force:true});}
      else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);}
    }
    for(const [k,v] of Object.entries(savedEnv)){
      if(v===undefined)delete process.env[k];else process.env[k]=v;
    }
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
