// Independent, read-only Engine22 bearish protection and cross-market evidence summary.
// This cannot change Engine22 counts, Engine6 permission or Engine8 execution.
const DEGREES=["submicro","micro","subminute","minute","minor","intermediate","primary"];
export function buildEngine27UnifiedMarketContextV1({snapshot,levels=null,assessment=null,esZones=null,engine25=null,engine29=null,now=new Date()}={}){
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
 const nowMs=now instanceof Date?now.getTime():Date.parse(now);
 const freshness=(time,maxAgeMs)=>{const t=Date.parse(time||"");return Number.isFinite(t)&&Number.isFinite(nowMs)&&t<=nowMs&&nowMs-t<=maxAgeMs;};
 const participation={
   available:engine25?.ok===true,
   source:"ENGINE25_CONTEXT",
   state:engine25?.regime??"UNAVAILABLE",
   riskLevel:engine25?.riskLevel??null,
   summary:engine25?.summary??null,
   updatedAt:engine25?.updatedAt??null,
   fresh:engine25?.ok===true&&freshness(engine25?.updatedAt,90*60000),
   reasonCodes:Array.isArray(engine25?.reasonCodes)?engine25.reasonCodes:[]
 };
 const tactical={
   available:Boolean(engine29&&typeof engine29==="object"),
   source:"ENGINE29_CROSS_MARKET_STRESS",
   overallState:engine29?.overallState??"UNAVAILABLE",
   oneHour:engine29?.tacticalState??null,
   thirtyMinute:engine29?.fastTacticalState??null,
   underlyingPressure:engine29?.moveCharacter?.underlyingPressure?.state??null,
   liquidity:engine29?.marketCharacter?.liquidity?.state??null,
   trap:engine29?.marketCharacter?.trap?.state??null,
   timestamp:engine29?.timestamp??null,
   fresh:freshness(engine29?.timestamp,90*60000)&&engine29?.dataDegraded!==true,
   dataDegraded:engine29?.dataDegraded===true
 };
 const strategyReads=Object.fromEntries(DEGREES.map(degree=>[degree,{
  degree,structuralRisk:degree==="intermediate"||degree==="primary"?warnings[degree]:{status:"NOT_SET"},
  engine25Status:!participation.available?"UNAVAILABLE":participation.fresh?"CURRENT":"STALE",
  engine29Status:!tactical.available?"UNAVAILABLE":tactical.fresh?"CURRENT":"STALE",
  crossMarketStatus:crossMarket.QQQ.status==="UNAVAILABLE"||crossMarket.VIX.status==="UNAVAILABLE"?"PARTIAL_OR_UNAVAILABLE":"OBSERVATION_ONLY",
  interpretation:"Cross-market zones do not override Elliott structure; no confirmed invalidation inferred."
 }]));
 return {schema:"engine27.unifiedMarketContext.v1",mode:"READ_ONLY",warnings,crossMarket,institutional,participation,tactical,
  strategyReads,noPermissionCreated:true,noExecution:true,noJournalWrite:true};
}
