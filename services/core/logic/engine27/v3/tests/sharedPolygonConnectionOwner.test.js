import test from "node:test";import assert from "node:assert/strict";import {EventEmitter} from "node:events";
import {createPolygonConnectionOwner} from "../../../../../streamer/sharedMarketData/createPolygonConnectionOwner.js";
class FakeSocket extends EventEmitter{
 static all=[];
 constructor(url){super();this.url=url;this.sent=[];FakeSocket.all.push(this)}
 send(x){this.sent.push(JSON.parse(x))}
 close(){this.emit("close")}
 feed(message){this.emit("message",Buffer.from(JSON.stringify([message])))}
}
test("many viewers share one Stocks provider socket and dynamic QQQ/SPY topics",()=>{
 FakeSocket.all=[];
 const owner=createPolygonConnectionOwner({assetClass:"stocks",apiKey:"TEST",Socket:FakeSocket});
 const got=[];
 const a=owner.subscribe("T.QQQ",e=>got.push(e.event.p));
 const b=owner.subscribe("T.QQQ",e=>got.push(e.event.p));
 const c=owner.subscribe("AM.SPY",()=>{});
 assert.equal(FakeSocket.all.length,1);
 const ws=FakeSocket.all[0];ws.emit("open");ws.feed({ev:"status",status:"auth_success"});
 assert.deepEqual(ws.sent.map(x=>x.action),["auth","subscribe"]);
 assert.equal(ws.sent[1].params,"T.QQQ,AM.SPY");
 ws.feed({ev:"T",sym:"QQQ",p:700,t:1});
 assert.deepEqual(got,[700,700]);
 assert.equal(owner.status().connectionCount,1);
 a();b();c();assert.equal(owner.status().connectionCount,0);
 owner.stop();
});
test("Indices only accepts VIX index value and cannot mix stock trade",()=>{
 FakeSocket.all=[];
 const owner=createPolygonConnectionOwner({assetClass:"indices",apiKey:"TEST",Socket:FakeSocket});
 const seen=[];owner.subscribe("V.I:VIX",e=>seen.push(e.event.val));
 assert.throws(()=>owner.subscribe("T.QQQ",()=>{}),/TOPIC_NOT_IN_ASSET_CLASS/);
 const ws=FakeSocket.all[0];ws.emit("open");ws.feed({ev:"status",status:"auth_success"});
 ws.feed({ev:"T",sym:"QQQ",p:700});
 ws.feed({ev:"V",T:"I:VIX",val:19.2,t:1});
 assert.deepEqual(seen,[19.2]);owner.stop();
});
test("subscription limit fails closed and never claims live",()=>{
 FakeSocket.all=[];
 const owner=createPolygonConnectionOwner({assetClass:"stocks",apiKey:"TEST",Socket:FakeSocket});
 owner.subscribe("T.QQQ",()=>{});
 const ws=FakeSocket.all[0];ws.emit("open");ws.feed({ev:"status",status:"max_connections"});
 assert.equal(owner.status().connected,false);
 assert.equal(owner.status().state,"SUBSCRIPTION_LIMIT");
 owner.stop();
});
