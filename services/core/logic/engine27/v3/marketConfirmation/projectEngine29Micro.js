// Engine 27 V3 Micro: direct, bounded, read-only Engine29 tactical projection.
// Source presence != freshness != confirmation qualification.
const v=x=>typeof x==="string"&&x.trim()?x:null;
const keys=[
 ["headlineIndex","Indexes"],["breadth","Breadth"],["leadership","Leadership"],
 ["credit","Credit"],["ratesDuration","Rates"],["energyInflation","Energy"],
 ["volatility","Volatility"],["financialConditions","Financials"]
];
export function projectEngine29Micro(response=null,qualified=false,nowMs=Date.now()){
 const p=response?.ok===true&&response.data&&typeof response.data==="object"?response.data:null;
 const stamp=v(p?.timestamp);
 const ms=stamp?Date.parse(stamp):NaN;
 const ageMs=Number.isFinite(ms)&&ms<=nowMs?nowMs-ms:null;
 const current=ageMs!==null&&ageMs<=300000;
 const quality=p?.dataDegraded===true?"DEGRADED":!p?"SOURCE_UNAVAILABLE":!current?"STALE":"SOURCE_PRESENT";
 const rows=keys.map(([key,label])=>{
  const group=p?.groups?.[key];
  return {key,label,structural:v(group?.structural?.state),
   hourly:v(group?.tactical?.state),
   thirtyMinute:v(group?.fastTactical?.state),
   structuralDegraded:group?.structural?.dataDegraded===true,
   hourlyDegraded:group?.tactical?.dataDegraded===true,
   thirtyMinuteDegraded:group?.fastTactical?.dataDegraded===true};
 });
 return {schema:"engine27.v3.engine29MicroReadOnlyDisplay.v1",noExecution:true,
  present:!!p,timestamp:stamp,ageMs,sourceCurrent:current,
  quality,qualified:!!p&&current&&p.dataDegraded===false&&qualified===true,
  missingConfirmations:Array.isArray(p?.missingConfirmations)?p.missingConfirmations.filter(v).slice(0,8):[],
  biggerPicture:v(p?.structuralState)??v(p?.overallState),
  tactical:v(p?.tacticalState),fastShift:v(p?.fastTacticalState),
  move:v(p?.marketCharacter?.move?.moveCharacter)??v(p?.moveCharacter?.moveCharacter),
  moveDirection:v(p?.marketCharacter?.move?.direction)??v(p?.moveCharacter?.direction),
  liquidity:v(p?.marketCharacter?.liquidity?.state),
  trap:v(p?.marketCharacter?.trap?.state),
  squeeze:v(p?.marketCharacter?.squeezeCampaign?.state),
  rows};
}
