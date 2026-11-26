// Engine 18 Track B — Rithmic Paper HISTORY_PLANT replay of 1-second bars + level-event analysis.
// Read-only: templates 16/20 (discovery), 10 login (infra 3), 18 heartbeat, 202 time-bar replay,
// 12 logout. No ticker/order plant, no persistence; sanitized summary + per-minute table only.
// Fields: vendor request/response_time_bar_replay.proto (async_rithmic) and rithmic-rs.
// bid_volume = volume traded at the bid (seller-initiated); ask_volume = traded at the ask
// (buyer-initiated). marker = bar CLOSE time (Unix s).
import WebSocket from 'ws';
import {discoverPaperGateway,verifyPaperEnvironment,encodePaperLogin,parsePaperLogin,
 encodeLogout,TEMPLATES,PAPER_SYSTEM_NAME} from './engine18RithmicPaperProbe.js';
import {encodeConformanceHeartbeat} from './engine18RithmicConformanceTest.js';
import {decodeFields} from './engine18RithmicTestProbe.js';
import {createFlowReader} from './engine18FlowReader.js';
import {createLiquidityMap,referenceCandidates,profileCandidates,provenCandidates,sweepCandidates,
 ownerZoneCandidates,zonesContaining} from './engine18LiquidityMap.js';
import {createLevelEventDetector} from './engine18LevelEventDetector.js';

export const HISTORY_SEND_ALLOWLIST=Object.freeze([10,12,16,18,20,202]);
export const MAX_SECOND_BARS_SPAN=9900; // stays under the server's 10,000-record cap
export const MAX_MINUTE_BARS_SPAN=9900*60;
const F={templateId:154467,rq:132764,rp:132766,symbol:110100,exchange:110101,barType:119200,
 period:119112,start:153002,finish:153003,direction:149253,timeOrder:149307,marker:119100,
 trades:119109,volume:119110,bidVol:119117,askVol:119118,open:100019,close:100021,high:100012,low:100013};
const uvar=n=>{const a=[];do{const b=n%128;n=Math.floor(n/128);a.push(n?b|128:b)}while(n);return Buffer.from(a)};
const str=(f,v)=>{const b=Buffer.from(v,'utf8');return Buffer.concat([uvar(f*8+2),uvar(b.length),b])};
const num=(f,v)=>Buffer.concat([uvar(f*8),uvar(v)]);
const dbl=(f,k)=>{const x=f[k]?.[0];return Buffer.isBuffer(x)&&x.length===8?x.readDoubleLE(0):null};
const int=(f,k)=>{const x=f[k]?.[0];return Number.isSafeInteger(x)?x:null};
const strs=(f,k)=>(f[k]||[]).filter(Buffer.isBuffer).map(x=>x.toString('utf8'));

export function verifyHistoryEnvironment(env){
 const cfg=verifyPaperEnvironment(env);
 if(env.RITHMIC_PAPER_HISTORY_ENABLED!=='YES')throw Error('Rithmic Paper history replay disabled');
 const start=Number(env.RITHMIC_PAPER_HISTORY_START),end=Number(env.RITHMIC_PAPER_HISTORY_END);
 const level=env.RITHMIC_PAPER_HISTORY_LEVEL===undefined?null:Number(env.RITHMIC_PAPER_HISTORY_LEVEL);
 const barUnit=(env.RITHMIC_PAPER_HISTORY_BAR||'SECOND').toUpperCase();
 if(barUnit!=='SECOND'&&barUnit!=='MINUTE')throw Error('history bar must be SECOND or MINUTE');
 const maxSpan=barUnit==='MINUTE'?MAX_MINUTE_BARS_SPAN:MAX_SECOND_BARS_SPAN;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||end-start>maxSpan)
  throw Error('history window must be Unix seconds, end>start, span<=9900 bars');
 if(level!==null&&(!Number.isFinite(level)||Math.abs(level/0.25-Math.round(level/0.25))>1e-9))
  throw Error('level must be an ES tick price');
 return {...cfg,start,end,level,barUnit};
}
export function encodeSecondBarReplay({symbol,exchange,start,end,barUnit='SECOND'}){
 if(!/^ES[HMUZ]\d$/.test(symbol)||exchange!=='CME')throw Error('ES/CME only');
 return Buffer.concat([num(F.templateId,202),str(F.symbol,symbol),str(F.exchange,exchange),
  num(F.barType,barUnit==='MINUTE'?2:1),num(F.period,1),num(F.start,start),num(F.finish,end),
  num(F.direction,1),num(F.timeOrder,1)]); // SECOND_BAR x1, FIRST, FORWARDS
}
export function parseTimeBar(frame){
 const f=decodeFields(frame);if(int(f,F.templateId)!==203)throw Error('not 203');
 const rp=strs(f,F.rp),marker=int(f,F.marker);
 return {final:rp.length>0,rpCode:rp[0]??null,bar:marker===null?null:{t:marker,
  o:dbl(f,F.open),h:dbl(f,F.high),l:dbl(f,F.low),c:dbl(f,F.close),
  v:int(f,F.volume)??0,bid:int(f,F.bidVol)??0,ask:int(f,F.askVol)??0,n:int(f,F.trades)??0}};
}

