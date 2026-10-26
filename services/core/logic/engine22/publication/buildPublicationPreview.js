// Engine22H: additive sidecar preview; never replaces a published strategy packet.
import {compareEngine22V3ProtectedOutputs} from "../v3/compareProtectedContracts.js";
const DEGREES=["INTRADAY_SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"];
export function buildEngine22CanonicalPublicationPreview({legacy=null,degreeRecords=null}={}){
 const fail=reason=>({available:false,reasonCodes:[reason],publishAuthorized:false,shadowOnly:true,noExecution:true});
 if(!legacy||typeof legacy!=="object"||!degreeRecords||typeof degreeRecords!=="object")return fail("LEGACY_AND_SEVEN_DEGREES_REQUIRED");
 if(!DEGREES.every(d=>degreeRecords[d]&&degreeRecords[d].degreeId===d))
   return fail("INCOMPLETE_SEVEN_DEGREE_PACKET");
 const nodes=DEGREES.map(d=>{
   const x=degreeRecords[d];
   return {degreeId:d,countId:x.countId??null,modelVersion:x.modelVersion??null,
     lifecycle:x.lifecycle??"UNCONFIRMED",provenanceStatus:x.provenanceStatus??"UNVERIFIED",
     canonicalActiveVerified:false};
 });
 if(nodes.some(x=>typeof x.countId==="string"&&/^ES-V3-BASELINE-/i.test(x.countId)))
   return fail("SYNTHETIC_COUNT_IN_PUBLICATION_PREVIEW");
 const candidate=structuredClone(legacy);
 candidate.engine22HPreview={schema:"engine22.canonicalPublicationPreview.v1",
   degrees:nodes,shadowOnly:true,publishAuthorized:false};
 const compared=compareEngine22V3ProtectedOutputs({legacy,candidate});
 return {available:true,schema:"engine22.canonicalPublicationPreview.v1",
   protectedContractsUnchanged:compared.pass,reasonCodes:compared.pass?["SHADOW_ONLY_NO_CUTOVER"]:compared.reasonCodes,
   packet:candidate.engine22HPreview,publishAuthorized:false,
   noExecution:true,noPermissionCreated:true,shadowOnly:true};
}
