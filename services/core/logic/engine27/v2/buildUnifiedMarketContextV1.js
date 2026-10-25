// Independent, read-only Engine22 bearish protection and cross-market evidence summary.
// This cannot change Engine22 counts, Engine6 permission or Engine8 execution.
const DEGREES=["submicro","micro","subminute","minute","minor","intermediate","primary"];
export function buildEngine27UnifiedMarketContextV1({snapshot,levels=null,assessment=null,esZones=null}={}){
 const e22=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
 const packet=e22?.higherDegreeBearishProtection;
 const sourceOk=packet?.schema==="engine22.higherDegreeBearishProtection.v1";
 const warnings={};
 for(const degree of ["intermediate","primary"]){
  const raw=sourceOk?packet.degrees?.[degree]:null;
  warnings[degree]={status:raw?.status??"UNAVAILABLE",
   warningLevel:typeof raw?.warningLevel==="number"?raw.warningLevel:null,
   deepRiskLevel:typeof raw?.deepRiskLevel==="number"?raw.deepRiskLevel:null,
   timeframe:raw?.timeframe??null,sourceFresh:raw?.sourceFresh===true,
   latestCompletedClose:raw?.latestCompletedClose??null,
   latestCompletedBarTime:raw?.latestCompletedBarTime??null,
   evidence:raw?.evidence??null,structuralInvalidated:false,
   source:"ENGINE22_HIGHER_DEGREE_BEARISH_PROTECTION"};
 }
 const q=levels?.instruments?.QQQ,v=levels?.instruments?.VIX;
 const crossMarket={QQQ:{status:q?.available===true?"ZONES_AVAILABLE":"UNAVAILABLE",
   levelCount:q?.available===true?q.levels?.length??0:0,asOf:q?.lastCandleTime??null,
   assessment:assessment?.qqq?.state??"UNAVAILABLE"},
 VIX:{status:v?.available===true?"ZONES_AVAILABLE":"UNAVAILABLE",
   levelCount:v?.available===true?v.levels?.length??0:0,asOf:v?.lastCandleTime??null,
   assessment:assessment?.vix?.state??"UNAVAILABLE"}};
 const institutional={available:esZones?.available===true,
   parentCount:esZones?.institutionalParents?.length??0,
   negotiatedCount:esZones?.negotiatedZones?.length??0};
 const strategyReads=Object.fromEntries(DEGREES.map(degree=>[degree,{
  degree,structuralRisk:degree==="intermediate"||degree==="primary"?warnings[degree]:{status:"NOT_SET"},
  crossMarketStatus:crossMarket.QQQ.status==="UNAVAILABLE"||crossMarket.VIX.status==="UNAVAILABLE"?"PARTIAL_OR_UNAVAILABLE":"OBSERVATION_ONLY",
  interpretation:"Cross-market zones do not override Elliott structure; no confirmed invalidation inferred."
 }]));
 return {schema:"engine27.unifiedMarketContext.v1",mode:"READ_ONLY",warnings,crossMarket,institutional,
  strategyReads,noPermissionCreated:true,noExecution:true,noJournalWrite:true};
}