// ---------- Track B analysis (pure; point-in-time stages, outcome reported separately) ----------
const iso=t=>new Date(t*1000).toISOString().slice(0,19)+'Z';
const mst=t=>new Date((t-7*3600)*1000).toISOString().slice(11,19)+' MST';
export function minuteTable(bars){
 const m=new Map();
 for(const b of bars){const k=Math.floor((b.t-1)/60)*60; // bar closing at :00 belongs to previous minute
  const r=m.get(k)||{t:k,o:b.o,h:-Infinity,l:Infinity,c:b.c,v:0,sellAtBid:0,buyAtAsk:0,trades:0};
  r.h=Math.max(r.h,b.h);r.l=Math.min(r.l,b.l);r.c=b.c;r.v+=b.v;r.sellAtBid+=b.bid;r.buyAtAsk+=b.ask;r.trades+=b.n;m.set(k,r)}
 return [...m.values()].sort((a,b)=>a.t-b.t).map(r=>({...r,time:mst(r.t).slice(0,5),delta:r.buyAtAsk-r.sellAtBid,
  rangePts:r.h-r.l,volPerPoint:r.h>r.l?Math.round(r.v/(r.h-r.l)):null}));
}
export function analyzeLevelEvent(barsIn,{level,tick=0.25,holdSec=60}={}){
 const bars=[...barsIn].filter(b=>b&&Number.isFinite(b.l)&&Number.isFinite(b.h)).sort((a,b)=>a.t-b.t);
 if(!bars.length)return {ok:false,reason:'NO_BARS'};
 let lo=bars[0],hi=bars[0];for(const b of bars){if(b.l<lo.l)lo=b;if(b.h>hi.h)hi=b}
 const out={ok:true,windowStart:iso(bars[0].t-1),windowEnd:iso(bars.at(-1).t),bars:bars.length,
  low:{price:lo.l,at:iso(lo.t),mst:mst(lo.t)},high:{price:hi.h,at:iso(hi.t),mst:mst(hi.t)},
  totalVolume:bars.reduce((s,b)=>s+b.v,0),level:null};
 if(level==null)return out;
 const below=bars.filter(b=>b.l<level);
 const L={level,brokeBelow:below.length>0};
 if(below.length){
  const first=below[0];
  L.firstTradeBelow={at:iso(first.t),mst:mst(first.t)};
  L.penetrationPts=level-lo.l;L.lowBeyondLevel={price:lo.l,mst:mst(lo.t)};
  L.secondsWithLowBelowLevel=below.length;
  // Reclaim: first bar after the low that closes >= level and the next holdSec seconds never trade below level.
  const afterLow=bars.filter(b=>b.t>lo.t);let reclaim=null;
  for(let i=0;i<afterLow.length;i++){const b=afterLow[i];if(b.c<level)continue;
   const end=b.t+holdSec;const win=afterLow.filter(x=>x.t>b.t&&x.t<=end);
   const covered=win.length&&win.at(-1).t>=end-1;
   if(covered&&win.every(x=>x.l>=level)){reclaim=b;break}}
  if(reclaim){
   L.reclaim={at:iso(reclaim.t),mst:mst(reclaim.t),secondsFromLow:reclaim.t-lo.t,
    secondsFromFirstBreak:reclaim.t-first.t,heldRule:`no trade below ${level} for ${holdSec}s after close >= level`};
   const milestones={};for(const d of [20,40,60,100,140]){const hit=bars.find(b=>b.t>=reclaim.t&&b.h>=level+d);
    milestones['+'+d]=hit?{mst:mst(hit.t),minutesFromReclaim:Math.round((hit.t-reclaim.t)/6)/10}:null}
   L.milestonesAboveLevel=milestones;
   // Outcomes AFTER reclaim (reported separately; not detection inputs).
   const outcome={};for(const m of [10,30,60]){const end=reclaim.t+m*60;const seg=bars.filter(b=>b.t>reclaim.t&&b.t<=end);
    const complete=seg.length&&seg.at(-1).t>=end-1;
    outcome['+'+m+'min']=complete?{close:seg.at(-1).c,changeFromLevel:seg.at(-1).c-level,
     mfe:Math.max(...seg.map(b=>b.h))-level,mae:level-Math.min(...seg.map(b=>b.l)),
     retradedBelowLevel:seg.some(b=>b.l<level)}:'WINDOW_INCOMPLETE'}
   L.outcomeAfterReclaim=outcome;
  }else L.reclaim=null;
  // Effort vs result around the break: seller-initiated volume per point of new low.
  const pre=bars.filter(b=>b.t>first.t-600&&b.t<=first.t),pen=bars.filter(b=>b.t>first.t&&b.t<=lo.t),
   post=reclaim?bars.filter(b=>b.t>lo.t&&b.t<=reclaim.t):[];
  const seg=(s,label)=>{if(!s.length)return null;const sell=s.reduce((a,b)=>a+b.bid,0),buy=s.reduce((a,b)=>a+b.ask,0);
   const hiS=Math.max(...s.map(b=>b.h)),loS=Math.min(...s.map(b=>b.l));
   return {label,seconds:s.length,volume:s.reduce((a,b)=>a+b.v,0),sellAtBid:sell,buyAtAsk:buy,delta:buy-sell,
    rangePts:hiS-loS,sellVolumePerPointOfRange:hiS>loS?Math.round(sell/(hiS-loS)):null}};
  L.phases={approach10minBeforeBreak:seg(pre,'approach'),penetrationToLow:seg(pen,'penetration'),
   lowToReclaim:seg(post,'reclaim')};
 }
 out.level=L;return out;
}

