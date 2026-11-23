import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {runEngine29OneShotReceiptAudit} from "../logic/engine29/runOneShotReceiptAudit.js";

const NAME="2026-11-23T19-09-38-931Z-d874bda5-7e9a-4617-bac3-4b21bd8282f5.json";
const SHA="a".repeat(64);
function setup() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"e29-one-shot-"));
  const context={schema:"engine29.downstreamContext.v1",timestamp:"2026-11-23T19:09:13.393Z"};
  fs.writeFileSync(path.join(root,NAME),JSON.stringify(context)+"\n");
  return {root,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("disabled audit does not perform any filesystem or network work",async()=>{
 const result=await runEngine29OneShotReceiptAudit({enabled:false,
   fetchFn:()=>{throw Error("CALLED");}});
 assert.equal(result.status,"DISABLED");
});
test("fails closed without backend-local authenticated token",async()=>{
 const log=[];
 const result=await runEngine29OneShotReceiptAudit({enabled:true,token:"",
   log:(...args)=>log.push(args.join(" "))});
 assert.equal(result.status,"BLOCKED");
 assert.equal(result.reason,"AUTH_NOT_CONFIGURED");
 assert.ok(!log.join(" ").includes("ENGINE_CRON_TOKEN="));
});
test("selects matching persisted receipt and calls protected verifier with header only",async()=>{
 const x=setup();try{
  const secret="DO_NOT_ECHO_THIS_BACKEND_SECRET";
  const log=[];
  const result=await runEngine29OneShotReceiptAudit({
   enabled:true,token:secret,receiptDir:x.root,port:10000,
   log:(...args)=>log.push(args.join(" ")),
   fetchFn:async(url,options)=>{
    const parsed=new URL(url);
    assert.equal(parsed.hostname,"127.0.0.1");
    assert.equal(parsed.pathname,"/api/v1/engine29/receipt-verify");
    assert.equal(parsed.searchParams.get("filename"),NAME);
    assert.equal(parsed.searchParams.get("replayTime"),"1209");
    assert.equal(parsed.searchParams.has("token"),false);
    assert.equal(options.headers["X-ENGINE-CRON-TOKEN"],secret);
    return {status:200,json:async()=>({
      schema:"engine29.downstreamContext.v1",verified:true,exactMatch:true,
      reason:"VERIFIED",receiptTimestamp:"2026-11-23T19:09:13.393Z",
      receiptFileSha256:SHA,receiptContextSha256:SHA,replayContextSha256:SHA,
      byteCount:91,
      replaySnapshot:{date:"2026-11-23",time:"1209",timestamp:"2026-11-23T19:09:39.820Z"}
    })};
   }
  });
  assert.equal(result.status,"PASS");
  assert.equal(result.verified,true);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!log.join(" ").includes(secret));
  assert.ok(!log.join(" ").includes(x.root));
 }finally{x.cleanup();}
});
test("hash mismatch fails closed and cannot claim production acceptance",async()=>{
 const x=setup();try{
  const report=await runEngine29OneShotReceiptAudit({
   enabled:true,token:"secret",receiptDir:x.root,log:()=>{},
   fetchFn:async()=>({status:409,json:async()=>({
     schema:"engine29.downstreamContext.v1",verified:false,exactMatch:false,
     reason:"CONTEXT_MISMATCH",receiptTimestamp:"2026-11-23T19:09:13.393Z",
     receiptFileSha256:SHA,receiptContextSha256:SHA,replayContextSha256:"b".repeat(64),
     replaySnapshot:{timestamp:"2026-11-23T19:09:39.820Z"}
   })})
  });
  assert.equal(report.status,"FAIL");
  assert.equal(report.verified,false);
 }finally{x.cleanup();}
});
test("unmatched receipt reports bounded status without raw file information",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e29-one-shot-empty-"));try{
  const report=await runEngine29OneShotReceiptAudit({
   enabled:true,token:"secret",receiptDir:root,log:()=>{},
   fetchFn:()=>{throw Error("MUST_NOT_RUN");}
  });
  assert.equal(report.status,"BLOCKED");
  assert.equal(report.reason,"MATCHING_DISK_RECEIPT_NOT_FOUND");
  assert.ok(!JSON.stringify(report).includes(root));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
