// Offline tests only. No network: every socket is a scripted fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {verifyPaperEnvironment,normalizeGatewayUri,encodeGatewayInfoRequest,parseGatewayInfo,
 selectGateway,encodePaperLogin,parsePaperLogin,encodeMarketDataRequest,parseInbound,
 createStepASummary,runPaperStepA,PAPER_SYSTEM_NAME,PAPER_APP_NAME,SEND_ALLOWLIST,
 DISCOVERY_GATEWAY} from '../logic/engine18/engine18RithmicPaperProbe.js';
import {decodeFields,PROTOCOL_FIELDS} from '../logic/engine18/engine18RithmicTestProbe.js';

const v=n=>{const b=[];do{const k=n%128;n=Math.floor(n/128);b.push(n?k|128:k)}while(n);return Buffer.from(b)};
const num=(n,x)=>Buffer.concat([v(n*8),v(x)]);
const str=(n,x)=>{const b=Buffer.from(x);return Buffer.concat([v(n*8+2),v(b.length),b])};
const dbl=(n,x)=>{const b=Buffer.alloc(8);b.writeDoubleLE(x,0);return Buffer.concat([v(n*8+1),b])};
const frame=(id,rest=[])=>Buffer.concat([num(PROTOCOL_FIELDS.templateId,id),...rest]);
const ok=str(PROTOCOL_FIELDS.rpCode,'0');
const sysInfo=names=>frame(17,[ok,...names.map(n=>str(PROTOCOL_FIELDS.systemName,n))]);
const gwInfo=(list,code='0')=>frame(21,[str(PROTOCOL_FIELDS.rpCode,code),
 str(PROTOCOL_FIELDS.systemName,PAPER_SYSTEM_NAME),
 ...list.map(g=>str(153640,g.name)),...list.map(g=>str(153641,g.uri))]);
const loginOk=(hb=15)=>frame(11,[ok,dbl(PROTOCOL_FIELDS.heartbeatInterval,hb)]);
const bbo=(bid,ask)=>frame(151,[num(149138,3),dbl(100022,bid),num(159000,12),dbl(100025,ask),num(159002,9)]);
const trade=(p,sz=2,ag=1)=>frame(150,[num(149138,1),dbl(100006,p),num(159008,sz),num(112003,ag)]);
const ENV={RITHMIC_PAPER_CONNECT_ENABLED:'YES',RITHMIC_PAPER_USER:'paper-user-x',
 RITHMIC_PAPER_PASSWORD:'paper-secret-y',RITHMIC_PAPER_SYSTEM_NAME:PAPER_SYSTEM_NAME};
const GW='wss://paper-chi.rithmic.com:443';

// Scripted fake: behavior(ws,templateId,bytes) is called for every client send.
function fakeFactory(behavior){
 const log={sockets:[],sends:[]};
 class FakeWS extends EventEmitter{
  constructor(url){super();this.url=url;this.closed=false;log.sockets.push(url);
   queueMicrotask(()=>this.emit('open'))}
  send(buf){const id=decodeFields(buf)[PROTOCOL_FIELDS.templateId][0];
   log.sends.push({url:this.url,id,bytes:Buffer.from(buf)});behavior(this,id,buf)}
  reply(b){queueMicrotask(()=>{if(!this.closed)this.emit('message',b)})}
  close(){this.closed=true}terminate(){this.closed=true}
 }
 return {FakeWS,log};
}
const happy=({gateways=[{name:'Chicago Area',uri:'paper-chi.rithmic.com:443'}],
 streamFrames=[],paperListed=true,loginFrame=loginOk()}={})=>(ws,id)=>{
 if(id===16)ws.reply(sysInfo(paperListed?['Rithmic Test',PAPER_SYSTEM_NAME]:['Rithmic Test']));
 if(id===20)ws.reply(gwInfo(gateways));
 if(id===10)ws.reply(loginFrame);
 if(id===18)ws.reply(frame(19,[ok]));
 if(id===100&&!ws.subscribed){ws.subscribed=true;ws.reply(frame(101,[ok]));
  for(const f of streamFrames)ws.reply(f)}
 if(id===12)ws.reply(frame(13,[ok]));
};

