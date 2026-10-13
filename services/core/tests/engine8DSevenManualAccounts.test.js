import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"manual-seven-"));
process.env.ENGINE8_PAPER_DATA_DIR=root;
const registry=await import("../logic/trading/manualPaperAccountRegistry.js");
const store=await import("../logic/trading/manualPaperAccountStore.js");
test("exactly seven permanent IDs, unique degrees and $70K total",()=>{
  assert.equal(registry.MANUAL_PAPER_DEGREES.length,7);
  assert.equal(new Set(registry.MANUAL_PAPER_DEGREES.map(x=>x.accountId)).size,7);
  assert.equal(new Set(registry.MANUAL_PAPER_DEGREES.map(x=>x.strategyDegreeId)).size,7);
  assert.equal(registry.MANUAL_PAPER_DEGREES.reduce((s,x)=>s+x.startingCapital,0),70000);
  assert.equal(registry.MANUAL_PAPER_DEGREES[0].strategyDegreeId,"INTRADAY_SUBMICRO");
  assert.notEqual(registry.MANUAL_PAPER_DEGREES[0].accountId,registry.MANUAL_PAPER_DEGREES[1].accountId);
});
test("GET before initialization never creates records",()=>{
  assert.equal(store.getManualPaperAccounts().initialized,false);
  assert.equal(fs.existsSync(path.join(root,"manual-paper-accounts-v1.json")),false);
});
test("explicit init creates seven empty PAPER accounts once; repeated init preserves exact balances",async()=>{
  const first=await store.initializeManualPaperAccounts();
  assert.equal(first.created,true);
  const second=await store.initializeManualPaperAccounts();
  assert.equal(second.alreadyInitialized,true);
  assert.equal(second.created,false);
  assert.deepEqual(second.accounts,first.accounts);
  for(const a of first.accounts){
    assert.equal(a.startingCapital,10000);
    assert.equal(a.cashBalance,10000);
    assert.equal(a.equity,10000);
    assert.equal(a.realizedPnL,0);
    assert.equal(a.unrealizedPnL,0);
    assert.equal(a.openContracts,0);
    assert.equal(a.openTrades,0);
    assert.equal(a.accountMode,"PAPER");
    assert.deepEqual(a.positions,{});
  }
});
test("records survive a separate Node process",()=>{
  const uri=new URL("../logic/trading/manualPaperAccountStore.js",import.meta.url).href;
  const r=spawnSync(process.execPath,["--input-type=module","-e",
    `const v=await import(${JSON.stringify(uri)});console.log(JSON.stringify(v.getManualPaperAccounts()))`],
    {encoding:"utf8",env:{...process.env}});
  assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout.trim()).accounts.length,7);
});
test("corrupt active file fails closed, never resets balances",async()=>{
  const file=path.join(root,"manual-paper-accounts-v1.json");
  const original=fs.readFileSync(file);
  fs.writeFileSync(file,"{bad json");
  try{
    assert.throws(()=>store.getManualPaperAccounts(),SyntaxError);
    await assert.rejects(store.initializeManualPaperAccounts(),SyntaxError);
    assert.equal(fs.readFileSync(file,"utf8"),"{bad json");
  }finally{fs.writeFileSync(file,original);}
});
test("ES and MES validation, tick/expiration/multiplier",()=>{
  const es=registry.validateFuturesContract("ESZ26",7850,1);
  const mes=registry.validateFuturesContract("MESZ26",7850.25,2);
  assert.equal(es.multiplier,50);
  assert.equal(mes.multiplier,5);
  assert.equal(es.tickValue,12.5);
  assert.equal(mes.tickValue,1.25);
  assert.equal(registry.validateFuturesContract("ESZ26",7850.1,1).ok,false);
  assert.equal(registry.validateFuturesContract("ES",7850,1).ok,false);
  assert.equal(registry.validateFuturesContract("ESZ26",7850,1.5).ok,false);
});
process.on("exit",()=>fs.rmSync(root,{recursive:true,force:true}));