// ---------- session ----------
export async function runPaperHistoryReplay({env=process.env,WebSocketImpl=WebSocket,now=Date.now,
 timeoutMs=90000,discoveryTimeoutMs=8000,onStatus=()=>{},ownerZones=[]}={}){
 const cfg=verifyHistoryEnvironment(env);
 const sent=[];
 const r={schema:'engine18.rithmicHistoryCase.v1',readOnly:true,trading:false,recording:false,
  system:PAPER_SYSTEM_NAME,plant:'HISTORY_PLANT',symbol:cfg.symbol,exchange:cfg.exchange,
  window:{start:iso(cfg.start),end:iso(cfg.end)},discovery:{},gatewaySource:null,gatewayName:null,gatewayHost:null,
  authenticated:false,loginRpCode:null,replayRpCode:null,barsReceived:0,possiblyCapped:false,
  stopReason:null,sentTemplates:sent,analysis:null,minutes:null};
 const status=p=>onStatus({phase:p});
 const disc=await discoverPaperGateway({cfg,WebSocketImpl,discoveryTimeoutMs,sent,r,status});
 if(!disc.ok){r.stopReason=disc.reason;return r}
 const bars=[];let ws,hb,hard;
 r.stopReason=await new Promise(resolve=>{
  let done=false;const finish=why=>{if(done)return;done=true;clearInterval(hb);clearTimeout(hard);
   try{ws?.removeAllListeners?.('message');ws?.close();ws?.terminate?.()}catch{}resolve(why)};
  const send=buf=>{const id=decodeFields(buf)[154467]?.[0];if(!HISTORY_SEND_ALLOWLIST.includes(id)){finish('TEMPLATE_NOT_ALLOWED');return false}
   try{ws.send(buf);sent.push(id);return true}catch{finish('SEND_FAILED');return false}};
  hard=setTimeout(()=>finish('TIMEOUT'),timeoutMs);
  try{ws=new WebSocketImpl(disc.gateway.uri,{rejectUnauthorized:true,perMessageDeflate:false,maxPayload:4*1024*1024})}
  catch{return finish('SESSION_SOCKET_FAILED')}
  ws.on('error',()=>finish('SESSION_SOCKET_ERROR'));ws.on('close',()=>finish('SESSION_SOCKET_CLOSED'));
  ws.on('open',()=>send(encodePaperLogin(cfg,3)));
  ws.on('message',data=>{let f;try{f=decodeFields(data)}catch{return}
   const id=int(f,F.templateId);
   if(id===TEMPLATES.loginResp){const L=parsePaperLogin(data);r.loginRpCode=L.rpCode;
    if(!L.accepted)return finish('LOGIN_REJECTED');r.authenticated=true;status('REPLAYING');
    send(encodeConformanceHeartbeat());
    hb=setInterval(()=>send(encodeConformanceHeartbeat()),Math.max(1000,Math.min(30000,Math.floor((L.heartbeatSec||10)*650))));
    send(encodeSecondBarReplay(cfg));return}
   if(id===203){let p;try{p=parseTimeBar(data)}catch{return}
    if(p.bar)bars.push(p.bar);
    if(p.final){r.replayRpCode=p.rpCode;send(encodeLogout());
     setTimeout(()=>finish(p.rpCode==='0'?'REPLAY_COMPLETE':'REPLAY_REJECTED'),500)}return}
   if(id===TEMPLATES.forcedLogout)return finish('FORCED_LOGOUT');
  });
 });
 r.barsReceived=bars.length;r.possiblyCapped=bars.length>=10000;
 if(bars.length){r.analysis=analyzeLevelEvent(bars,{level:cfg.level});r.minutes=minuteTable(bars);
  // Replay the minutes through the point-in-time flow reader (what it would have shown live).
  // The final, possibly incomplete minute is excluded.
  const reader=createFlowReader();const complete=r.minutes.filter(m=>m.t+60<=cfg.end);
  r.flowReads=complete.map(m=>reader.onMinute(m)).filter(x=>x.reads.length)
   .map(x=>({time:x.time,price:x.price,reads:x.reads.map(q=>q.type+(q.level!=null?'@'+q.level:'')+': '+q.read)}));
  r.liquidityMap=replayLiquidityMap(complete,{ownerZones});}
 return r;
}