test('config: disabled by default, explicit Paper creds, no Test fallback',()=>{
 assert.throws(()=>verifyPaperEnvironment({}),/disabled/);
 assert.throws(()=>verifyPaperEnvironment({RITHMIC_PAPER_CONNECT_ENABLED:'YES',
  RITHMIC_TEST_USER:'t',RITHMIC_TEST_PASSWORD:'t'}),/missing Rithmic Paper credentials/);
 assert.throws(()=>verifyPaperEnvironment({...ENV,RITHMIC_PAPER_SYSTEM_NAME:'Rithmic 01'}),/Paper Trading/);
 assert.throws(()=>verifyPaperEnvironment({...ENV,RITHMIC_PAPER_SYMBOL:'ES'}),/outright ES/);
 assert.throws(()=>verifyPaperEnvironment({...ENV,RITHMIC_PAPER_GATEWAY_URI:'wss://evil.example.com:443'}),/rithmic\.com/);
 const c=verifyPaperEnvironment(ENV);
 assert.equal(c.user,'paper-user-x');assert.equal(c.symbol,'ESZ6');assert.equal(c.exchange,'CME');
});

test('gateway URI validation accepts only bare *.rithmic.com:443 over wss',()=>{
 assert.equal(normalizeGatewayUri('Paper-Chi.rithmic.com:443'),'wss://paper-chi.rithmic.com:443');
 assert.equal(normalizeGatewayUri('wss://a.b.rithmic.com'),'wss://a.b.rithmic.com:443');
 for(const bad of ['ws://a.rithmic.com:443','https://a.rithmic.com','a.rithmic.com.evil.io:443',
  'rithmic.com:443','wss://u:p@a.rithmic.com:443','wss://a.rithmic.com:443/x','a.rithmic.com:8443',
  'wss://a.rithmic.com:443?q=1'])assert.throws(()=>normalizeGatewayUri(bad),undefined,bad);
});

test('gateway discovery encode/parse and fail-closed selection',()=>{
 const f=decodeFields(encodeGatewayInfoRequest());
 assert.equal(f[PROTOCOL_FIELDS.templateId][0],20);
 assert.equal(f[PROTOCOL_FIELDS.systemName][0].toString(),PAPER_SYSTEM_NAME);
 const two=[{name:'Chicago Area',uri:'chi.rithmic.com:443'},{name:'Europe',uri:'eu.rithmic.com:443'}];
 const p=parseGatewayInfo(gwInfo(two));
 assert.equal(p.accepted,true);assert.equal(p.gateways.length,2);
 assert.equal(parseGatewayInfo(gwInfo(two,'7')).accepted,false);
 assert.equal(selectGateway({gateways:two}).reason,'GATEWAY_AMBIGUOUS_SET_RITHMIC_PAPER_GATEWAY_NAME');
 assert.equal(selectGateway({gateways:two,preferredName:'Chicago Area'}).gateway.uri,'wss://chi.rithmic.com:443');
 assert.equal(selectGateway({gateways:two,pinnedUri:'wss://other.rithmic.com:443'}).ok,false);
 assert.equal(selectGateway({gateways:two,pinnedUri:'wss://eu.rithmic.com:443'}).source,'DISCOVERED_AND_PINNED');
 const bad=selectGateway({gateways:[{name:'X',uri:'x.example.com:443'}]});
 assert.equal(bad.reason,'NO_VALID_GATEWAY_DISCOVERED');assert.deepEqual(bad.rejected,['X']);
});

test('login is TICKER_PLANT, Paper system, brfr app, 5.55, no aggregated quotes',()=>{
 const f=decodeFields(encodePaperLogin({user:'u',password:'p'}));
 assert.equal(f[PROTOCOL_FIELDS.templateId][0],10);
 assert.equal(f[PROTOCOL_FIELDS.infraType][0],1);
 assert.equal(f[PROTOCOL_FIELDS.systemName][0].toString(),PAPER_SYSTEM_NAME);
 assert.ok(f[PROTOCOL_FIELDS.appName][0].toString().startsWith('brfr:'));
 assert.equal(f[PROTOCOL_FIELDS.appName][0].toString(),PAPER_APP_NAME);
 assert.equal(f[PROTOCOL_FIELDS.templateVersion][0].toString(),'5.55');
 assert.equal(f[153644],undefined);
 assert.deepEqual(parsePaperLogin(loginOk(60)),{accepted:true,rpCode:'0',heartbeatSec:60});
 assert.equal(parsePaperLogin(frame(11,[str(PROTOCOL_FIELDS.rpCode,'13')])).accepted,false);
});

