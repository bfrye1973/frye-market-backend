import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import router from "../routes/engine2ChartOverlays.js";

const root=path.dirname(fileURLToPath(import.meta.url));
const file=path.resolve(root,"../data/strategy-snapshot-es.json");
const fixture=(price)=>({
  symbol:"ES",
  strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{
    degreeStates:{primary:{activeWave:"W5",activeFibModel:{active:true,levels:{e1618:price}}}},
    currentWavelength:{degrees:{micro:{activeWave:"W1",levels:[{key:"e382",price:7790.25}]}}}
  }}}
});
test("Engine2B route caches immutable snapshots, supports ETag, and never serves stale data on publication error",async()=>{
  assert.equal(fs.existsSync(file),false,"CI fixture must never overwrite a real published snapshot");
  const app=express();app.use("/api/v1",router);
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const url="http://127.0.0.1:"+server.address().port+"/api/v1/engine2/chart-overlays/v1?symbol=ES";
  try{
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,JSON.stringify(fixture(7800)));
    let response=await fetch(url);
    assert.equal(response.status,200);
    assert.equal(response.headers.get("x-engine2b-cache"),"MISS");
    const etag=response.headers.get("etag");
    const body=await response.json();
    assert.equal(body.degrees.primary.lines[0].price,7800);
    response=await fetch(url,{headers:{"If-None-Match":etag}});
    assert.equal(response.status,304);
    assert.equal(response.headers.get("x-engine2b-cache"),"HIT");
    const tmp=file+".fixture-tmp";
    fs.writeFileSync(tmp,JSON.stringify(fixture(7810)));
    fs.renameSync(tmp,file);
    response=await fetch(url,{headers:{"If-None-Match":etag}});
    assert.equal(response.status,200);
    assert.equal(response.headers.get("x-engine2b-cache"),"MISS");
    assert.equal((await response.json()).degrees.primary.lines[0].price,7810);
    fs.writeFileSync(tmp,"{ invalid json");
    fs.renameSync(tmp,file);
    response=await fetch(url);
    assert.equal(response.status,503);
    assert.equal((await response.json()).ok,false);
  }finally{
    fs.rmSync(file,{force:true});
    fs.rmSync(file+".fixture-tmp",{force:true});
    await new Promise(ok=>server.close(ok));
  }
});
