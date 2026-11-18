// Engine11 original-response receipt preflight — PURE, SYNTHETIC ONLY.
// This verifies bytes + a known issuer's signature; it does not prove that
// the issuer had provider entitlement, independent clock quality, or final bars.
// Never return REAL_SOURCE_ATTESTED from this isolated utility.
import {createHash,verify} from "node:crypto";

export const ENGINE11_ORIGINAL_RECEIPT_SCHEMA=
  "engine11.es.originalByteReceipt.v1";
const hex64=v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const nonblank=v=>typeof v==="string"&&v.trim().length>0;
const time=v=>Number.isSafeInteger(v)&&v>0;
const stages=new Set(["ORIGINAL_CAPTURE","HISTORICAL_REFETCH"]);
const sortCanonical=v=>{
  if(Array.isArray(v))return v.map(sortCanonical);
  if(v&&typeof v==="object"&&!Buffer.isBuffer(v)){
    return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortCanonical(v[k])]));
  }
  return v;
};
export const sourceReceiptCanonicalBytes=source=>
  Buffer.from(JSON.stringify(sortCanonical(source)),"utf8");
export const sourceReceiptDigest=source=>
  createHash("sha256").update(sourceReceiptCanonicalBytes(source)).digest("hex");
export const originalBodyDigest=bytes=>
  createHash("sha256").update(bytes).digest("hex");

