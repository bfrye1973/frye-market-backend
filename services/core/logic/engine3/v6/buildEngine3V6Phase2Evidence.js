// Engine 3 v6 Phase 2: purely observational evidence integrity.
// Never creates Engine 3 direction or trade permission. Frozen on each
// continuous Engine26 authorization run; no historical pre-activation reactions.
import {deriveCandleCompletionTruth} from "../candleCompletionTruth.js";
const num=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const time=x=>typeof x==="number"&&Number.isFinite(x)?x:
  typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const validZone=z=>num(z?.low)!==null&&num(z?.high)!==null&&z.high>=z.low;
function normalized(bars,tf,now){
 const duration=tf==="1m"?60000:300000;
 const truth=deriveCandleCompletionTruth({bars,timeframe:tf,evaluationTimeMs:now});
 const map=b=>{
  const t=num(Number(b?.time??b?.t??b?.tSec));
  const o=num(Number(b?.open)),h=num(Number(b?.high)),l=num(Number(b?.low)),c=num(Number(b?.close));
  if(t===null||o===null||h===null||l===null||c===null||h<l||o>h||o<l||c>h||c<l) return null;
  return {startMs:t*1000,closeTimeMs:t*1000+duration,open:o,high:h,low:l,close:c};
 };
 const completed=(truth.completedBars||[]).map(map).filter(Boolean);
 const forming=truth.formingBar?map(truth.formingBar):null;
 return {completed,forming};
}
function atrAtActivation(bars,activationMs,period=14){
 const old=bars.filter(b=>b.closeTimeMs<=activationMs);
 if(old.length<period+1)return null;
 const samples=[];
 for(let i=1;i<old.length;i++){
  const current=old[i],previous=old[i-1];
  samples.push(Math.max(current.high-current.low,
    Math.abs(current.high-previous.close),Math.abs(current.low-previous.close)));
 }
 const window=samples.slice(-period);
 return window.reduce((a,b)=>a+b,0)/period;
}
function frozenSiteGeometry(zone,atr,policy){
 if(!validZone(zone)||num(atr)===null||atr<=0)return null;
 const multiplier=num(policy?.wideMultiplier)??2;
 const fraction=num(policy?.bandFraction)??0.25;
 const floor=num(policy?.bandFloorPoints)??1;
 const halfWidth=Math.max(floor,atr*fraction);
 const width=zone.high-zone.low;
 return {schema:"engine3.v6.reactionSites.v1",originalZone:{...zone},
  frozenAtr5m:atr,wideZone:width>multiplier*atr,
  wideMultiplier:multiplier,bandFraction:fraction,bandHalfWidth:halfWidth,
  upper:{edge:zone.high,low:zone.high-halfWidth,high:zone.high+halfWidth},
  lower:{edge:zone.low,low:zone.low-halfWidth,high:zone.low+halfWidth},
  policyAuthority:false};
}
const isSame=(p,c,z)=>p?.active===true&&p?.candidateId===c&&p?.zoneId===z;
export function buildEngine3V6Phase2Evidence({
 priorActivation=null,candidateId=null,zoneId=null,eligible=false,
 authorizedStartedAt=null,zone=null,bars1m=[],bars5m=[],
 evaluationTimeMs=null,policy=null,observedDirection="NEUTRAL",
 priorReactionAnchor=null,priorAnchorDirection=null,priorReactionSite=null,
 establishingNow=false,
 progressExtreme=null,warningEnabled=true,
}={}){
 const now=time(evaluationTimeMs);
 const base={schema:"engine3.v6.phase2.evidence.v1",mode:"SHADOW_READ_ONLY",
  candidateId,zoneId,eligible:eligible===true,
  activationSource:"UNAVAILABLE",activationStartedAtMs:null,
  activationUncertaintyMs:null,activationRun:null,
  completed1mEligible:[],completed5mEligible:[],
  preActivation1mCount:0,preActivation5mCount:0,
  slowPathEvidenceState:"INSUFFICIENT_POST_ACTIVATION_EVIDENCE",
  geometry:null,reactionSite:null,reactionAnchor:null,
  anchorDirection:null,
  adverseDisplacementWarning:false,adverseWarning:false,anchorThreatened:false,
  adverseWarningOnly:true,
  graceBarsCanEstablish:false,directionEstablishmentAuthorized:false,
  shadowSeedEvidenceEligible:false,
  canonicalDirectionAuthority:false,noPermissionCreated:true,noExecution:true,
  reasonCodes:[]};
 if(now===null||eligible!==true||!candidateId||!zoneId||!validZone(zone))
   return {...base,reasonCodes:["ENGINE26_NOT_AUTHORIZED_OR_GEOMETRY_UNAVAILABLE"]};
 const one=normalized(bars1m,"1m",now),five=normalized(bars5m,"5m",now);
 const same=isSame(priorActivation,candidateId,zoneId);
 const declared=time(authorizedStartedAt);
 const declaredValid=declared!==null&&declared<=now;
 const start=same?priorActivation.startedAtMs:declaredValid?declared:now;
 const source=same?priorActivation.source:declaredValid?"ENGINE26_AUTHORIZED":"ENGINE3_OBSERVED";
 // Observation is at an evaluation instant; earlier bars can be shown but
 // cannot establish an initial reaction even if within an uncertainty window.
 const uncertainty=source==="ENGINE3_OBSERVED"
  ?(same?priorActivation.uncertaintyMs:Math.max(60000,num(policy?.observedUncertaintyMs)??180000)):0;
 const frozen=same?priorActivation.geometry:
   frozenSiteGeometry(zone,atrAtActivation(five.completed,start,
     Math.max(2,Math.floor(num(policy?.atrPeriod)??14))),policy);
 const activationRun={active:true,candidateId,zoneId,startedAtMs:start,
  source,uncertaintyMs:uncertainty,geometry:frozen};
 const filteredOne=one.completed.filter(b=>b.closeTimeMs>start);
 const filteredFive=five.completed.filter(b=>b.closeTimeMs>start);
 const direction=observedDirection==="SHORT"?"SHORT":observedDirection==="LONG"?"LONG":"NEUTRAL";
 // Narrow zones retain the original whole-zone site. Wide zones choose
 // the actual post-activation band ENGAGED, not a side inferred from LONG/SHORT.
 const touched=(band,b)=>Boolean(band&&b.high>=band.low&&b.low<=band.high);
 const priorAnchor=same&&priorAnchorDirection===direction&&direction!=="NEUTRAL"
   ?num(priorReactionAnchor):null;
 const priorSite=priorAnchor!==null&&["whole","upper","lower"].includes(priorReactionSite)
   ?priorReactionSite:null;
 let siteName=priorSite;
 let engagedIndex=-1;
 let engagedSource=null;
 const findSite=bars=>{
   if(frozen?.wideZone===false){
     const index=bars.findIndex(bar=>touched(frozen.originalZone,bar));
     return index>=0?{name:"whole",index}:null;
   }
   if(frozen?.wideZone!==true)return null;
   const hits=[];
   for(let i=0;i<bars.length;i++){
     for(const name of ["upper","lower"]){
       if(touched(frozen[name],bars[i]))hits.push({name,index:i});
     }
   }
   if(!hits.length)return null;
   const lastIndex=Math.max(...hits.map(h=>h.index));
   const choices=[...new Set(hits.filter(h=>h.index===lastIndex).map(h=>h.name))];
   if(choices.length!==1)return null;
   // First engagement of the confirmed last-contact site sets the anchor.
   return {name:choices[0],index:hits.find(h=>h.name===choices[0]).index};
 };
 if(!siteName){
   const from1m=findSite(filteredOne);
   const from5m=from1m?null:findSite(filteredFive);
   const selected=from1m??from5m;
   siteName=selected?.name??null;
   engagedIndex=selected?.index??-1;
   engagedSource=from1m?"1m":from5m?"5m":null;
 }
 const site=siteName==="whole"?frozen?.originalZone:frozen?.[siteName];
 const causalBars=engagedSource==="1m"?filteredOne:
   engagedSource==="5m"?filteredFive:[];
 const engagedBars=engagedIndex>=0?causalBars.slice(engagedIndex):[];
 const anchorCandidate=direction==="SHORT"&&engagedBars.length
  ?Math.max(...engagedBars.map(bar=>bar.high)):
  direction==="LONG"&&engagedBars.length
  ?Math.min(...engagedBars.map(bar=>bar.low)):null;
 const shadowSeedEvidenceEligible=Boolean(frozen&&site&&
   filteredFive.length>=2&&(priorAnchor!==null||anchorCandidate!==null));
 const anchor=priorAnchor??(establishingNow&&shadowSeedEvidenceEligible?anchorCandidate:null);
 const atr=frozen?.frozenAtr5m;
 const forming=five.forming;
 const currentMove=forming&&direction==="SHORT"?forming.high-forming.open:
   forming&&direction==="LONG"?forming.open-forming.low:0;
 const progress=num(progressExtreme);
 const progressMove=forming&&progress!==null&&direction==="SHORT"?forming.high-progress:
   forming&&progress!==null&&direction==="LONG"?progress-forming.low:0;
 // Warnings are annotations only and have no state-machine inputs.
 const adverse=warningEnabled&&atr>0&&Boolean(forming)&&direction!=="NEUTRAL"&&
   (currentMove>=0.75*atr||progressMove>=atr);
 const threatened=warningEnabled&&atr>0&&anchor!==null&&Boolean(forming)&&
   (direction==="SHORT"?forming.high>=anchor-0.25*atr:
     direction==="LONG"?forming.low<=anchor+0.25*atr:false);
 return {...base,activationSource:source,activationStartedAtMs:start,
  activationUncertaintyMs:uncertainty,activationRun,
  completed1mEligible:filteredOne,completed5mEligible:filteredFive,
  preActivation1mCount:one.completed.length-filteredOne.length,
  preActivation5mCount:five.completed.length-filteredFive.length,
  slowPathEvidenceState:filteredFive.length>=2?"SUFFICIENT_POST_ACTIVATION_5M":
    "INSUFFICIENT_POST_ACTIVATION_EVIDENCE",
  geometry:frozen,reactionSite:siteName,
  reactionSiteEvidenceSource:engagedSource??(priorSite?"FROZEN_PREVIOUS":"UNAVAILABLE"),
  anchorDirection:anchor!==null?direction:null,
  shadowSeedEvidenceEligible,
  reactionAnchor:anchor,
  anchorSource:priorAnchor!==null?"FROZEN_PREVIOUS":
    anchor!==null&&engagedSource==="1m"?"POST_ACTIVATION_1M_EXTREME":
    anchor!==null&&engagedSource==="5m"?"POST_ACTIVATION_5M_EXTREME":"UNAVAILABLE",
  adverseDisplacementWarning:Boolean(adverse),
  adverseWarning:Boolean(adverse),anchorThreatened:Boolean(threatened),
  reasonCodes:[
   same?"CONTINUOUS_AUTHORIZATION_RUN":"NEW_AUTHORIZATION_RUN",
   source==="ENGINE3_OBSERVED"?"OBSERVED_ACTIVATION_NO_GRACE_DIRECTION_AUTHORITY":"ENGINE26_ACTIVATION_CONSUMED",
   frozen?"FROZEN_ATR_SITE_GEOMETRY":"ATR_AT_ACTIVATION_UNAVAILABLE",
   filteredFive.length<2?"INSUFFICIENT_POST_ACTIVATION_EVIDENCE":null,
   adverse?"ADVERSE_WARNING_ANNOTATION_ONLY":null,
   threatened?"ANCHOR_THREATENED_ANNOTATION_ONLY":null
  ].filter(Boolean)};
}
export default buildEngine3V6Phase2Evidence;
