import test from "node:test";
import assert from "node:assert/strict";
import {probeIronbeamV2Demo} from "../logic/engine18/ironbeamV2DemoProbe.js";
test("v2 demo probe uses only documented demo auth and read-only market requests",async()=>{
 const calls=[];
 const fake=async(url,opt)=>{
  calls.push({url,method:opt.method});
  return {ok:true,status:200,json:async()=>url.endsWith("/v2/auth")
    ?{status:"OK",token:"SENSITIVE_TEST_TOKEN"}
    :{status:"OK",Quotes:[{s:"XCME:ES.Z26"}],Depths:[{s:"XCME:ES.Z26"}]}};
 };
 const r=await probeIronbeamV2Demo({username:"TEST_USERNAME",password:"TEST_PASSWORD",
  apikey:"TEST_KEY",fetchImpl:fake});
 assert.equal(r.connected,true);
 assert.equal(r.liveEntitlementConfirmed,false);
 assert.equal(r.mboConfirmed,false);
 assert.deepEqual(calls.map(x=>x.method),["POST","GET","GET"]);
 assert.ok(calls.every(x=>x.url.startsWith("https://demo.ironbeamapi.com/v2/")));
 assert.equal(JSON.stringify(r).includes("SENSITIVE_TEST_TOKEN"),false);
 assert.equal(JSON.stringify(r).includes("TEST_PASSWORD"),false);
});
test("v2 probe does not call market-data endpoints on failed login",async()=>{
 const calls=[];
 const fake=async(url,opt)=>{calls.push(url);return {ok:false,status:401,json:async()=>({status:"ERROR",message:"password invalid"})}};
 const r=await probeIronbeamV2Demo({username:"a",password:"b",apikey:"c",fetchImpl:fake});
 assert.equal(r.connected,false);assert.equal(r.phase,"AUTHENTICATION");
 assert.equal(calls.length,1);
 assert.equal(JSON.stringify(r).includes("password invalid"),false);
});
test("v2 probe will not target production host",async()=>{
 await assert.rejects(()=>probeIronbeamV2Demo({baseUrl:"https://live.ironbeamapi.com",
 username:"a",password:"b",apikey:"c"}),/HOST_NOT_ALLOWED/);
});
