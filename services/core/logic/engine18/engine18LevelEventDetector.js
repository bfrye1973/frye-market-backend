// Engine 18 Track B — point-in-time level-event detector (sweep / breakdown / probing).
// Streaming and pure: feed completed bars in time order; every transition records ONLY the
// evidence available at that moment. Outcomes (+10/+30/+60 min) are recorded separately, after
// they complete, and are never inputs to classification. Observation only: no trade signals, no
// claims about intent. Thresholds are PARAMETERS to be tested, not tuned to any single day.
//
// Bar shape: {t (close, Unix s), o,h,l,c, v, bid (seller-initiated vol), ask (buyer-initiated vol)}.
// Levels must be ARMED before price reaches them: {id, price, side:'SUPPORT'|'RESISTANCE', source, armedAt}.

export const DEFAULT_PARAMS=Object.freeze({
 tick:0.25,approachPts:5,      // within this distance = APPROACHING
 reclaimHoldSec:60,            // close back on the original side, then no trade beyond for N s
 acceptanceSec:300,            // continuous time beyond the level (no reclaim) = ACCEPTED_BEYOND
 maxEventSec:3*3600,           // give up tracking after this long
 outcomesMin:[10,30,60],
});
const iso=t=>new Date(t*1000).toISOString().slice(0,19)+'Z';

