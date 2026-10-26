// Engine27 V3 Micro: completed 5-minute market-direction comparisons.
// 1-minute completed buckets are PREVIEW only; no single tick drives 5m signal.
// Uses direct ES and QQQ trades, direct VIX calculated index values; no proxy.
// Structural wave remains Engine22-owned; market context NEVER authorizes orders.
const SYMBOLS=["ES","QQQ","VIX"],FIVE=300000,MINUTE=60000;
const VALID_MS=30000,KEEP_MS=20*60000,MAX_ROWS=1500;
const iso=x=>new Date(x).toISOString();
const round=x=>Number(x.toFixed(4));
const finite=x=>typeof x==="number"&&Number.isFinite(x);
export function createMicroCrossMarketAlignment({clock=()=>Date.now(),onFiveMinuteEvent=null}={}){
 const events={ES:[],QQQ:[],VIX:[]};
 const recorded=new Set(),recent=[];
 let latestAlert=null;
 function ingest(symbol,price,when){
  const at=typeof when==="number"?when:Date.parse(when);
  const now=clock();
  if(!SYMBOLS.includes(symbol)||!finite(price)||price<=0||!finite(at)||
     at>now+1000||now-at>VALID_MS)return false;
  const rows=events[symbol],prev=rows.at(-1);
  if(prev&&prev.at>=at)return false;
  if(prev&&Math.floor(prev.at/1000)===Math.floor(at/1000))rows[rows.length-1]={at,price};
  else rows.push({at,price});
  while(rows.length>MAX_ROWS||rows[0]?.at<now-KEEP_MS)rows.shift();
  return true;
 }
 function compare(symbol,unit,now){
  const latestClose=Math.floor(now/unit)*unit;
  const newerStart=latestClose-unit,olderStart=newerStart-unit;
  const rows=events[symbol];
  let newest=null,older=null;
  for(let i=rows.length-1;i>=0;i--){
   const p=rows[i];
   if(p.at>=newerStart&&p.at<latestClose&&!newest)newest=p;
   if(p.at>=olderStart&&p.at<newerStart&&!older)older=p;
   if(p.at<olderStart)break;
  }
  if(!newest||!older)return {state:"UNAVAILABLE",reason:"MISSING_COMPLETED_"+(unit===FIVE?"5M":"1M")+"_CLOSE",latestCloseAt:iso(latestClose)};
  const delta=round(newest.price-older.price);
  return {state:delta>0?"UP":delta<0?"DOWN":"FLAT",delta,
   from:older.price,to:newest.price,latestCloseAt:iso(latestClose),
   firstObservationAt:iso(older.at),lastObservationAt:iso(newest.at),
   intervalMinutes:unit/MINUTE,reason:null};
 }
 function assess({microDirection=null,neighbors=null,engine25Qualified=false,engine29Qualified=false,
    qqqConnected=true,vixConnected=true,esConnected=true}={}){
  const now=clock(),five={},one={};
  for(const sym of SYMBOLS){
   five[sym]=compare(sym,FIVE,now);one[sym]=compare(sym,MINUTE,now);
   if((sym==="QQQ"&&!qqqConnected)||(sym==="VIX"&&!vixConnected)||(sym==="ES"&&!esConnected)){
    five[sym]={...five[sym],state:"UNAVAILABLE",reason:"SOURCE_NOT_CONNECTED"};
    one[sym]={...one[sym],state:"UNAVAILABLE",reason:"SOURCE_NOT_CONNECTED"};
   }
  }
  const fiveReady=SYMBOLS.every(s=>["UP","DOWN","FLAT"].includes(five[s].state));
  const oneReady=SYMBOLS.every(s=>["UP","DOWN","FLAT"].includes(one[s].state));
  const fiveAligned=fiveReady&&five.ES.state==="UP"&&five.QQQ.state==="UP"&&five.VIX.state==="DOWN";
  const oneAligned=oneReady&&one.ES.state==="UP"&&one.QQQ.state==="UP"&&one.VIX.state==="DOWN";
  const directionCompatible=microDirection==="LONG";
  const fullQualified=fiveAligned&&directionCompatible&&engine25Qualified&&engine29Qualified;
  const state=fullQualified?"BULLISH_CONTEXT_AND_OWNERS_ALIGNED":
    fiveAligned?"BULLISH_CROSS_MARKET_ALIGNMENT_5M":
    fiveReady?"NO_BULLISH_TRIO_5M":"AWAITING_COMPLETED_5M_CLOSES";
  const closedAt=five.ES.latestCloseAt;
  const reasons=fiveAligned?[
    ...(!directionCompatible?["ENGINE22_MICRO_DIRECTION_NOT_LONG"]:[]),
    ...(!engine25Qualified?["ENGINE25_NOT_QUALIFIED"]:[]),
    ...(!engine29Qualified?["ENGINE29_NOT_QUALIFIED"]:[])
   ]:fiveReady?["THREE_MARKET_BULLISH_DIRECTION_NOT_ESTABLISHED"]:["INSUFFICIENT_COMPLETED_5M_SOURCE_BARS"];
  const out={schema:"engine27.v3.microCrossMarketAlignment.v2",state,marketAligned:fiveAligned,
   earlyWarning:oneAligned,fullQualified,executionAuthorized:false,noExecution:true,alertEligible:fiveAligned,
   alertType:fiveAligned?"BULLISH_MARKET_ENVIRONMENT_5M":null,
   methodology:{confirmation:"TWO_CONSECUTIVE_COMPLETED_5M_SOURCE_CLOSES",earlyWarning:"TWO_CONSECUTIVE_COMPLETED_1M_SOURCE_CLOSES",
     comparisonMinutes:5,closedAt,notIndividualTickDirection:true},
   waveAlignment:directionCompatible?"DIRECTION_COMPATIBLE":"MICRO_WAVE_NOT_LONG",
   microDirection,neighbors:neighbors??null,
   qualifications:{engine25Qualified,engine29Qualified},
   evidence:five,earlyEvidence:one,reasons,at:iso(now)};
  // Persist at most once per completed five-minute window, never every UI poll.
  // No retrospective reconstruction: records begin after this observer starts.
  if(fiveReady&&!recorded.has(closedAt)){
   recorded.add(closedAt);
   const entry={schema:"engine27.v3.microFiveMinuteAlignmentEvent.v1",id:"MICRO-"+closedAt,
    closedAt,marketAligned:fiveAligned,earlyWarning:oneAligned,state,
    ES:five.ES,QQQ:five.QQQ,VIX:five.VIX,microDirection,
    engine25Qualified,engine29Qualified,fullQualified,
    noExecution:true};
   recent.unshift(entry);if(recent.length>48)recent.pop();
   if(fiveAligned)latestAlert={at:closedAt,type:"BULLISH_MARKET_ENVIRONMENT_5M",state};
   if(typeof onFiveMinuteEvent==="function")try{onFiveMinuteEvent(entry)}catch{}
  }
  if(recorded.size>200)for(const key of [...recorded].slice(0,recorded.size-100))recorded.delete(key);
  return {...out,latestAlert:latestAlert??null,recentHistory:recent.slice(0,12),
    historyPersistence:"UNVERIFIED"};
 }
 return Object.freeze({ingest,assess,diagnostics:()=>Object.fromEntries(SYMBOLS.map(s=>[s,events[s].length]))});
}