test('market data request is BBO|LAST_TRADE only; inbound decode supports 64- and 32-bit sizes',()=>{
 const f=decodeFields(encodeMarketDataRequest({symbol:'ESZ6',exchange:'CME',subscribe:true}));
 assert.equal(f[PROTOCOL_FIELDS.templateId][0],100);assert.equal(f[100000][0],1);assert.equal(f[154211][0],3);
 assert.equal(decodeFields(encodeMarketDataRequest({symbol:'ESZ6',exchange:'CME',subscribe:false}))[100000][0],2);
 assert.throws(()=>encodeMarketDataRequest({symbol:'NQZ6',exchange:'CME',subscribe:true}));
 assert.deepEqual(parseInbound(bbo(6800,6800.25)),{kind:'BBO',presence:3,clear:null,snapshot:false,
  bid:6800,bidSize:12,ask:6800.25,askSize:9});
 const t32=parseInbound(frame(150,[dbl(100006,6800.5),num(100178,4),num(112003,2)]));
 assert.equal(t32.size,4);assert.equal(t32.aggressor,2);
 assert.equal(parseInbound(frame(77)).kind,'FORCED_LOGOUT');
});

test('summary: spread histogram, locked/crossed, tick alignment, merged one-sided BBO',()=>{
 let t=0;const s=createStepASummary({now:()=>t,sampleEveryMs:10000});s.start();
 s.observe({kind:'BBO',bid:6800,ask:6800.25,clear:null});t=500;
 s.observe({kind:'BBO',bid:null,ask:6800.5,clear:null});t=1000;  // ask-only update -> 2 ticks
 s.observe({kind:'BBO',bid:6800.5,ask:null,clear:null});t=1500; // locked
 s.observe({kind:'TRADE',price:6800.3,size:1,aggressor:1});t=2000;
 const out=s.finish();
 assert.deepEqual(out.spreadTicks,{one:1,two:1,threePlus:0,lockedOrCrossed:1});
 assert.equal(out.nonTickPrices,1);assert.equal(out.trades,1);assert.equal(out.bboPerSec,1.5);
 assert.equal(out.samples.length,1);
});

test('happy path: discovery -> login -> heartbeat -> subscribe -> window -> unsubscribe -> logout',async()=>{
 const stream=[];for(let i=0;i<40;i++)stream.push(bbo(6800,6800.25));stream.push(trade(6800.25));
 const {FakeWS,log}=fakeFactory(happy({streamFrames:stream}));
 const r=await runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:1000});
 assert.deepEqual(log.sockets,[DISCOVERY_GATEWAY,DISCOVERY_GATEWAY,GW,GW]);
 assert.deepEqual(r.sentTemplates,[16,20,16,10,18,100,100,12]);
 assert.ok(r.sentTemplates.every(id=>SEND_ALLOWLIST.includes(id)));
 assert.ok(!log.sends.some(s=>[115,117,312,313,314].includes(s.id)));
 // Credentials go ONLY to the vendor-discovered Paper gateway, never to discovery.
 const loginSends=log.sends.filter(s=>s.id===10);
 assert.equal(loginSends.length,1);assert.equal(loginSends[0].url,GW);
 assert.ok(!log.sends.filter(s=>s.url===DISCOVERY_GATEWAY).some(s=>s.bytes.includes(Buffer.from('paper-secret-y'))));
 const unsub=log.sends.filter(s=>s.id===100)[1];assert.equal(decodeFields(unsub.bytes)[100000][0],2);
 assert.equal(r.authenticated,true);assert.equal(r.heartbeat.acks>=1,true);
 assert.equal(r.subscriptionAccepted,true);assert.equal(r.stopReason,'WINDOW_COMPLETE');
 assert.equal(r.logoutAcked,true);assert.equal(r.gatewaySource,'DISCOVERED_SINGLE');
 assert.equal(r.gatewayHost,'paper-chi.rithmic.com');
 assert.equal(r.market.bbo,40);assert.equal(r.market.trades,1);assert.equal(r.market.oneTickShare,1);
 assert.equal(r.verdict,'STEP_A_PASS_PENDING_CHART_MATCH');assert.equal(r.chartMatch,'PENDING_EXTERNAL_COMPARISON');
 assert.equal(r.bookValid,false);assert.equal(r.dboTested,false);
 const text=JSON.stringify(r);
 assert.ok(!text.includes('paper-secret-y')&&!text.includes('paper-user-x'),'no credentials in output');
});

