// Engine 18 HAND-zone context, private READ-ONLY research only.
// The canonical owner-approved ES parent/NEG set comes directly from GitHub main TXT.
// HAND parent and negotiated provenance preserved; owner-approved raw prices never roll-adjusted.
// Never grant a trade, rewrite a chart band, or backdate a version.
import {createHash} from 'node:crypto';
export const ZONE_POLL_MS=300000;
export const ZONE_SCHEMA='engine18.handZones.v1';
const validDate=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const tick=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&Math.abs(x*4-Math.round(x*4))<1e-7;
const safeId=x=>typeof x==='string'&&x.length>0&&x.length<180&&/^[A-Za-z0-9_.|:\-]+$/.test(x);
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function normalizeChartHandZones(payload,{contract='XCME:ES.Z26',approvedKinds=null}={}){
 if(contract!=='XCME:ES.Z26')throw Error('CONTRACT_MISMATCH');
 if(!payload||payload.ok!==true||payload.symbol!=='ES'||!Array.isArray(payload.structures_sticky))
  throw Error('SOURCE_UNAVAILABLE');
 const meta=payload.meta||{};
 // Current legacy route emits generated_at_utc on EACH GET, not a trustworthy source revision.
 // An upgraded chart-effective publisher must provide stable immutable sourceRevision + sourceUpdatedAt.
 if(!safeId(meta.sourceRevision)||!validDate(meta.sourceUpdatedAt))
  throw Error('SOURCE_REVISION_UNVERIFIED');
 if(meta.contract!==contract||meta.priceBasis!=='CHART_UNADJUSTED')
  throw Error('SOURCE_COORDINATES_UNVERIFIED');
 if(meta.zoneAuthority!=='GITHUB_MAIN_HAND')
  throw Error('HAND_MAPPING_UNVERIFIED');
 if(approvedKinds!==null&&(!Array.isArray(approvedKinds)||
  !approvedKinds.every(x=>['NEGOTIATED','PARENT'].includes(x))))
  throw Error('INVALID_APPROVED_KIND_FILTER');
 const kinds=approvedKinds??['NEGOTIATED','PARENT'];
 const seen=new Set(),zones=[];
 for(const s of payload.structures_sticky){
  if(s?.rangeSource!=='manual'||s?.locked!==true||s?.status!=='active')
   throw Error('UNAPPROVED_OR_INVALID_ZONE');
  const id=s?.details?.id,pr=s.displayPriceRange??s.priceRange;
  if(!safeId(id)||seen.has(id))throw Error('DUPLICATE_OR_UNSAFE_ID');
  seen.add(id);
  if(!Array.isArray(pr)||pr.length!==2||!tick(pr[0])||!tick(pr[1]))
   throw Error('INVALID_PRICE_RANGE');
  const hi=Math.max(...pr),lo=Math.min(...pr);
  if(hi<=lo)throw Error('INVALID_PRICE_RANGE');
  const kind=s.isNegotiated===true?'NEGOTIATED':'PARENT';
  if(!kinds.includes(kind))continue;
  zones.push({id,source:'HAND',kind,lo,hi,negotiated:kind==='NEGOTIATED',
   contract,priceBasis:'CHART_UNADJUSTED',sourceRevision:meta.sourceRevision});
 }
 zones.sort((a,b)=>a.id.localeCompare(b.id));
 return {schema:ZONE_SCHEMA,source:'HAND',sourceName:'GITHUB_MAIN_ES_MANUAL_TXT',
  contract,priceBasis:'CHART_UNADJUSTED',sourceRevision:meta.sourceRevision,
  sourceUpdatedAt:meta.sourceUpdatedAt,approvedKinds:[...new Set(kinds)].sort(),
  zones};
}
export function semanticZoneHash(model){
 const {schema,source,contract,priceBasis,approvedKinds,zones}=model;
 return digest({schema,source,contract,priceBasis,approvedKinds,zones:zones.map(
  ({id,source,kind,lo,hi,negotiated,contract,priceBasis})=>
   ({id,source,kind,lo,hi,negotiated,contract,priceBasis}))});
}
export function approvedSnapshotAt(history,asOf,{contract='XCME:ES.Z26'}={}){
 if(!validDate(asOf)||!Array.isArray(history))return {status:'HISTORICAL_ZONE_UNVERIFIED'};
 const available=history.filter(s=>s?.contract===contract&&validDate(s.firstObservedAt)&&
  Date.parse(s.firstObservedAt)<=Date.parse(asOf));
 if(!available.length)return {status:'HISTORICAL_ZONE_UNVERIFIED'};
 const s=available.at(-1);
 return {status:'AVAILABLE',snapshot:s};
}
export function linkObservedBookToZones({snapshot,image,eventTime,priceBasisEvidence=null,previousImage=null,
 previousTime=null,priorSnapshot=null}={}){
 if(!snapshot||!validDate(eventTime)||snapshot.contract!=='XCME:ES.Z26'||
  !validDate(snapshot.firstObservedAt)||Date.parse(snapshot.firstObservedAt)>Date.parse(eventTime)||
  priorSnapshot&&priorSnapshot.hash!==snapshot.hash)
  return {status:'HISTORICAL_ZONE_UNVERIFIED'};
 if(priceBasisEvidence?.contract!=='XCME:ES.Z26'||
  priceBasisEvidence?.zoneHash!==snapshot.hash||
  priceBasisEvidence?.verified!==true)return {status:'PRICE_BASIS_UNVERIFIED'};
 if(image?.state!=='VALID')return {status:'FEED_INVALID'};
 const mid=(image.bestBid+image.bestAsk)/2;
 const prevMid=previousImage?.state==='VALID'&&validDate(previousTime)&&
  Date.parse(previousTime)>=Date.parse(snapshot.firstObservedAt)&&
  Date.parse(previousTime)<=Date.parse(eventTime)?
  (previousImage.bestBid+previousImage.bestAsk)/2:null;
 return {status:'OBSERVED_ONLY',zoneVersion:snapshot.hash,asOf:eventTime,
  zones:snapshot.zones.map(z=>{
   const insideBand=mid>=z.lo&&mid<=z.hi;
   const prevInside=prevMid!==null&&prevMid>=z.lo&&prevMid<=z.hi;
   const entry=prevMid!==null&&!prevInside&&insideBand;
   const exit=prevMid!==null&&prevInside&&!insideBand;
   const enteringFrom=entry?(prevMid<z.lo?'BELOW':'ABOVE'):null;
   const exitSide=exit?(mid<z.lo?'BELOW':'ABOVE'):null;
   const hits=[...image.bids,...image.asks].filter(l=>l.price>=z.lo&&l.price<=z.hi);
   return {id:z.id,source:z.source,kind:z.kind,insideBand,enteringFrom,
    entryAt:entry?eventTime:null,exitAt:exit?eventTime:null,exitSide,
    observedTickCoverage:hits.length,coverage:hits.length?'PARTIAL_TOP_TEN':'OUT_OF_COVERAGE',
    observedLevels:hits.map(l=>({side:l.side,price:l.price,state:l.state,
     displayedSz:l.state==='OBSERVED_QTY'?l.sz:l.state==='OBSERVED_ZERO'?0:null}))};
  })};
}
