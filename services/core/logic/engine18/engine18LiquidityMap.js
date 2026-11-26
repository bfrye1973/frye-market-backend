// Engine 18 Liquidity Map — level registry (owner-locked Nov 25, master plan §6d).
//
// Collects evidence from independent sources at FIXED absolute prices and decides which levels are
// drawn. Rules that stop lines from "following price":
//  - a level's anchor price and ID never change once created (merging only attaches evidence);
//  - a level is drawn only if >= minSources DISTINCT, non-stale source types agree;
//  - nothing is drawn within minDistancePts of the current price;
//  - max 2 BUY (below price) + 2 SELL (above price); zero is valid;
//  - stale evidence never counts as current (a level can be LAST_SEEN, never silently current).
// Evidence counts are descriptive, NOT probabilities. Confirmation only — no trade instructions.
import {computeVolumeProfile} from './engine18VolumeProfileCore.js';

export const MAP_DEFAULTS=Object.freeze({
 tick:0.25,mergeTolPts:2,minSources:2,minDistancePts:8,maxPerSide:2,
 // seconds a source stays current after its last confirmation (null = whole session)
 staleSec:{BOOK:60,PROFILE:300,REFERENCE:null,PROVEN:null,OWNER_ZONE:null}, // profile must be refreshed
});
export const SOURCE_TYPES=Object.freeze(['BOOK','PROFILE','REFERENCE','PROVEN','OWNER_ZONE']);
const toTick=(p,tick)=>Math.round(p/tick);

