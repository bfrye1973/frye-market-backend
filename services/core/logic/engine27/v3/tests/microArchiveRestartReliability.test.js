import test from "node:test";
import assert from "node:assert/strict";
import {createMicroAlignmentArchiveClient} from "../../../../../streamer/shadow/createMicroAlignmentArchiveClient.js";

const url="https://frye-market-backend-1.onrender.com/api/v1/engine27/micro-alignment/history";
const closedAt="2026-10-26T16:25:00.000Z";
const event={schema:"engine27.v3.microFiveMinuteAlignmentEvent.v1",id:"MICRO-"+closedAt,closedAt};

function durableFixture(){
 const disk=new Map();
 let failPosts=false;
 const fetcher=async (_url,options)=>{
  if(options.method==="POST"){
   if(failPosts)return {ok:false,status:503};
   const body=JSON.parse(options.body);
   if(disk.has(body.id))return {ok:true,json:async()=>({ok:true,stored:false,duplicate:true})};
   disk.set(body.id,body);
   return {ok:true,json:async()=>({ok:true,stored:true})};
  }
  return {ok:true,json:async()=>({ok:true,persistence:"BACKEND1_RENDER_DISK",events:[...disk.values()]})};
 };
 return {disk,fetcher,setFailure:x=>{failPosts=x}};
}
const client=fetcher=>createMicroAlignmentArchiveClient({url,token:"TEST_ONLY",fetcher});
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test("a new Micro client retrieves already acknowledged events after restart",async()=>{
 const backend=durableFixture();
 const first=client(backend.fetcher);
 assert.equal(first.enqueue(event),true);
 await settled();
 assert.equal(first.status().queued,0);
 assert.equal(backend.disk.size,1);
 const restarted=client(backend.fetcher);
 assert.equal((await restarted.refresh()).ok,true);
 assert.deepEqual(restarted.status().events.map(x=>x.id),[event.id]);
 assert.equal(restarted.status().persistenceVerified,true);
});

test("retrying an already stored event is idempotent at the durable endpoint",async()=>{
 const backend=durableFixture();
 const first=client(backend.fetcher);
 first.enqueue(event);
 await settled();
 const replay=client(backend.fetcher);
 replay.enqueue(event);
 await settled();
 assert.equal(replay.status().queued,0);
 assert.equal(backend.disk.size,1);
});

test("interrupted delivery gap: an unacknowledged in-memory queue is NOT restart durable",async()=>{
 const backend=durableFixture();
 backend.setFailure(true);
 const first=client(backend.fetcher);
 first.enqueue(event);
 await settled();
 assert.equal(first.status().queued,1);
 assert.equal(backend.disk.size,0);
 const restarted=client(backend.fetcher);
 backend.setFailure(false);
 await restarted.refresh();
 assert.equal(restarted.status().queued,0);
 assert.equal(restarted.status().events.length,0);
 // This documents a real remaining risk; do not mark end-to-end recovery accepted.
});