export function inspectOriginalSourceReceipt({
  originalBytes,receipt,issuerPublicKey=null,evaluationTimeMs=null,
}={}){
  const reasons=[];
  const bad=x=>{if(!reasons.includes(x))reasons.push(x);};
  if(!Buffer.isBuffer(originalBytes)||originalBytes.length===0)
    bad("ENGINE11_ORIGINAL_BYTES_MISSING");
  if(receipt?.schema!==ENGINE11_ORIGINAL_RECEIPT_SCHEMA||
     !nonblank(receipt?.issuerKeyId)||!nonblank(receipt?.sourceCaptureId)||
     receipt?.providerId!=="MASSIVE_POLYGON"||
     receipt?.sourceSymbol!=="ES"||
     !/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(receipt?.physicalContract||"")||
     !stages.has(receipt?.captureMode)||
     !nonblank(receipt?.requestPath)||receipt.requestPath.includes("?")||
     ![200,206].includes(receipt?.httpStatus)||
     !nonblank(receipt?.parserVersion)||!nonblank(receipt?.configVersion))
      bad("ENGINE11_SOURCE_RECEIPT_CONTEXT_INVALID");
  if(!hex64(receipt?.rawBodySha256)||!Number.isSafeInteger(receipt?.rawByteLength)||
     (Buffer.isBuffer(originalBytes)&&
       (receipt.rawByteLength!==originalBytes.length||
        receipt.rawBodySha256!==originalBodyDigest(originalBytes))))
      bad("ENGINE11_ORIGINAL_BYTES_DIGEST_MISMATCH");
  if(!time(receipt?.requestStartedAtMs)||!time(receipt?.firstByteAtMs)||
     !time(receipt?.bodyCompletedAtMs)||
     receipt.requestStartedAtMs>receipt.firstByteAtMs||
     receipt.firstByteAtMs>receipt.bodyCompletedAtMs||
     !Number.isFinite(receipt?.requestToFirstByteMonoMs)||
     receipt.requestToFirstByteMonoMs<0||
     !Number.isFinite(receipt?.requestToBodyMonoMs)||
     receipt.requestToBodyMonoMs<receipt.requestToFirstByteMonoMs)
     bad("ENGINE11_SOURCE_CAPTURE_CLOCK_FIELDS_INVALID");
  if(!time(evaluationTimeMs)||!time(receipt?.bodyCompletedAtMs)||
     receipt.bodyCompletedAtMs>evaluationTimeMs)
     bad("ENGINE11_RECEIPT_AFTER_EVALUATION");
  if(receipt?.captureMode!=="ORIGINAL_CAPTURE")
     bad("ENGINE11_HISTORICAL_REFETCH_NOT_ASOF_EVIDENCE");
  const unsigned=receipt?.unsignedEnvelope;
  if(!unsigned||typeof unsigned!=="object"||Array.isArray(unsigned)||
     unsigned.schema!==receipt?.schema ||
     unsigned.sourceCaptureId!==receipt?.sourceCaptureId||
     unsigned.issuerKeyId!==receipt?.issuerKeyId||
     unsigned.providerId!==receipt?.providerId||
     unsigned.sourceSymbol!==receipt?.sourceSymbol||
     unsigned.physicalContract!==receipt?.physicalContract||
     unsigned.rawBodySha256!==receipt?.rawBodySha256||
     unsigned.rawByteLength!==receipt?.rawByteLength||
     unsigned.captureMode!==receipt?.captureMode||
     unsigned.requestPath!==receipt?.requestPath||
     unsigned.httpStatus!==receipt?.httpStatus||
     unsigned.parserVersion!==receipt?.parserVersion||
     unsigned.configVersion!==receipt?.configVersion||
     unsigned.requestStartedAtMs!==receipt?.requestStartedAtMs||
     unsigned.firstByteAtMs!==receipt?.firstByteAtMs||
     unsigned.bodyCompletedAtMs!==receipt?.bodyCompletedAtMs||
     unsigned.requestToFirstByteMonoMs!==receipt?.requestToFirstByteMonoMs||
     unsigned.requestToBodyMonoMs!==receipt?.requestToBodyMonoMs)
     bad("ENGINE11_SIGNED_ENVELOPE_CONTEXT_MISMATCH");
  if(!hex64(receipt?.unsignedEnvelopeSha256)||
     !unsigned||receipt.unsignedEnvelopeSha256!==sourceReceiptDigest(unsigned))
     bad("ENGINE11_SIGNED_ENVELOPE_HASH_MISMATCH");
  // Public key must be provided independently, never from the caller envelope.
  let signatureValid=false;
  try{
    if(issuerPublicKey&&typeof receipt?.issuerSignatureBase64==="string"&&
       /^[a-zA-Z0-9+/]+={0,2}$/.test(receipt.issuerSignatureBase64)&&unsigned)
      signatureValid=verify(null,sourceReceiptCanonicalBytes(unsigned),
        issuerPublicKey,Buffer.from(receipt.issuerSignatureBase64,"base64"));
  }catch{}
  if(!signatureValid)bad("ENGINE11_INDEPENDENT_ISSUER_SIGNATURE_INVALID");
  if(receipt?.clockQuality!=="VERIFIED"||
     !Number.isFinite(receipt?.maxUtcUncertaintyMs)||
     receipt.maxUtcUncertaintyMs<0||
     !nonblank(receipt?.independentClockSampleId))
     bad("RECEIPT_CLOCK_UNVERIFIED");
  if(receipt?.entitlementMode!=="LIVE_ENTITLED"||
     receipt?.storagePermissionVerified!==true)
     bad("ENGINE11_PROVIDER_ENTITLEMENT_OR_LICENSE_UNVERIFIED");
  if(receipt?.providerFinality!=="CONFIRMED"||
     !nonblank(receipt?.finalityEvidenceId))
     bad("ENGINE11_PROVIDER_FINALITY_UNVERIFIED");

  return Object.freeze({
    schema:"engine11.originalByteReceiptPreflight.v1",
    checkedOriginalBytes:Buffer.isBuffer(originalBytes)?originalBytes.length:0,
    cryptographicIssuerAndBodyValid:signatureValid &&
      !reasons.some(x=>x==="ENGINE11_ORIGINAL_BYTES_DIGEST_MISMATCH"||
        x==="ENGINE11_SIGNED_ENVELOPE_HASH_MISMATCH"||
        x==="ENGINE11_SIGNED_ENVELOPE_CONTEXT_MISMATCH"),
    preflightPass:reasons.length===0,reasons,
    independentProviderTrustEstablished:false,
    verificationMode:"SYNTHETIC_SANDBOX_ONLY",
    calibrationAdmissible:false,recordingActivated:false,writerInvoked:false,
  });
}
