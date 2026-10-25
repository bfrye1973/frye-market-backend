const url="https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES";
const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error("LIVE_ES_SNAPSHOT_HTTP_"+response.status);
const s=await response.json();
const e=s?.engine27Strategies??{},w=e.engine27WorkingSevenDegrees??{},i=e.engine27SevenInvalidations??{},m=e.engine27UnifiedMarketContext??{};
const order=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const degrees=Object.fromEntries(order.map(d=>[d,{
wave:w.degrees?.[d]?.activeWave??null,model:w.degrees?.[d]?.provenance?.workingModelVersion??null,
review:i.degrees?.[d]?.review?.zone?.low??null,hardInvalidation:i.degrees?.[d]?.price??null,
status:i.degrees?.[d]?.status??null}]));
const result={schema:i.schema??null,marketContextSchema:m.schema??null,
degreeCount:Object.keys(degrees).length,
degrees,qqq:m.crossMarket?.QQQ??null,vix:m.crossMarket?.VIX??null,
intermediateWarning:m.warnings?.intermediate?.status??null,
primaryWarning:m.warnings?.primary?.status??null,
 engine25:m.participation?{available:m.participation.available,fresh:m.participation.fresh,state:m.participation.state,updatedAt:m.participation.updatedAt}:null,
 engine29:m.tactical?{available:m.tactical.available,fresh:m.tactical.fresh,overallState:m.tactical.overallState,oneHour:m.tactical.oneHour,thirtyMinute:m.tactical.thirtyMinute,timestamp:m.tactical.timestamp}:null};
console.log("ENGINE27_FINAL_ACCEPTANCE "+JSON.stringify(result));
if(i.schema!=="engine27.sevenInvalidations.v2"||m.schema!=="engine27.unifiedMarketContext.v1")process.exitCode=1;
