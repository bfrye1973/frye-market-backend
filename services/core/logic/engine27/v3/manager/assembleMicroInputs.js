import { MICRO_INPUT_SCHEMA } from "../contracts/manager.v1.js";
const timestamp=s=>typeof s==="string" && Number.isFinite(Date.parse(s));
export function assembleMicroInputs({
 snapshot=null,esBars10m=null,esBarSource=null,evaluatedAt=null,
 engine25=null,engine29=null,crossMarketLevels=null,crossMarketReactions=null,
 esInstitutionalContext=null,journal=null,officialPlans=[],replay=null
}={}){
 const reasonCodes=[];
 const at=evaluatedAt??snapshot?.now??snapshot?.ts??null;
 if(snapshot?.symbol!=="ES")reasonCodes.push("SNAPSHOT_ES_IDENTITY_UNAVAILABLE");
 if(!timestamp(at))reasonCodes.push("EVALUATION_TIMESTAMP_UNAVAILABLE");
 // Caller must attest exact data origin. Refuse guessed bar time units.
 if(esBarSource?.symbol!=="ES"||esBarSource?.timeframe!=="10m"||
 esBarSource?.timestampUnit!=="UNIX_SECONDS_BAR_START"||
 esBarSource?.sourceQualified!==true||typeof esBarSource?.source!=="string")
 reasonCodes.push("ES_BAR_PROVENANCE_NOT_VERIFIED");
 if(!Array.isArray(esBars10m))reasonCodes.push("ES_COMPLETED_BARS_UNAVAILABLE");
 const owner=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.currentWavelength?.degrees?.micro?.ownerMicroCDown;
 if(owner?.version!=="engine22.microCDownOwnerWatch.v1")reasonCodes.push("MICRO_OWNER_MODEL_UNAVAILABLE");
 return {contract:{schema:MICRO_INPUT_SCHEMA,mode:"READ_ONLY",qualified:reasonCodes.length===0,degree:"micro",
 evaluatedAt:at,ownerVersion:owner?.version??null,esBarProvenance:esBarSource??null,reasonCodes},
 sources:{snapshot,esBars10m,evaluatedAt:at,engine25,engine29,crossMarketLevels,crossMarketReactions,
 esInstitutionalContext,journal,officialPlans,replay}};
}