// Point-in-time Liquidity Map checkpoints over a replay: every checkpoint uses only minutes up to it.
const RTH_OPEN_UTC_MIN=14*60+30;
export function replayLiquidityMap(minutes,{everyMin=30,ownerZones=[]}={}){
 const reader=createFlowReader();
 const map=createLiquidityMap({staleSec:{PROFILE:everyMin*60+60}});
 // Track B sweep detector on the same minutes. Levels are armed BEFORE price reaches them,
 // from point-in-time sources only (round numbers around current price, session open, owner zone edges).
 const det=createLevelEventDetector({reclaimHoldSec:60});
 const armed=new Set();let sweepSince=-Infinity;
 const arm=(price,source,t,ref)=>{const k=price.toFixed(2);if(armed.has(k))return;armed.add(k);
  det.arm({id:'A'+k,price,side:price<=ref?'SUPPORT':'RESISTANCE',source,armedAt:t})};
 const rth=[];let sessionOpen=null;const out=[];let zonesAdded=false;
 minutes.forEach((m,i)=>{
  const snap=reader.onMinute(m);
  if(Math.floor((m.t%86400)/60)>=RTH_OPEN_UTC_MIN){rth.push(m);if(sessionOpen===null)sessionOpen=m.o}
  const t=m.t+60;
  det.onBar({t,o:m.o,h:m.h,l:m.l,c:m.c,v:m.v,bid:m.sellAtBid,ask:m.buyAtAsk});
  for(const {kind,...c} of sweepCandidates(det.events(),{since:sweepSince})){
   if(kind==='HELD')map.add('PROVEN',c);else map.markBroken(c);sweepSince=Math.max(sweepSince,c.t)}
  for(const c of provenCandidates(snap))map.add('PROVEN',{...c,t});
  if(!zonesAdded&&ownerZones.length){for(const c of ownerZoneCandidates(ownerZones,{t}))map.add('OWNER_ZONE',c);zonesAdded=true}
  // arm for the NEXT bars (armedAt = this bar's close)
  for(const c of referenceCandidates({t,price:m.c,sessionOpen}))arm(c.price,c.label,t,m.c);
  for(const z of ownerZones){arm(z.lo,'OWNER_'+z.kind+'_LOW',t,m.c);arm(z.hi,'OWNER_'+z.kind+'_HIGH',t,m.c)}
  const isCheckpoint=(t%(everyMin*60)===0)||i===minutes.length-1;
  if(!isCheckpoint||rth.length<30)return;
  const pc=profileCandidates(rth,{t});
  for(const c of pc.candidates)map.add('PROFILE',{...c,t});
  for(const c of referenceCandidates({t,price:m.c,sessionOpen}))map.add('REFERENCE',{...c,t});
  const ev=map.evaluate({t,price:m.c,airPockets:pc.airPockets});
  out.push({time:new Date((t-7*3600)*1000).toISOString().slice(11,16)+' MST',price:m.c,
   lines:ev.drawn.map(d=>({side:d.side,price:d.price,strength:d.strength,sources:d.sourceTypes,
    labels:Object.values(d.evidence).flatMap(e=>e.labels),state:d.state,airPocketsBetween:d.airPocketsBetween,
    insideOwnerZones:zonesContaining(ownerZones,d.price)})),
   noLineReason:ev.noLineReason});
 });
 out.sweepEvents=det.events().filter(e=>e.classification).map(e=>({level:e.level,side:e.side,source:e.source,
  classification:e.classification,penetrationPts:e.penetration,at:e.history.at(-1)?.at??null}));
 return out;
}
