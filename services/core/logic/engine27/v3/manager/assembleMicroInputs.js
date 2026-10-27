import {readAuthorizedWorkingStructure} from "../engine22/readAuthorizedWorkingStructure.js";
import { MICRO_INPUT_SCHEMA } from "../contracts/manager.v1.js";
const timestamp=s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
export function assembleMicroInputs({
 snapshot=null,evaluatedAt=null,engine25=null,engine29=null,
 crossMarketLevels=null,crossMarketReactions=null,
 esInstitutionalContext=null,journal=null,officialPlans=[],replay=null
}={}){
 const reasonCodes=[];
 const at=evaluatedAt??snapshot?.now??snapshot?.ts??null;
 if(snapshot?.symbol!=="ES")reasonCodes.push("SNAPSHOT_ES_IDENTITY_UNAVAILABLE");
 if(!timestamp(at))reasonCodes.push("EVALUATION_TIMESTAMP_UNAVAILABLE");
 const authorized=readAuthorizedWorkingStructure(snapshot);
 const hasPublication=Boolean(snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.authorizedWorkingStructure);
 const legacyOwner=!hasPublication?snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.currentWavelength?.degrees?.micro?.ownerMicroCDown:null;
 if(hasPublication&&!authorized.available)reasonCodes.push(authorized.reasonCode);
 if(!hasPublication&&legacyOwner?.version!=="engine22.microCDownOwnerWatch.v1")reasonCodes.push("MICRO_OWNER_MODEL_UNAVAILABLE");
 const owner=authorized.available?authorized.publication.degrees.micro:legacyOwner;
 return {contract:{schema:MICRO_INPUT_SCHEMA,mode:"READ_ONLY",qualified:reasonCodes.length===0,
 degree:"micro",evaluatedAt:at,ownerVersion:owner?.modelVersion??owner?.version??null,reasonCodes},
 sources:{snapshot,evaluatedAt:at,engine25,engine29,crossMarketLevels,crossMarketReactions,
 esInstitutionalContext,journal,officialPlans,replay}};
}
