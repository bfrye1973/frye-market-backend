// Seven-degree read-only structural invalidation registry.
// Engine22 exclusively owns current count and invalidation evidence.
// No invented thresholds, no fallback to superseded counts, no broker stop substitution.
const DEGREES=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const num=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
const str=v=>typeof v==="string"&&v.trim()?v:null;
const own=(e22,d)=>{
 const cw=e22?.currentWavelength?.degrees;
 const minute=cw?.minute?.ownerMinuteW2Hypothesis;
 switch(d){
 case "submicro":return {model:cw?.submicro?.ownerSubmicroCDown,path:"currentWavelength.degrees.submicro.ownerSubmicroCDown",expected:"engine22.submicroCDownOwnerWatch.v1"};
 case "micro":return {model:cw?.micro?.ownerMicroCDown,path:"currentWavelength.degrees.micro.ownerMicroCDown",expected:"engine22.microCDownOwnerWatch.v1"};
 case "subminute":return {model:cw?.subminute?.ownerCurrentCDown,path:"currentWavelength.degrees.subminute.ownerCurrentCDown",expected:"engine22.subminuteCurrentCDownReference.v1"};
 case "minute":return {model:minute,path:"currentWavelength.degrees.minute.ownerMinuteW2Hypothesis",expected:"engine22.minuteW2ComplexCorrectionWatch.v1"};
 default:return {model:e22?.degreeStates?.[d],path:"degreeStates."+d};
 }
};
export function buildEngine27SevenInvalidationsV1({snapshot}={}){
 const e22=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
 const entries={};
 for(const degree of DEGREES){
  const {model,path,expected}=own(e22,degree);
  const compatible=model&&typeof model==="object"&&(!expected||model.version===expected);
  const candidates=compatible?[
   ["invalidationLevel",model.invalidationLevel],
   ["invalidationPrice",model.invalidationPrice],
   ["invalidation.price",model.invalidation?.price],
   ["structuralInvalidation.price",model.structuralInvalidation?.price],
  ]:[];
  const found=candidates.find(([,v])=>num(v)!==null);
  const price=found?num(found[1]):null;
  const rule=compatible?(str(model.invalidationRule)||str(model.invalidation?.rule)||str(model.structuralInvalidation?.rule)):null;
  const breached=compatible&&typeof model.invalidationBreached==="boolean"?model.invalidationBreached:null;
  const status=!compatible?"OWNER_MODEL_UNAVAILABLE":price!==null||rule?"PUBLISHED":"NOT_PUBLISHED";
  entries[degree]={
   degree,status,price,rule,breached,
   breachConfirmation:breached===true?"SOURCE_REPORTED": "NOT_VERIFIED",
   // No proximity warnings from price alone until current-price evidence is validated.
   warningState:status==="PUBLISHED"?"WATCH":"UNAVAILABLE",
   provenance:{engine:"ENGINE22",path,field:found?.[0]??(rule?"invalidationRule":null),
      modelVersion:compatible?(model.version??null):null,
      countId:compatible?(model.sourceCountId??model.countId??null):null,
      ownerCompatible:Boolean(compatible)},
   noExecution:true,noPermissionCreated:true,noJournalWrite:true
  };
 }
 return {schema:"engine27.sevenInvalidations.v1",mode:"READ_ONLY",degrees:entries,
  degreeOrder:DEGREES,publishedCount:DEGREES.filter(d=>entries[d].status==="PUBLISHED").length,
  allPublished:DEGREES.every(d=>entries[d].status==="PUBLISHED"),
  noExecution:true,noPermissionCreated:true,noJournalWrite:true};
}