test('Test-like static feed (8-pt spread, no trades) fails Step A',async()=>{
 const {FakeWS}=fakeFactory(happy({streamFrames:[bbo(7143,7151)]}));
 const r=await runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:1000});
 assert.equal(r.verdict,'STEP_A_FAIL');
 assert.equal(r.checks.mostlyOneTickSpread,false);assert.equal(r.checks.tradesPresent,false);
 assert.equal(r.checks.bboRateOver1PerSec,false);
});

test('Paper system not listed -> stop before any credential is sent',async()=>{
 const {FakeWS,log}=fakeFactory(happy({paperListed:false}));
 const r=await runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:1000});
 assert.equal(r.stopReason,'PAPER_SYSTEM_NOT_LISTED');assert.deepEqual(r.sentTemplates,[16]);
 assert.ok(!log.sends.some(s=>s.id===10));
});

test('ambiguous or non-rithmic gateways fail closed; no login',async()=>{
 for(const gateways of [[{name:'A',uri:'a.rithmic.com:443'},{name:'B',uri:'b.rithmic.com:443'}],
  [{name:'X',uri:'x.example.com:443'}],[]]){
  const {FakeWS,log}=fakeFactory(happy({gateways}));
  const r=await runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:1000});
  assert.equal(r.authenticated,false);assert.ok(!log.sends.some(s=>s.id===10),r.stopReason);
  assert.match(r.stopReason,/GATEWAY/);
 }
});

test('gateway info rejected (e.g. requires login) is reported, not bypassed',async()=>{
 const {FakeWS,log}=fakeFactory((ws,id)=>{
  if(id===16)ws.reply(sysInfo([PAPER_SYSTEM_NAME]));if(id===20)ws.reply(gwInfo([],'3'))});
 const r=await runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:1000});
 assert.equal(r.stopReason,'GATEWAY_INFO_REJECTED');assert.equal(r.discovery.gatewayInfoRpCode,'3');
 assert.ok(!log.sends.some(s=>s.id===10));
});

test('login rejected -> no heartbeat, no subscription',async()=>{
 const {FakeWS}=fakeFactory(happy({loginFrame:frame(11,[str(PROTOCOL_FIELDS.rpCode,'13')])}));
 const r=await runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:1000});
 assert.equal(r.stopReason,'LOGIN_REJECTED');assert.equal(r.loginRpCode,'13');
 assert.deepEqual(r.sentTemplates,[16,20,16,10]);
});

test('forced logout stops the session immediately',async()=>{
 const {FakeWS}=fakeFactory(happy({streamFrames:[bbo(6800,6800.25),frame(77)]}));
 const r=await runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:1000});
 assert.equal(r.stopReason,'FORCED_LOGOUT');assert.equal(r.forcedLogout,true);
 assert.equal(r.verdict,'STEP_A_FAIL');
});

test('periodic heartbeats are sent during the window',async()=>{
 const {FakeWS,log}=fakeFactory(happy({loginFrame:loginOk(2)})); // 2s -> 1.3s cadence
 await runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:3000});
 assert.ok(log.sends.filter(s=>s.id===18).length>=3);
});

test('rejects unbounded window before network',async()=>{
 const {FakeWS,log}=fakeFactory(()=>{});
 await assert.rejects(runPaperStepA({env:ENV,WebSocketImpl:FakeWS,durationMs:120001}),/bounded/);
 await assert.rejects(runPaperStepA({env:{},WebSocketImpl:FakeWS}),/disabled/);
 assert.equal(log.sockets.length,0);
});
