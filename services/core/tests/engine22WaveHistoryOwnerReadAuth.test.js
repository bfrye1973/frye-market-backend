import test from "node:test";
import assert from "node:assert/strict";
import {authorizedOwnerNodeRead,nodeHistoryPreflight} from "../logic/engine22/history/nodeHistoryOwnerAccessV1.js";

const KEY="this-is-a-test-owner-key-32-characters-long";
const settings={ENGINE2C_HISTORY_ENABLED:"true",ENGINE2C_HISTORY_LICENSED:"true",
  ENGINE2C_HISTORY_OWNER_KEY:KEY};
const req=(method,path,origin="https://frye-dashboard.onrender.com",provided=KEY)=>({
  method,path,get:k=>{
    const h={"origin":origin,"x-engine2c-access":provided};
    return h[String(k).toLowerCase()];
  },
});
test("only owner-licensed read of node pages, never full journal or workbook",()=>{
 for(const path of ["/nodes","/nodes/current"]){
  assert.equal(authorizedOwnerNodeRead(req("GET",path),settings),true);
  assert.equal(authorizedOwnerNodeRead(req("POST",path),settings),false);
  assert.equal(authorizedOwnerNodeRead(req("GET",path,"https://attacker.example"),settings),false);
  assert.equal(authorizedOwnerNodeRead(req("GET",path,undefined,"wrong"),settings),false);
 }
 for(const path of ["/","/workbook","/nodes/delete","/nodes/current/export"]){
  assert.equal(authorizedOwnerNodeRead(req("GET",path),settings),false);
 }
 assert.equal(authorizedOwnerNodeRead(req("GET","/nodes"),{
  ...settings,ENGINE2C_HISTORY_ENABLED:"false"}),false);
 assert.equal(authorizedOwnerNodeRead(req("GET","/nodes"),{
  ...settings,ENGINE2C_HISTORY_LICENSED:"false"}),false);
});

test("node preflight allows exactly production dashboard origin, not credentialed public CORS",()=>{
 const makeRes=()=>({
  headers:new Map(),code:0,
  set(k,v){this.headers.set(k.toLowerCase(),v);return this},
  removeHeader(k){this.headers.delete(k.toLowerCase())},
  status(code){this.code=code;return this},
  end(){return this},
 });
 const allowed=makeRes();
 nodeHistoryPreflight(req("OPTIONS","/nodes"),allowed);
 assert.equal(allowed.code,204);
 assert.equal(allowed.headers.get("access-control-allow-origin"),
   "https://frye-dashboard.onrender.com");
 assert.equal(allowed.headers.get("access-control-allow-headers"),
   "Accept, X-Engine2C-Access");
 assert.equal(allowed.headers.has("access-control-allow-credentials"),false);
 const denied=makeRes();
 denied.headers.set("access-control-allow-origin","*");
 nodeHistoryPreflight(req("OPTIONS","/nodes","https://not-owner.example"),denied);
 assert.equal(denied.code,204);
 assert.equal(denied.headers.has("access-control-allow-origin"),false);
 assert.equal(denied.headers.has("access-control-allow-credentials"),false);
});