export function createLevelEventDetector(params={}){
 const P={...DEFAULT_PARAMS,...params};
 const levels=new Map();const events=[];let lastT=null;
 const beyond=(lv,price)=>lv.side==='SUPPORT'?price<lv.price:price>lv.price;      // through the level
 const back=(lv,price)=>lv.side==='SUPPORT'?price>=lv.price:price<=lv.price;       // on original side
 const extreme=(lv,b)=>lv.side==='SUPPORT'?b.l:b.h;
 const flowSeg=()=>({seconds:0,volume:0,sellAtBid:0,buyAtAsk:0,hi:-Infinity,lo:Infinity});
 const addFlow=(s,b)=>{s.seconds++;s.volume+=b.v;s.sellAtBid+=b.bid;s.buyAtAsk+=b.ask;s.hi=Math.max(s.hi,b.h);s.lo=Math.min(s.lo,b.l)};
 const flowOut=s=>s.seconds?{seconds:s.seconds,volume:s.volume,sellAtBid:s.sellAtBid,buyAtAsk:s.buyAtAsk,
  delta:s.buyAtAsk-s.sellAtBid,rangePts:s.hi-s.lo}:null;
 const transition=(ev,state,b,evidence={})=>{ev.state=state;ev.history.push({state,at:iso(b.t),t:b.t,price:b.c,evidence})};
 return {
  // Arm a level. It is only valid for bars that close AFTER armedAt (no retroactive levels).
  arm({id,price,side,source,armedAt}){
   if(!id||!Number.isFinite(price)||!['SUPPORT','RESISTANCE'].includes(side)||!Number.isSafeInteger(armedAt))
    throw Error('level needs id, price, side and integer armedAt');
   if(Math.abs(price/P.tick-Math.round(price/P.tick))>1e-9)throw Error('level must be on tick');
   if(lastT!==null&&armedAt<lastT)throw Error('cannot arm a level in the past');
   levels.set(id,{id,price,side,source,armedAt,state:'ARMED',ev:null});
  },
  onBar(b){
   if(lastT!==null&&b.t<=lastT)throw Error('bars must be strictly increasing in time');lastT=b.t;
   for(const lv of levels.values()){
    if(b.t<=lv.armedAt)continue;
    let ev=lv.ev;
    if(!ev||ev.closed){
     const dist=lv.side==='SUPPORT'?b.l-lv.price:lv.price-b.h;
     if(dist<=P.approachPts&&!ev){ev=lv.ev={levelId:lv.id,level:lv.price,side:lv.side,source:lv.source,
      armedAt:iso(lv.armedAt),state:'ARMED',history:[],closed:false,penetration:0,extremeT:null,
      firstBeyondT:null,reclaimCandidateT:null,beyondSinceT:null,flow:{approach:flowSeg(),beyond:flowSeg(),reclaim:flowSeg()},
      outcomes:{},classification:null};events.push(ev);transition(ev,'APPROACHING',b,{distancePts:Math.max(0,dist)})}
     if(!ev||ev.closed)continue;
    }
    if(b.t-ev.history[0].t>P.maxEventSec&&!ev.classification){ev.closed=true;transition(ev,'EXPIRED',b);continue}
    const st=ev.state;
    if(st==='APPROACHING'){addFlow(ev.flow.approach,b);
     if(beyond(lv,extreme(lv,b))){ev.firstBeyondT=b.t;ev.beyondSinceT=back(lv,b.c)?null:b.t;
      ev.penetration=Math.abs(extreme(lv,b)-lv.price);ev.extremeT=b.t;addFlow(ev.flow.beyond,b);
      transition(ev,'PENETRATED',b,{penetrationPts:ev.penetration,approachFlow:flowOut(ev.flow.approach)})}
     continue}
    if(st==='PENETRATED'||st==='RECLAIM_PENDING'){
     const ext=Math.abs(extreme(lv,b)-lv.price);
     if(beyond(lv,extreme(lv,b))&&ext>ev.penetration){ev.penetration=ext;ev.extremeT=b.t}
     if(st==='PENETRATED'){addFlow(ev.flow.beyond,b);
      if(back(lv,b.c)){ev.reclaimCandidateT=b.t;ev.beyondSinceT=null;transition(ev,'RECLAIM_PENDING',b,{})}
      else{ev.beyondSinceT??=b.t;
       if(b.t-ev.beyondSinceT>=P.acceptanceSec){ev.classification='ACCEPTED_BEYOND';
        transition(ev,'ACCEPTED_BEYOND',b,{secondsBeyond:b.t-ev.beyondSinceT,penetrationPts:ev.penetration,beyondFlow:flowOut(ev.flow.beyond)})}}
      continue}
     // RECLAIM_PENDING: must hold the original side for reclaimHoldSec
     addFlow(ev.flow.reclaim,b);
     if(beyond(lv,extreme(lv,b))){transition(ev,'PENETRATED',b,{reclaimFailedAfterSec:b.t-ev.reclaimCandidateT});ev.reclaimCandidateT=null;ev.beyondSinceT=back(lv,b.c)?null:b.t;continue}
     if(b.t-ev.reclaimCandidateT>=P.reclaimHoldSec){ev.classification='SWEEP_RECLAIMED';
      transition(ev,'RECLAIMED',b,{secondsBeyondTotal:ev.reclaimCandidateT-ev.firstBeyondT,penetrationPts:ev.penetration,
       secondsFromExtreme:ev.reclaimCandidateT-ev.extremeT,beyondFlow:flowOut(ev.flow.beyond),
       // effort vs result evidence: price direction vs aggressor delta while beyond the level
       deltaWhileBeyond:flowOut(ev.flow.beyond)?.delta??null})}
     continue}
    if(ev.classification&&!ev.closed){
     // Outcome tracking (separate from detection).
     const t0=ev.history.at(-1).t,ref=lv.price,dir=lv.side==='SUPPORT'?1:-1;
     ev.outcomeTrack??={mfe:0,mae:0,retradedBeyond:false};
     const fav=dir>0?b.h-ref:ref-b.l,adv=dir>0?ref-b.l:b.h-ref;
     ev.outcomeTrack.mfe=Math.max(ev.outcomeTrack.mfe,fav);ev.outcomeTrack.mae=Math.max(ev.outcomeTrack.mae,adv);
     if(beyond(lv,extreme(lv,b)))ev.outcomeTrack.retradedBeyond=true;
     for(const m of P.outcomesMin){const key='+'+m+'min';
      if(!ev.outcomes[key]&&b.t-t0>=m*60)ev.outcomes[key]={closeVsLevel:(b.c-ref)*dir,mfe:ev.outcomeTrack.mfe,
       mae:ev.outcomeTrack.mae,retradedBeyond:ev.outcomeTrack.retradedBeyond}}
     if(P.outcomesMin.every(m=>ev.outcomes['+'+m+'min']))ev.closed=true;
    }
   }
  },
  events(){return events.map(({flow,outcomeTrack,closed,reclaimCandidateT,beyondSinceT,...e})=>({...e,closed,
   flow:{approach:flowOut(flow.approach),beyond:flowOut(flow.beyond),reclaim:flowOut(flow.reclaim)}}))},
 };
}

// Point-in-time level sources that need only prior price data.
export function roundNumberLevels(refPrice,{step=50,count=2}={}){
 const base=Math.floor(refPrice/step)*step,out=[];
 for(let k=-count+1;k<=count;k++){const p=base+k*step;out.push({price:p,side:p<=refPrice?'SUPPORT':'RESISTANCE',source:`ROUND_${step}`})}
 return out;
}
