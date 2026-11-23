import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  authenticateEngine29Verifier, verifyEngine29Receipt,
} from "../logic/engine29/verifyImmutableReceipt.js";

const DATE="2026-11-23", TIME="1209";
const NAME="2026-11-23T19-09-40-123Z-d874bda5-7e9a-4617-bac3-4b21bd8282f5.json";
const SCHEMA="engine29.downstreamContext.v1";
const digest = x => crypto.createHash("sha256").update(x).digest("hex");
function setup(options={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e29-receipt-proof-"));
 const receiptRoot=path.join(dir,"engine29");
 const esRoot=path.join(dir,"es");
 fs.mkdirSync(path.join(receiptRoot,DATE),{recursive:true});
 fs.mkdirSync(path.join(esRoot,DATE),{recursive:true});
 const context={schema:SCHEMA,timestamp:"2026-11-23T19:09:13.393Z",
  authority:"OBSERVATION_ONLY_NO_PERMISSION_OR_EXECUTION",
  secretCanary:"CONFIDENTIAL_MARKET_DATA_DO_NOT_RETURN",
  lanes:{parentMove:{state:"NO_ACTIVE_MOVE"},
   trap:{eligibleForEngine4:false, freshness:{freshnessBlockedBy:[]}}}};
 const snapshot={snapshotTime:"2026-11-23T19:09:39.820Z",
  engine29DownstreamContext:structuredClone(context)};
 const receiptPath=path.join(receiptRoot,DATE,NAME);
 const replayPath=path.join(esRoot,DATE,TIME+".json");
 fs.writeFileSync(receiptPath,JSON.stringify(context)+"\n");
 fs.writeFileSync(replayPath,JSON.stringify(snapshot)+"\n");
 return {dir,receiptRoot,esRoot,context,snapshot,receiptPath,replayPath,
  input:{date:DATE,filename:NAME,replayDate:DATE,replayTime:TIME,receiptRoot,esRoot},
  cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test("receipt verified via independent file reread, raw byte hash and canonical archived identity",()=>{
 const x=setup();try{
  const v=verifyEngine29Receipt(x.input);
  assert.equal(v.status,200);
  assert.equal(v.body.verified,true);
  assert.equal(v.body.exists,true);
  assert.equal(v.body.exactMatch,true);
  assert.equal(v.body.schema,SCHEMA);
  assert.equal(v.body.receiptTimestamp,x.context.timestamp);
  assert.equal(v.body.byteCount,fs.statSync(x.receiptPath).size);
  assert.equal(v.body.receiptFileSha256,digest(fs.readFileSync(x.receiptPath)));
  assert.equal(v.body.receiptContextSha256,v.body.replayContextSha256);
  assert.equal(v.body.replaySnapshot.time,TIME);
  assert.equal(v.body.reason,"VERIFIED");
  const response=JSON.stringify(v.body);
  assert.ok(!response.includes("CONFIDENTIAL_MARKET_DATA_DO_NOT_RETURN"));
  assert.ok(!response.includes("secretCanary"));
  assert.ok(!response.includes(x.receiptRoot));
  assert.ok(!response.includes(x.receiptPath));
 }finally{x.cleanup();}
});
test("missing receipt returns bounded NOT_FOUND",()=>{
 const x=setup();try{
  fs.unlinkSync(x.receiptPath);
  const v=verifyEngine29Receipt(x.input);
  assert.equal(v.status,404);assert.equal(v.body.reason,"NOT_FOUND");
  assert.equal(v.body.verified,false);
 }finally{x.cleanup();}
});
test("wrong schema fails closed",()=>{
 const x=setup();try{
  fs.writeFileSync(x.receiptPath,JSON.stringify({...x.context,schema:"unknown"}));
  assert.equal(verifyEngine29Receipt(x.input).body.reason,"INVALID_RECEIPT_SCHEMA");
 }finally{x.cleanup();}
});
for(const filename of [
  "../"+NAME, "%2e%2e%2f"+NAME, "/tmp/"+NAME,
  "C:\\root\\"+NAME, NAME+"/../"+NAME, "other.json", NAME.replace(".json",".txt"),
]) {
 test("rejects malformed, traversal or absolute filename: "+filename,()=>{
  const x=setup();try{
   const v=verifyEngine29Receipt({...x.input,filename});
   assert.equal(v.status,400);assert.equal(v.body.reason,"INVALID_IDENTIFIER");
  }finally{x.cleanup();}
 });
}
test("invalid date, calendar rollover, replay time and cross-day filename rejected",()=>{
 const x=setup();try{
  for(const p of [
   {date:"2026-11-23/../2026-11-23"},{date:"2026-11-31"},
   {replayDate:"2026-11-31"},{replayTime:"2460"},
   {replayTime:"../12"},{filename:NAME.replace("2026-11-23","2026-11-22")},
   {filename:["x"]},
  ]) assert.equal(verifyEngine29Receipt({...x.input,...p}).status,400);
 }finally{x.cleanup();}
});
test("rejects symlink receipt and symlink date directory",()=>{
 const x=setup();try{
  fs.unlinkSync(x.receiptPath);
  fs.symlinkSync(x.replayPath,x.receiptPath);
  assert.equal(verifyEngine29Receipt(x.input).body.reason,"UNSAFE_FILE");
  fs.unlinkSync(x.receiptPath);
  fs.rmSync(path.join(x.receiptRoot,DATE),{recursive:true});
  fs.symlinkSync(path.join(x.esRoot,DATE),path.join(x.receiptRoot,DATE),"dir");
  assert.equal(verifyEngine29Receipt(x.input).body.reason,"UNSAFE_FILE");
 }finally{x.cleanup();}
});
test("rejects non-regular receipt file and symlink Replay",()=>{
 const x=setup();try{
  fs.unlinkSync(x.receiptPath);fs.mkdirSync(x.receiptPath);
  assert.equal(verifyEngine29Receipt(x.input).body.reason,"UNSAFE_FILE");
  fs.rmdirSync(x.receiptPath);
  fs.writeFileSync(x.receiptPath,JSON.stringify(x.context));
  fs.unlinkSync(x.replayPath);fs.symlinkSync(x.receiptPath,x.replayPath);
  assert.equal(verifyEngine29Receipt(x.input).body.reason,"UNSAFE_FILE");
 }finally{x.cleanup();}
});
test("wrong or missing configuration and header-only auth fail closed",()=>{
 const secret="PRIVATE_TOKEN_123456";
 assert.deepEqual(authenticateEngine29Verifier(secret,undefined),
  {ok:false,status:503,reason:"VERIFY_AUTH_NOT_CONFIGURED"});
 assert.equal(authenticateEngine29Verifier(secret,"  ").status,503);
 assert.equal(authenticateEngine29Verifier("wrong",secret).status,401);
 assert.equal(authenticateEngine29Verifier(undefined,secret).status,401);
 assert.equal(authenticateEngine29Verifier(null,secret).status,401);
 assert.equal(authenticateEngine29Verifier("PRIVATE_TOKEN_123456",secret).ok,true);
 assert.ok(!JSON.stringify(authenticateEngine29Verifier("wrong",secret)).includes(secret));
});
test("modified receipt is not accepted as matching Replay",()=>{
 const x=setup();try{
  fs.writeFileSync(x.receiptPath,JSON.stringify({...x.context,lanes:{parentMove:{state:"DOWNSIDE_MOVE_ACTIVE"}}}));
  const v=verifyEngine29Receipt(x.input);
  assert.equal(v.status,409);assert.equal(v.body.reason,"CONTEXT_MISMATCH");
  assert.equal(v.body.exactMatch,false);
  assert.notEqual(v.body.receiptContextSha256,v.body.replayContextSha256);
 }finally{x.cleanup();}
});
test("future receipt observation versus earlier ES Replay fails anti-lookahead",()=>{
 const x=setup();try{
  fs.writeFileSync(x.receiptPath,JSON.stringify({...x.context,timestamp:"2026-11-23T19:10:00.000Z"}));
  const v=verifyEngine29Receipt(x.input);
  assert.equal(v.status,409);assert.equal(v.body.reason,"LOOKAHEAD_DETECTED");
 }finally{x.cleanup();}
});
test("future archived observation versus earlier snapshot fails anti-lookahead",()=>{
 const x=setup();try{
  fs.writeFileSync(x.replayPath,JSON.stringify({...x.snapshot,
   engine29DownstreamContext:{...x.context,timestamp:"2026-11-23T19:10:00.000Z"}}));
  assert.equal(verifyEngine29Receipt(x.input).body.reason,"LOOKAHEAD_DETECTED");
 }finally{x.cleanup();}
});
test("missing or invalid archived context fails closed with no secrets",()=>{
 const x=setup();try{
  fs.writeFileSync(x.replayPath,JSON.stringify({...x.snapshot,engine29DownstreamContext:null}));
  const v=verifyEngine29Receipt(x.input);
  assert.equal(v.body.reason,"INVALID_REPLAY_CONTEXT");
  assert.ok(!JSON.stringify(v.body).includes("CONFIDENTIAL_MARKET_DATA_DO_NOT_RETURN"));
 }finally{x.cleanup();}
});

test("HTTP verifier requires configured header token; query token never authenticates",async()=>{
 const {default:express}=await import("express");
 const {default:route}=await import("../routes/engine29ReceiptVerify.js");
 const app=express();app.use("/api/v1",route);
 const server=await new Promise((resolve,reject)=>{
   const running=app.listen(0,"127.0.0.1",()=>resolve(running));
   running.on("error",reject);
 });
 const base="http://127.0.0.1:"+server.address().port+"/api/v1/engine29/receipt-verify";
 const prev=process.env.ENGINE_CRON_TOKEN;
 const secret="API_HEADER_SECRET_SHOULD_NEVER_BE_RETURNED";
 try{
  delete process.env.ENGINE_CRON_TOKEN;
  let r=await fetch(base+"?date="+DATE+"&filename="+encodeURIComponent(NAME));
  assert.equal(r.status,503);
  assert.equal((await r.json()).reason,"VERIFY_AUTH_NOT_CONFIGURED");

  process.env.ENGINE_CRON_TOKEN=secret;
  r=await fetch(base+"?token="+encodeURIComponent(secret));
  assert.equal(r.status,401);
  assert.equal((await r.json()).reason,"UNAUTHORIZED");
  r=await fetch(base,{headers:{"X-ENGINE-CRON-TOKEN":"invalid"}});
  assert.equal(r.status,401);
  const wrong=await r.text();
  assert.ok(!wrong.includes(secret));

  r=await fetch(base+"?filename=..%2Fetc%2Fpasswd&date="+DATE+
   "&replayDate="+DATE+"&replayTime="+TIME,{
   headers:{"X-ENGINE-CRON-TOKEN":secret}});
  assert.equal(r.status,400);
  const response=await r.text();
  assert.ok(response.includes("INVALID_IDENTIFIER"));
  assert.ok(!response.includes(secret));
  assert.ok(!response.includes("passwd"));
  assert.ok(!response.includes("/var/data"));
 }finally{
  if(prev===undefined)delete process.env.ENGINE_CRON_TOKEN;
  else process.env.ENGINE_CRON_TOKEN=prev;
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});

test("same recorded context with reordered JSON keys is still an exact match",()=>{
 const x=setup();try{
  const reversed=Object.fromEntries(Object.entries(x.context).reverse().map(([key,value]) =>
    [key,key==="lanes" ? Object.fromEntries(Object.entries(value).reverse()) : value]));
  fs.writeFileSync(x.replayPath,JSON.stringify({...x.snapshot,engine29DownstreamContext:reversed}));
  const v=verifyEngine29Receipt(x.input);
  assert.equal(v.status,200);
  assert.equal(v.body.exactMatch,true);
  assert.equal(v.body.receiptContextSha256,v.body.replayContextSha256);
 }finally{x.cleanup();}
});
test("invalid schema receipt still reports file existence without leaking contents",()=>{
 const x=setup();try{
  fs.writeFileSync(x.receiptPath,JSON.stringify({...x.context,schema:"unknown"}));
  const result=verifyEngine29Receipt(x.input);
  assert.equal(result.body.exists,true);
  assert.equal(result.body.verified,false);
  assert.ok(!JSON.stringify(result.body).includes("CONFIDENTIAL_MARKET_DATA_DO_NOT_RETURN"));
 }finally{x.cleanup();}
});

test("missing ES Replay preserves receipt exists=true and fails closed",()=>{
 const x=setup();try{
  fs.unlinkSync(x.replayPath);
  const v=verifyEngine29Receipt(x.input);
  assert.equal(v.status,404);
  assert.equal(v.body.exists,true);
  assert.equal(v.body.verified,false);
  assert.equal(v.body.reason,"REPLAY_NOT_FOUND");
 }finally{x.cleanup();}
});

test("production-sized ES Replay above 4 MiB is accepted below the 16 MiB Replay cap",()=>{
 const x=setup();try{
  const replay={...x.snapshot,nonEngine29Context:{padding:"a".repeat(5*1024*1024)}};
  fs.writeFileSync(x.replayPath,JSON.stringify(replay));
  assert.ok(fs.statSync(x.replayPath).size>4*1024*1024);
  const v=verifyEngine29Receipt(x.input);
  assert.equal(v.status,200);
  assert.equal(v.body.exactMatch,true);
 }finally{x.cleanup();}
});
test("oversized ES Replay and oversized receipt still fail bounded",()=>{
 const x=setup();try{
  fs.writeFileSync(x.replayPath,JSON.stringify({...x.snapshot,padding:"x".repeat(17*1024*1024)}));
  assert.equal(verifyEngine29Receipt(x.input).body.reason,"FILE_TOO_LARGE");
  fs.writeFileSync(x.replayPath,JSON.stringify(x.snapshot));
  fs.writeFileSync(x.receiptPath,JSON.stringify({...x.context,padding:"x".repeat(5*1024*1024)}));
  assert.equal(verifyEngine29Receipt(x.input).body.reason,"FILE_TOO_LARGE");
 }finally{x.cleanup();}
});
