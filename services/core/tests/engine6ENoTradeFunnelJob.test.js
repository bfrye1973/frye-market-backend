import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {readFunnelCycles} from "../logic/engine6/6e-funnel/funnelDiagnosticStore.js";
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
test("isolated record job is disabled by default and writes only when opt-in enabled",()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"engine6e-job-"));
  const snapshot=path.join(tmp,"snapshot.json");
  const dir=path.join(tmp,"diagnostics");
  fs.writeFileSync(snapshot,JSON.stringify({ok:true,symbol:"ES",generatedAt:"2026-11-11T22:00:00Z",strategies:{"intraday_scalp@10m":{}}}));
  const script=path.join(core,"jobs/recordEngine6ENoTradeFunnel.js");
  try{
    const env={...process.env,ENGINE6E_ES_SNAPSHOT_FILE:snapshot,ENGINE6E_FUNNEL_DIR:dir};
    delete env.ENGINE6E_FUNNEL_DIAGNOSTICS_ENABLED;
    const disabled=spawnSync(process.execPath,[script],{cwd:core,env,encoding:"utf8"});
    assert.equal(disabled.status,0,disabled.stderr);
    assert.equal(fs.existsSync(dir),false);
    const enabled=spawnSync(process.execPath,[script],{cwd:core,env:{...env,ENGINE6E_FUNNEL_DIAGNOSTICS_ENABLED:"1"},encoding:"utf8"});
    assert.equal(enabled.status,0,enabled.stderr);
    const records=readFunnelCycles("2026-11-11",{root:dir});
    assert.equal(records.length,1);
    assert.equal(records[0].firstFailedGate,"G1");
    assert.equal(fs.readdirSync(tmp).length,2);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
