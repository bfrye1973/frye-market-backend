// Read-only Engine 22 Submicro/Micro structural agreement diagnostic for Engine 3.
// Cannot create control, direction, qualification, or execution permission.
// Input snapshot MUST be point-in-time when used in historical Replay.
import {readAuthorizedWorkingStructure} from "../engine27/v2/readAuthorizedWorkingStructure.js";

const CONTROL_DIRECTION = Object.freeze({BUYERS_CONTROL:"UP",SELLERS_CONTROL:"DOWN"});
const STATES = Object.freeze({
  FULL_BEARISH_ALIGNMENT:"FULL_BEARISH_ALIGNMENT",
  FULL_BULLISH_ALIGNMENT:"FULL_BULLISH_ALIGNMENT",
  PARTIAL_ALIGNMENT:"PARTIAL_ALIGNMENT",
  CONFLICT:"CONFLICT",
  NO_STRUCTURAL_CONTEXT:"NO_STRUCTURAL_CONTEXT",
  STRUCTURE_PRESENT_PRICE_ACTION_UNRESOLVED:"STRUCTURE_PRESENT_PRICE_ACTION_UNRESOLVED",
});
function safe(value) { return typeof value==="string" ? value.trim().toUpperCase() : ""; }
function published(degree) {
  return {direction:degree?.direction??null,wave:degree?.activeWave??null,
    sourcePath:degree?.sourcePath??null,selectionStatus:degree?.selectionStatus??null};
}
export function buildEngine22StructuralContext({
  snapshot=null,priceActionControl=null,evaluationTimeMs=null,maxPublicationAgeMs=null,
}={}) {
  const authorized=readAuthorizedWorkingStructure(snapshot);
  const publishAtMs=Date.parse(authorized.publication?.publishedAt??"");
  const asOfMs=Number.isFinite(evaluationTimeMs) ? evaluationTimeMs : Date.parse(snapshot?.generatedAt??"");
  const asOfKnown=Number.isFinite(asOfMs);
  const publishedKnown=Number.isFinite(publishAtMs);
  const lookahead=authorized.available && asOfKnown && (!publishedKnown || publishAtMs>asOfMs);
  const tooOld=authorized.available && asOfKnown && publishedKnown &&
    Number.isFinite(maxPublicationAgeMs) && maxPublicationAgeMs>=0 &&
    asOfMs-publishAtMs>maxPublicationAgeMs;
  const contextAvailable=authorized.available && !lookahead && !tooOld;
  const control=safe(priceActionControl?.controlState);
  const priceDirection=CONTROL_DIRECTION[control]??null;
  const submicro=contextAvailable ? published(authorized.publication.degrees.submicro) : published(null);
  const micro=contextAvailable ? published(authorized.publication.degrees.micro) : published(null);
  let alignmentState=STATES.NO_STRUCTURAL_CONTEXT;
  if (contextAvailable && !priceDirection) {
    alignmentState=STATES.STRUCTURE_PRESENT_PRICE_ACTION_UNRESOLVED;
  } else if (contextAvailable) {
    const dirs=[submicro.direction,micro.direction];
    const matches=priceDirection ? dirs.filter(d=>d===priceDirection).length : 0;
    const opposites=priceDirection ? dirs.filter(d=>d==="UP"||d==="DOWN").filter(d=>d!==priceDirection).length : 0;
    if (matches===2) alignmentState=priceDirection==="DOWN"?STATES.FULL_BEARISH_ALIGNMENT:STATES.FULL_BULLISH_ALIGNMENT;
    else if (matches>0 && opposites===0) alignmentState=STATES.PARTIAL_ALIGNMENT;
    else if (opposites>0) alignmentState=STATES.CONFLICT;
  }
  return {
    schema:"engine3.engine22StructuralContext.v1",
    source:"engine22WaveStrategy.authorizedWorkingStructure",
    available:contextAvailable,
    structureAvailable:contextAvailable,
    sourceReasonCode:lookahead?"ENGINE22_PUBLICATION_AFTER_EVALUATION":tooOld?"ENGINE22_PUBLICATION_OLDER_THAN_POLICY":authorized.reasonCode,
    sourceRevision:authorized.publication?.publicationRevision??null,
    sourcePublishedAt:authorized.publication?.publishedAt??null,
    sourceFingerprint:authorized.publication?.modelFingerprint??null,
    asOfVerified:asOfKnown && publishedKnown && !lookahead,
    evaluationTime:asOfKnown?new Date(asOfMs).toISOString():null,
    publicationAgeMs:asOfKnown && publishedKnown?asOfMs-publishAtMs:null,
    waveMaturity:"UNAVAILABLE",
    submicroDirection:submicro.direction,submicroWave:submicro.wave,
    microDirection:micro.direction,microWave:micro.wave,
    priceActionControlState:control||"NO_CONTROL",
    priceActionDirection:priceDirection,
    alignmentWithPriceAction:priceDirection,
    alignmentState,
    diagnosticOnly:true,canonicalControlAuthority:false,canonicalDirectionAuthority:false,
    qualificationAuthority:false,noPermissionCreated:true,noExecution:true,
  };
}
export default buildEngine22StructuralContext;
