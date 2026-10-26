import test from "node:test";import assert from "node:assert/strict";
import {createMicroAlignmentArchiveClient} from "../../../../../streamer/shadow/createMicroAlignmentArchiveClient.js";
const url="https://frye-market-backend-1.onrender.com/api/v1/engine27/micro-alignment/history";
const evt={schema:"engine27.v3.microFiveMinuteAlignmentEvent.v1",id:"MICRO-2026-10-26T16:00:00.000Z"};
test("archive client fetches durable history without exposing token",async()=>{
 const calls=[];
 const c=createMicroAlignmentArchiveClient({url,token:"SECRET_TEST_ONLY",fetcher:async (u,options)=>{
  calls.push({u,auth:options.headers.Authorization});
  return {ok:true,json:async()=>({ok:true,persistence:"BACKEND1_RENDER_DISK",events:[{id:"ONE"}]})}
 }});
 assert.equal((await c.refresh()).ok,true);
 assert.equal(c.status().state,"DURABLE");
 assert.equal(c.status().events[0].id,"ONE");
 assert.ok(calls[0].auth.startsWith("Bearer "));
 assert.ok(!calls[0].u.includes("SECRET_TEST_ONLY"));
});
test("failed writes retain queued event; good acknowledgement dequeues",async()=>{
 let succeed=false;
 const c=createMicroAlignmentArchiveClient({url,token:"TEST",fetcher:async (_url,opts)=>{
  if(opts.method==="POST"){
   if(!succeed)return {ok:false,status:503};
   return {ok:true,json:async()=>({ok:true,stored:true})};
  }
  return {ok:true,json:async()=>({ok:true,persistence:"BACKEND1_RENDER_DISK",events:[]})};
 }});
 assert.equal(c.enqueue(evt),true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(c.status().queued,1);
 succeed=true;
 await c.flush();
 assert.equal(c.status().queued,0);
});
test("refuses untrusted archive origins and never posts",()=>{
 let count=0;
 const c=createMicroAlignmentArchiveClient({url:"https://malicious.example/steal",token:"TEST",fetcher:async()=>{count++}});
 assert.equal(c.enqueue(evt),false);
 assert.equal(count,0);
});
