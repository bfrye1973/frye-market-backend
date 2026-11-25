// Engine27 view of Engine22's CURRENT authoritative review and invalidation packet.
// Never promotes review boundaries to approved invalidation. No inferred lifecycle.
const DEGREES=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const owner=e22=>e22?.sevenDegreeInvalidations;
export function buildEngine27SevenInvalidationsV1({snapshot}={}){
 const e22=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
 const packet=owner(e22),schemaOk=packet?.schema==="engine22.sevenDegreeInvalidations.v1";
 const entries={};
 for(const degree of DEGREES){
  const record=schemaOk?packet?.degrees?.[degree]:null;
  const readiness=record?.invalidationReadiness;
  const z=readiness?.candidateZone;
  const reviewZone=z&&typeof z.low==="number"&&Number.isFinite(z.low)&&typeof z.high==="number"&&Number.isFinite(z.high)&&z.high>=z.low
    ?{low:z.low,high:z.high,kind:z.kind??null,source:z.source??null,qualifiedMark:z.qualifiedMark===true}:null;
  const approved=Array.isArray(record?.rules)?record.rules.filter(r=>r?.status==="PUBLISHED"&&typeof r.price==="number"&&Number.isFinite(r.price)&&r.trigger&&r.timeframe&&r.ruleVersion):[];
  entries[degree]={
   degree,status:approved.length?"PUBLISHED":record?"NOT_PUBLISHED":"OWNER_MODEL_UNAVAILABLE",
   price:approved.length?approved[0].price:null,rule:approved.length?approved[0].trigger:null,
   officialRules:approved,breached:null,warningState:"UNAVAILABLE",
   review:{status:reviewZone?"REVIEW_ONLY":"NOT_PUBLISHED",zone:reviewZone,
     availability:readiness?.zoneAvailability??null,
     authority:readiness?.zoneAuthority??"NOT_STRUCTURAL_INVALIDATION",
     proposedReview:readiness?.proposedReview??null,
     countIdentityStatus:record?.countIdentityStatus??"NOT_PUBLISHED"},
   provenance:{engine:"ENGINE22",path:record?.modelSource??null,
     modelVersion:record?.activeModel??null,
     expectedModelVersion:record?.expectedModelVersion??null,
     countId:record?.sourceCountId??null,ownerCompatible:Boolean(record?.activeModel),
     sourceSchema:schemaOk?packet.schema:null},
   noExecution:true,noPermissionCreated:true,noJournalWrite:true
  };
 }
 return {schema:"engine27.sevenInvalidations.v2",mode:"READ_ONLY",degrees:entries,degreeOrder:DEGREES,
  publishedCount:DEGREES.filter(d=>entries[d].status==="PUBLISHED").length,
  reviewCount:DEGREES.filter(d=>entries[d].review.status==="REVIEW_ONLY").length,
  sourceStatus:schemaOk?packet.status:"ENGINE22_AUTHORITY_UNAVAILABLE",
  noExecution:true,noPermissionCreated:true,noJournalWrite:true};
}