export function createLiquidityMap(params={}){
 const P={...MAP_DEFAULTS,...params,staleSec:{...MAP_DEFAULTS.staleSec,...(params.staleSec||{})}};
 const levels=new Map(); // id -> level
 let lastT=null;
 const findNear=price=>{let best=null,bd=Infinity;
  for(const l of levels.values()){const d=Math.abs(l.price-price);if(d<=P.mergeTolPts&&d<bd){best=l;bd=d}}return best};
 return {
  // Attach evidence. A new level is created at the candidate's price; later candidates within
  // mergeTolPts attach to it without moving it.
  add(type,{price,label,t,state=null,detail=null}){
   if(!SOURCE_TYPES.includes(type))throw Error('unknown source type '+type);
   if(!Number.isFinite(price)||!Number.isSafeInteger(t))throw Error('price and integer t required');
   if(lastT!==null&&t<lastT)throw Error('evidence must not be added in the past');
   const p=toTick(price,P.tick)*P.tick;
   let l=findNear(p);
   if(!l){l={id:'L'+toTick(p,P.tick),price:p,firstSeenT:t,sources:new Map(),state:null,history:[]};levels.set(l.id,l)}
   const prev=l.sources.get(type)||{labels:new Set(),firstT:t};
   prev.labels.add(label);prev.lastT=t;if(detail)prev.detail=detail;l.sources.set(type,prev);
   if(state&&state!==l.state){l.state=state;l.history.push({t,state,by:type})}
   return l.id;
  },
  // Mark a level BROKEN (price went through and stayed). Not evidence FOR the level: earlier PROVEN
  // evidence stops counting; only PROVEN evidence added after the break (e.g. a flip retest) counts.
  markBroken({price,label,t,detail=null}){
   if(!Number.isFinite(price)||!Number.isSafeInteger(t))throw Error('price and integer t required');
   if(lastT!==null&&t<lastT)throw Error('evidence must not be added in the past');
   const p=toTick(price,P.tick)*P.tick;let l=findNear(p);
   if(!l){l={id:'L'+toTick(p,P.tick),price:p,firstSeenT:t,sources:new Map(),state:null,history:[]};levels.set(l.id,l)}
   l.brokenT=t;l.state='BROKEN_FLIP';l.history.push({t,state:'BROKEN_FLIP',by:label,...(detail?{detail}:{})});return l.id;
  },
  evaluate({t,price,airPockets=[]}){
   if(!Number.isSafeInteger(t)||!Number.isFinite(price))throw Error('t and price required');
   lastT=t;
   const current=l=>[...l.sources.entries()].filter(([type,s])=>{const ttl=P.staleSec[type];
    if(type==='PROVEN'&&l.brokenT!=null&&s.lastT<=l.brokenT)return false; // proof before a break no longer counts
    return ttl==null||t-s.lastT<=ttl});
   const all=[...levels.values()].map(l=>{const cur=current(l);
    return {id:l.id,price:l.price,side:l.price<price?'BUY':'SELL',distancePts:Math.abs(l.price-price),
     sourceTypes:cur.map(([k])=>k),evidence:Object.fromEntries(cur.map(([k,s])=>[k,{labels:[...s.labels],lastT:s.lastT,...(s.detail?{detail:s.detail}:{})}])),
     staleSources:[...l.sources.keys()].filter(k=>!cur.some(([c])=>c===k)),
     state:l.state,firstSeenT:l.firstSeenT}});
   const qualifies=x=>x.sourceTypes.length>=P.minSources&&x.distancePts>=P.minDistancePts;
   // ties: a level that was swept and HELD outranks one that was not, then the nearer one
   const held=x=>x.state==='SWEPT_AND_HELD'?1:0;
   const rank=(a,b)=>b.sourceTypes.length-a.sourceTypes.length||held(b)-held(a)||a.distancePts-b.distancePts;
   const pick=side=>all.filter(x=>x.side===side&&qualifies(x)).sort(rank).slice(0,P.maxPerSide);
   const buy=pick('BUY'),sell=pick('SELL');
   // Air pockets between price and each drawn level (fast-travel zones toward that level).
   const pocketsTo=lv=>airPockets.filter(a=>{const lo=Math.min(price,lv.price),hi=Math.max(price,lv.price);return a.hi>lo&&a.lo<hi})
    .map(a=>({lo:a.lo,hi:a.hi}));
   const drawn=[...buy,...sell].map(x=>({...x,strength:x.sourceTypes.length,airPocketsBetween:pocketsTo(x),
    card:`${x.side} ${x.price}: ${x.sourceTypes.join(' + ')}${x.state?` · ${x.state}`:''}`}));
   const noLineReason=drawn.length?null:!levels.size?'NO_EVIDENCE':
    all.some(x=>x.sourceTypes.length>=P.minSources)?'QUALIFIED_LEVELS_TOO_CLOSE_TO_PRICE':'NO_LEVEL_WITH_AGREEING_SOURCES';
   return {schema:'engine18.liquidityMap.v1',t,price,drawn,
    candidates:all.filter(x=>x.sourceTypes.length>=1).length,noLineReason,
    rules:{minSources:P.minSources,minDistancePts:P.minDistancePts,maxPerSide:P.maxPerSide},
    note:'Evidence counts are descriptive, not probabilities. Confirmation only.'};
  },
  size(){return levels.size},
 };
}

