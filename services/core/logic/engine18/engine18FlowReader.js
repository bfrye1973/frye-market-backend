// Engine 18 — live/replay FLOW READER (owner-locked Nov 25, master plan §6c).
// Streaming, point-in-time: feed completed 1-minute flow bars in order; each call returns what is
// observable NOW using only past minutes. Confirmation/warning evidence only — never a trade signal.
// Thresholds are PARAMETERS (starting values), not fitted to any single day.
//
// Minute bar: {t (minute start, Unix s), o,h,l,c, v, sellAtBid (seller-initiated), buyAtAsk (buyer-initiated)}.

export const FLOW_DEFAULTS=Object.freeze({
 tick:0.25,
 // divergence (absorption / no defense)
 divMovePts:2,divDelta:100,         // per-minute: move >= 2 pts against >= 100 contracts of opposing aggressor flow
 divStrongMovePts:10,divStrongDelta:300, // a single minute this strong fires immediately
 divNeed:2,divLookback:3,           // otherwise 2 of the last 3 minutes
 // defended ceiling / floor
 levelLookbackMin:45,levelTolPts:2,rejectPts:3,levelMinTouches:3,
 // quiet zone (act three)
 zoneWindowMin:30,zoneMaxRangePts:45,baselineMin:45,quietVolRatio:0.6,zoneBlocks:3,
 breakHoldMin:3,
});
const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2};
const mst=t=>new Date((t-7*3600)*1000).toISOString().slice(11,16);

