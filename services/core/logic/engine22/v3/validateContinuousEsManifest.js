// Engine22 V3 — fail-closed validation of an ES continuous daily history manifest.
// Merely claiming "continuousVerified: true" is NOT sufficient evidence.
// No trading state, broker action, price adjustment, or anchor promotion.
const nonblank=x=>typeof x==="string"&&x.trim().length>0;
const contract=/^ES[FGHJKMNQUVXZ]\d{1,2}$/;
const stamp=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const DAY=86400000;
export function validateEngine22V3ContinuousEsManifest({dailyBars=[],provenance=null}={}){
 const problems=[];
 if(provenance?.symbol!=="ES")problems.push("ES_SYMBOL_REQUIRED");
 if(!nonblank(provenance?.sourceId))problems.push("SOURCE_ID_REQUIRED");
 if(!nonblank(provenance?.sessionCalendar))problems.push("EXCHANGE_SESSION_CALENDAR_REQUIRED");
 if(!nonblank(provenance?.rolloverMethod))problems.push("ROLLOVER_METHOD_REQUIRED");
 if(!nonblank(provenance?.priceAdjustmentMethod))problems.push("PRICE_ADJUSTMENT_DISCLOSURE_REQUIRED");
 if(provenance?.continuousVerified!==true)problems.push("CONTINUOUS_VERIFICATION_REQUIRED");
 if(!Array.isArray(dailyBars)||dailyBars.length<20)problems.push("INSUFFICIENT_SOURCE_BARS");
 const lineage=provenance?.contractLineage;
 if(!Array.isArray(lineage)||lineage.length<2)problems.push("MULTI_CONTRACT_LINEAGE_REQUIRED");
 else {
  const sorted=[...lineage].sort((a,b)=>(stamp(a?.from)||0)-(stamp(b?.from)||0));
  for(let i=0;i<sorted.length;i++){
   const e=sorted[i],from=stamp(e?.from),to=stamp(e?.to);
   if(!contract.test(e?.contract||"")||from===null||to===null||from>to)
    problems.push("INVALID_CONTRACT_LINEAGE_ENTRY");
   if(!nonblank(e?.sourceId)||!nonblank(e?.rollEvidenceId))
    problems.push("CONTRACT_ROLL_EVIDENCE_REQUIRED");
   if(i>0 && from!==null && stamp(sorted[i-1]?.to)!==null &&
      from-stamp(sorted[i-1].to)>7*DAY) problems.push("CONTRACT_LINEAGE_GAP");
   if(i>0 && from!==null && stamp(sorted[i-1]?.from)!==null &&
      from<=stamp(sorted[i-1].from))problems.push("NON_MONOTONIC_CONTRACT_LINEAGE");
  }
  const contracts=new Set(sorted.map(x=>x.contract));
  if(contracts.size<2)problems.push("MULTIPLE_DISTINCT_CONTRACTS_REQUIRED");
  if(Array.isArray(dailyBars)&&dailyBars.length){
   const first=Number(dailyBars[0].time)*1000,last=Number(dailyBars.at(-1).time)*1000;
   if(Number.isFinite(first)&&Number.isFinite(last)){
    if(stamp(sorted[0].from)>first||stamp(sorted.at(-1).to)<last)
      problems.push("CONTRACT_LINEAGE_DOES_NOT_COVER_HISTORY");
   }
  }
 }
 if(Array.isArray(dailyBars)&&dailyBars.some(b=>
   typeof b?.sourceContract!=="string" || !contract.test(b.sourceContract) ||
   !nonblank(b.sourceCandleId)))problems.push("DAILY_SOURCE_CANDLE_LINEAGE_REQUIRED");
 if(Array.isArray(dailyBars)&&Array.isArray(lineage)&&lineage.length){
  const intervals=lineage.map(e=>({...e,fromMs:stamp(e.from),toMs:stamp(e.to)}));
  if(dailyBars.some(b=>{const t=Number(b?.time)*1000;
    return !Number.isFinite(t)||!intervals.some(e=>e.contract===b.sourceContract &&
       e.fromMs!==null&&e.toMs!==null&&t>=e.fromMs&&t<=e.toMs);
  }))problems.push("DAILY_BAR_CONTRACT_OUTSIDE_LINEAGE");
 }
 return {accepted:problems.length===0,reasonCodes:[...new Set(problems)],
   observedDailyBars:Array.isArray(dailyBars)?dailyBars.length:0,
   observedContracts:Array.isArray(lineage)?[...new Set(lineage.map(x=>x.contract))]:[],
   readOnly:true,noAnchorPromotion:true};
}
