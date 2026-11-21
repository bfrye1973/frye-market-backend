import test from "node:test";
import assert from "node:assert/strict";
import {startEngine18IronbeamLevel2Monitor} from "../logic/engine18/ironbeamV2Level2Monitor.js";
test("demo monitor refuses missing credentials and missing websocket transport",()=>{
 assert.throws(()=>startEngine18IronbeamLevel2Monitor({}),/CREDENTIALS_REQUIRED/);
 assert.throws(()=>startEngine18IronbeamLevel2Monitor({
  username:"unit-test",password:"unit-test",apikey:"unit-test",WebSocketImpl:null
 }),/WEBSOCKET_NOT_AVAILABLE/);
});
test("demo monitor exposes status without secrets or public order API methods",async()=>{
 const fetchImpl=async()=>({ok:false,status:401,json:async()=>({status:"ERROR"})});
 class FakeWebSocket {}
 const monitor=startEngine18IronbeamLevel2Monitor({
  username:"DEMO_USER_SECRET",password:"DEMO_PASS_SECRET",apikey:"DEMO_KEY_SECRET",
  fetchImpl,WebSocketImpl:FakeWebSocket,initialRetryMs:1000
 });
 const s=monitor.status();
 assert.equal(s.tradingEnabled,false);
 assert.equal(s.level3,false);
 assert.equal("placeOrder" in monitor,false);
 assert.equal(JSON.stringify(s).includes("DEMO_PASS_SECRET"),false);
 assert.equal(JSON.stringify(s).includes("DEMO_KEY_SECRET"),false);
 monitor.stop();
 assert.equal(monitor.status().state,"STOPPED");
});