export function createFlowReader(params={}){
 const P={...FLOW_DEFAULTS,...params};
 const bars=[];let zone=null;const log=[];
 const delta=b=>b.buyAtAsk-b.sellAtBid;
 const move=b=>b.c-b.o;
 function divergence(){
  const last=bars.slice(-P.divLookback);const cur=bars.at(-1);const out=[];
  const absorbUp=b=>move(b)>=P.divMovePts&&delta(b)<=-P.divDelta;     // price up, sellers aggressive
  const noDefense=b=>move(b)<=-P.divMovePts&&delta(b)>=P.divDelta;      // price down, buyers aggressive
  const strongUp=move(cur)>=P.divStrongMovePts&&delta(cur)<=-P.divStrongDelta;
  const strongDn=move(cur)<=-P.divStrongMovePts&&delta(cur)>=P.divStrongDelta;
  const nUp=last.filter(absorbUp).length,nDn=last.filter(noDefense).length;
  if(strongUp||(nUp>=P.divNeed&&absorbUp(cur)))out.push({type:'ABSORPTION_BUYERS',
   read:'Sellers hitting bids, price still rising: resting buyers absorbing',
   evidence:{minutes:last.map(b=>({time:mst(b.t),movePts:move(b),delta:delta(b)}))}});
  if(strongDn||(nDn>=P.divNeed&&noDefense(cur)))out.push({type:'NO_DEFENSE',
   read:'Buyers lifting offers, price still falling: resting bids pulled / no defense',
   evidence:{minutes:last.map(b=>({time:mst(b.t),movePts:move(b),delta:delta(b)}))}});
  return out;
 }
 function defendedLevels(){
  const w=bars.slice(-P.levelLookbackMin);if(w.length<5)return [];
  const hi=Math.max(...w.map(b=>b.h)),lo=Math.min(...w.map(b=>b.l));const out=[];
  const touchesHi=w.filter(b=>hi-b.h<=P.levelTolPts&&b.h-b.c>=P.rejectPts);
  const touchesLo=w.filter(b=>b.l-lo<=P.levelTolPts&&b.c-b.l>=P.rejectPts);
  if(touchesHi.length>=P.levelMinTouches&&touchesHi.some(b=>delta(b)>0))out.push({type:'CEILING_DEFENDED',level:hi,
   read:`Ceiling ${hi} rejected ${touchesHi.length}x (buyers aggressive into it on ${touchesHi.filter(b=>delta(b)>0).length})`,
   evidence:{touches:touchesHi.map(b=>({time:mst(b.t),high:b.h,close:b.c,delta:delta(b)}))}});
  if(touchesLo.length>=P.levelMinTouches&&touchesLo.some(b=>delta(b)<0))out.push({type:'FLOOR_DEFENDED',level:lo,
   read:`Floor ${lo} held ${touchesLo.length}x (sellers aggressive into it on ${touchesLo.filter(b=>delta(b)<0).length})`,
   evidence:{touches:touchesLo.map(b=>({time:mst(b.t),low:b.l,close:b.c,delta:delta(b)}))}});
  return out;
 }
 function quietZone(){
  const W=P.zoneWindowMin;if(bars.length<W+P.baselineMin)return null;
  const w=bars.slice(-W),base=bars.slice(-(W+P.baselineMin),-W);
  const hi=Math.max(...w.map(b=>b.h)),lo=Math.min(...w.map(b=>b.l));
  const baseVol=median(base.map(b=>b.v)),vol=median(w.map(b=>b.v));
  const volRatio=baseVol?vol/baseVol:null;
  const k=Math.floor(W/P.zoneBlocks),blocks=[];for(let i=0;i<P.zoneBlocks;i++)blocks.push(w.slice(i*k,(i+1)*k));
  const lows=blocks.map(s=>Math.min(...s.map(b=>b.l))),highs=blocks.map(s=>Math.max(...s.map(b=>b.h)));
  const rising=lows.every((x,i)=>i===0||x>=lows[i-1])&&lows.at(-1)>lows[0];
  const falling=highs.every((x,i)=>i===0||x<=highs[i-1])&&highs.at(-1)<highs[0];
  const cumDelta=w.reduce((s,b)=>s+delta(b),0);
  const quiet=volRatio!==null&&volRatio<=P.quietVolRatio,tight=hi-lo<=P.zoneMaxRangePts;
  const ctx={rangeLow:lo,rangeHigh:hi,rangePts:hi-lo,volumeRatio:volRatio===null?null:Math.round(volRatio*100)/100,
   lowsByBlock:lows,highsByBlock:highs,cumDelta};
  if(quiet&&tight&&rising&&cumDelta<0)return {type:'QUIET_ACCUMULATION',
   read:`Quiet absorption ${lo}-${hi}: volume ${ctx.volumeRatio}x normal, lows rising, sellers aggressive yet price holding`,evidence:ctx};
  if(quiet&&tight&&falling&&cumDelta>0)return {type:'QUIET_DISTRIBUTION',
   read:`Quiet distribution ${lo}-${hi}: volume ${ctx.volumeRatio}x normal, highs falling, buyers aggressive yet price capped`,evidence:ctx};
  return null;
 }
 return {
  onMinute(m){
   if(bars.length&&m.t<=bars.at(-1).t)throw Error('minutes must be strictly increasing');
   for(const k of ['o','h','l','c','v','sellAtBid','buyAtAsk'])if(!Number.isFinite(m[k]))throw Error('bad minute field '+k);
   bars.push(m);if(bars.length>600)bars.shift();
   const reads=[...divergence(),...defendedLevels()];
   const qz=quietZone();
   if(qz){reads.push(qz);zone={kind:qz.type,low:qz.evidence.rangeLow,high:qz.evidence.rangeHigh,since:zone?.since??m.t,above:0,below:0}}
   else if(zone){ // track resolution of a previously flagged quiet zone
    zone.above=m.c>zone.high?zone.above+1:0;zone.below=m.c<zone.low?zone.below+1:0;
    if(zone.above>=P.breakHoldMin){reads.push({type:'ZONE_BREAKOUT_UP',read:`Held above quiet zone ${zone.low}-${zone.high} for ${zone.above} min`,
     evidence:{zone:{...zone},flowLastMinutes:bars.slice(-zone.above).map(b=>delta(b))}});zone=null}
    else if(zone&&zone.below>=P.breakHoldMin){reads.push({type:'ZONE_BREAKDOWN',read:`Held below quiet zone ${zone.low}-${zone.high} for ${zone.below} min`,
     evidence:{zone:{...zone},flowLastMinutes:bars.slice(-zone.below).map(b=>delta(b))}});zone=null}
   }
   const last15=bars.slice(-15);
   const snapshot={t:m.t,time:mst(m.t),price:m.c,reads,
    context:{change15:last15.length?m.c-last15[0].o:null,delta15:last15.reduce((s,b)=>s+delta(b),0),
     volumeVsPrior45:(()=>{const b=median(bars.slice(-60,-15).map(x=>x.v));const c=median(last15.map(x=>x.v));return b&&c?Math.round(c/b*100)/100:null})()}};
   if(reads.length)log.push(snapshot);
   return snapshot;
  },
  log(){return log.slice()},
 };
}