// ---------- source producers (point-in-time: callers pass only data known at t) ----------
export function referenceCandidates({t,price,sessionOpen=null,priorHigh=null,priorLow=null,roundStep=50,roundCount=2}){
 const out=[];const base=Math.floor(price/roundStep)*roundStep;
 for(let k=-roundCount+1;k<=roundCount;k++)out.push({price:base+k*roundStep,label:`ROUND_${roundStep}`,t});
 if(Number.isFinite(sessionOpen))out.push({price:sessionOpen,label:'SESSION_OPEN',t});
 if(Number.isFinite(priorHigh))out.push({price:priorHigh,label:'PRIOR_DAY_HIGH',t});
 if(Number.isFinite(priorLow))out.push({price:priorLow,label:'PRIOR_DAY_LOW',t});
 return out;
}
// Minute flow bars -> volume-profile levels and air pockets (thin runs).
export function profileCandidates(minutes,{t,rows=120}={}){
 const bars=minutes.map(m=>({time:m.t,high:m.h,low:m.l,close:m.c,volume:m.v}));
 const prof=computeVolumeProfile(bars,{rows,preselected:true});
 if(!prof)return {candidates:[],airPockets:[],profile:null};
 const c=[{price:prof.poc,label:'POC',t},{price:prof.vah,label:'VAH',t},{price:prof.val,label:'VAL',t},
  ...prof.hvn.map(p=>({price:p,label:'HVN',t})),
  ...prof.shelfEdges.map(e=>({price:e.price,label:`SHELF_${e.side}`,t}))];
 return {candidates:c,airPockets:prof.thinRuns,profile:{poc:prof.poc,vah:prof.vah,val:prof.val,lo:prof.lo,hi:prof.hi}};
}
// Flow-reader snapshots -> proven levels (defended ceilings/floors).
export function provenCandidates(snapshot){
 const out=[];
 for(const r of snapshot.reads||[]){
  if(r.type==='CEILING_DEFENDED')out.push({price:r.level,label:'CEILING_DEFENDED',t:snapshot.t,state:'DEFENDED',
   detail:{touches:r.evidence?.touches?.length??null}});
  if(r.type==='FLOOR_DEFENDED')out.push({price:r.level,label:'FLOOR_DEFENDED',t:snapshot.t,state:'DEFENDED',
   detail:{touches:r.evidence?.touches?.length??null}});
 }
 return out;
}
// Level-event detector (Track B) events -> proven levels. Only CLASSIFIED events count, and only
// at the moment they were classified (the detector records evidence point-in-time).
//  SWEEP_RECLAIMED: price went through, failed to stay, came back -> the level held (resting orders).
//  ACCEPTED_BEYOND: price went through and stayed -> the level BROKE (use map.markBroken, not add).
export function sweepCandidates(events,{since=-Infinity}={}){
 const out=[];
 for(const e of events){
  if(!e.classification)continue;
  const at=e.history.find(h=>h.state===(e.classification==='SWEEP_RECLAIMED'?'RECLAIMED':'ACCEPTED_BEYOND'));
  if(!at||at.t<=since)continue;
  const sweep=e.classification==='SWEEP_RECLAIMED';
  out.push({kind:sweep?'HELD':'BROKEN',price:e.level,label:sweep?`SWEEP_RECLAIMED_${e.side}`:`BROKEN_${e.side}`,t:at.t,
   state:sweep?'SWEPT_AND_HELD':'BROKEN_FLIP',
   detail:{penetrationPts:e.penetration,deltaWhileBeyond:at.evidence?.deltaWhileBeyond??at.evidence?.beyondFlow?.delta??null,at:at.at}});
 }
 return out;
}
// Owner hand-drawn zones (read-only). Text format of es-smz-manual-zones.txt:
//   "PARENT_LO-PARENT_HI | NEG LO-HI # comment"  (either side optional, ranges may be reversed).
export function parseOwnerZones(text,{tick=0.25}={}){
 const r=x=>Math.round(Number(x)/tick)*tick;const zones=[];
 for(const raw of String(text||'').split(/\r?\n/)){
  const line=raw.replace(/#.*$/,'').trim();if(!line)continue;
  for(const part of line.split('|')){const s=part.trim();if(!s)continue;
   const m=s.match(/^(NEG\s+)?(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/i);if(!m)continue;
   const a=r(m[2]),b=r(m[3]);zones.push({kind:m[1]?'NEG':'PARENT',lo:Math.min(a,b),hi:Math.max(a,b)})}
 }
 return zones;
}
// Zone EDGES are the evidence (where institutional rotation happens); zones are never moved or edited.
export function ownerZoneCandidates(zones,{t}){
 return zones.flatMap(z=>[{price:z.lo,label:`OWNER_${z.kind}_LOW`,t,detail:{zone:`${z.lo}-${z.hi}`}},
  {price:z.hi,label:`OWNER_${z.kind}_HIGH`,t,detail:{zone:`${z.lo}-${z.hi}`}}]);
}
// Context only (not counted as a source): which owner zones contain a price.
export function zonesContaining(zones,price){return zones.filter(z=>price>=z.lo&&price<=z.hi).map(z=>`${z.kind} ${z.lo}-${z.hi}`)}
