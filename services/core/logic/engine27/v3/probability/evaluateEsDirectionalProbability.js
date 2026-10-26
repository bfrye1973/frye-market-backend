// Engine27 V3 Module 27.7: read-only, uncalibrated ES evidence assessment.
// No percentages until chronological out-of-sample calibration is accepted.
const HORIZONS=Object.freeze([10,30,60]);
const FEATURES=Object.freeze(["esPriceAction","engine22","engine25","engine29","crossMarket"]);
const STATES=new Set(["UP","DOWN","NEUTRAL"]);
const iso=t=>typeof t==="string"&&Number.isFinite(Date.parse(t));
export function evaluateEsDirectionalProbability({symbol="ES",asOf=null,horizonMinutes=10,features={}}={}){
 const unavailable=(reasons)=>({schema:"engine27.v3.esDirectionalProbability.v1",mode:"READ_ONLY_SHADOW",
  symbol:"ES",horizonMinutes,asOf,available:false,state:"UNAVAILABLE",evidenceScore:null,
  directionalBias:"UNAVAILABLE",probabilities:{up:null,down:null,sideways:null},
  calibration:"NOT_CALIBRATED",reasonCodes:reasons,noExecution:true,noJournalWrite:true});
 if(symbol!=="ES"||!HORIZONS.includes(horizonMinutes)||!iso(asOf))
  return unavailable(["INVALID_ES_IDENTITY_HORIZON_OR_TIME"]);
 const cutoff=Date.parse(asOf),contributions=[],missing=[];
 for(const name of FEATURES){
  const x=features?.[name];
  if(!x||!STATES.has(x.direction)||!iso(x.observedAt)||Date.parse(x.observedAt)>cutoff||
    x.fresh!==true){missing.push(name);continue}
  contributions.push({source:name,direction:x.direction,observedAt:x.observedAt,
   contribution:x.direction==="UP"?1:x.direction==="DOWN"?-1:0});
 }
 // Equal-weight diagnostic baseline only. Correlated features are NOT independent probabilities.
 const total=contributions.reduce((sum,x)=>sum+x.contribution,0);
 const available=contributions.some(x=>x.source==="esPriceAction");
 return {schema:"engine27.v3.esDirectionalProbability.v1",mode:"READ_ONLY_SHADOW",
  symbol:"ES",horizonMinutes,asOf,available,
  state:available?"UNCALIBRATED_EVIDENCE_ONLY":"UNAVAILABLE",
  directionalBias:!available?"UNAVAILABLE":total>0?"UP":total<0?"DOWN":"SIDEWAYS",
  evidenceScore:available?Math.round(100*total/FEATURES.length):null,
  evidenceCoverage:contributions.length+"/"+FEATURES.length,
  contributions,missingSources:missing,
  probabilities:{up:null,down:null,sideways:null},calibration:"NOT_CALIBRATED",
  confidence:"NOT_ESTABLISHED",reasonCodes:available?["NO_VALIDATED_OUT_OF_SAMPLE_CALIBRATION"]:["ES_PRICE_EVIDENCE_UNAVAILABLE"],
  noExecution:true,noJournalWrite:true,noPermissionCreated:true};
}
