import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
 ENGINE11_ORIGINAL_RECEIPT_SCHEMA,inspectOriginalSourceReceipt,
 originalBodyDigest,sourceReceiptDigest,sourceReceiptCanonicalBytes
} from "../logic/engine11/candleProvenanceV1/inspectOriginalSourceReceipt.js";

const now=Date.UTC(2026,10,18,15,30,0);
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const anotherKey=generateKeyPairSync("ed25519").publicKey;
const raw=Buffer.from('{"results":[{"ticker":"ESZ6","window_start":"1795015800000000000","open":7000,"high":7001,"low":6999,"close":7000.25}]}');
const unsigned=()=>({
 schema:ENGINE11_ORIGINAL_RECEIPT_SCHEMA,
 issuerKeyId:"SYNTHETIC_KEY_ONLY",sourceCaptureId:"SYNTHETIC_CAPTURE_1",
 providerId:"MASSIVE_POLYGON",sourceSymbol:"ES",physicalContract:"ESZ6",
 rawBodySha256:originalBodyDigest(raw),rawByteLength:raw.length,
 captureMode:"ORIGINAL_CAPTURE",requestPath:"/futures/v1/aggs/ESZ6",
 httpStatus:200,parserVersion:"TEST_PARSER",configVersion:"TEST_CONFIG",
 requestStartedAtMs:now-300,firstByteAtMs:now-250,bodyCompletedAtMs:now-100,
 requestToFirstByteMonoMs:50,requestToBodyMonoMs:200,
 clockQuality:"VERIFIED",maxUtcUncertaintyMs:2,
 independentClockSampleId:"SYNTHETIC_CLOCK_ONLY",
 entitlementMode:"LIVE_ENTITLED",storagePermissionVerified:true,
 providerFinality:"CONFIRMED",finalityEvidenceId:"SYNTHETIC_FINALITY_ONLY"
});
const fixture=(changes={})=>{
 const env={...unsigned(),...changes};
 return {...env,unsignedEnvelope:env,
  unsignedEnvelopeSha256:sourceReceiptDigest(env),
  issuerSignatureBase64:sign(null,sourceReceiptCanonicalBytes(env),privateKey).toString("base64")};
};
const inspect=(receipt,originalBytes=raw,key=publicKey,time=now)=>inspectOriginalSourceReceipt({
 receipt,originalBytes,issuerPublicKey:key,evaluationTimeMs:time
});
const fails=(receipt,reason,bytes=raw,key=publicKey,time=now)=>
 assert.ok(inspect(receipt,bytes,key,time).reasons.includes(reason),reason);

test("sandbox read-only independent byte reopening and Ed25519 verification, NEVER real-trust promotion",()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"engine11-issuer-test-"));
 try{
  const filename=path.join(root,"source.fixture");
  writeFileSync(filename,raw,{flag:"wx",mode:0o600});
  const opened=readFileSync(filename);
  const v=inspect(fixture(),opened);
  assert.equal(v.preflightPass,true);
  assert.equal(v.cryptographicIssuerAndBodyValid,true);
  assert.equal(v.independentProviderTrustEstablished,false);
  assert.equal(v.verificationMode,"SYNTHETIC_SANDBOX_ONLY");
  assert.equal(v.calibrationAdmissible,false);
  assert.equal(v.writerInvoked,false);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test("raw provider bytes modification fails SHA",()=>{
 const modified=Buffer.from(raw);modified[modified.length-2]=0x32;
 fails(fixture(),"ENGINE11_ORIGINAL_BYTES_DIGEST_MISMATCH",modified);
});
test("signature from unknown independent issuer key fails",()=>{
 fails(fixture(),"ENGINE11_INDEPENDENT_ISSUER_SIGNATURE_INVALID",raw,anotherKey);
});
test("receipt mutation after signature fails even with same raw body",()=>{
 const r=fixture();r.bodyCompletedAtMs+=10;
 fails(r,"ENGINE11_SIGNED_ENVELOPE_CONTEXT_MISMATCH");
});
test("self-declared LICENSE/entitlement status cannot be modified after signed capture",()=>{
 const r=fixture();r.entitlementMode="DELAYED";
 fails(r,"ENGINE11_SIGNED_ENVELOPE_CONTEXT_MISMATCH");
 fails(r,"ENGINE11_PROVIDER_ENTITLEMENT_OR_LICENSE_UNVERIFIED");
});
test("self-declared clock trust cannot be modified after signed capture",()=>{
 const r=fixture();r.clockQuality="UNVERIFIED";
 fails(r,"ENGINE11_SIGNED_ENVELOPE_CONTEXT_MISMATCH");
 fails(r,"RECEIPT_CLOCK_UNVERIFIED");
});
test("synthetic independently signed uncertainty UNKNOWN remains untrusted",()=>{
 const r=fixture({clockQuality:"UNVERIFIED",maxUtcUncertaintyMs:null,independentClockSampleId:null});
 fails(r,"RECEIPT_CLOCK_UNVERIFIED");
});
test("historical REST refetch cannot prove earlier Engine3 as-of",()=>{
 const r=fixture({captureMode:"HISTORICAL_REFETCH"});
 fails(r,"ENGINE11_HISTORICAL_REFETCH_NOT_ASOF_EVIDENCE");
});
test("source receipt after Engine3 evaluation fails",()=>{
 fails(fixture(),"ENGINE11_RECEIPT_AFTER_EVALUATION",raw,publicKey,now-200);
});
test("unknown provider entitlement, storage rights and finality explicitly fail closed",()=>{
 const r=fixture({entitlementMode:"UNKNOWN",storagePermissionVerified:false,
  providerFinality:"UNKNOWN",finalityEvidenceId:null});
 fails(r,"ENGINE11_PROVIDER_ENTITLEMENT_OR_LICENSE_UNVERIFIED");
 fails(r,"ENGINE11_PROVIDER_FINALITY_UNVERIFIED");
});
test("missing original source bytes, changed ES contract and bad raw digest fail closed",()=>{
 const r=fixture();r.physicalContract="ESU6";
 fails(r,"ENGINE11_SIGNED_ENVELOPE_CONTEXT_MISMATCH");
 const v=inspect(fixture(),null);
 assert.ok(v.reasons.includes("ENGINE11_ORIGINAL_BYTES_MISSING"));
});
test("reject credential-bearing paths and invalid signature hashes",()=>{
 const r=fixture({requestPath:"/futures/v1/aggs/ESZ6?apiKey=redacted"});
 fails(r,"ENGINE11_SOURCE_RECEIPT_CONTEXT_INVALID");
 const r2=fixture();r2.unsignedEnvelopeSha256="0".repeat(64);
 fails(r2,"ENGINE11_SIGNED_ENVELOPE_HASH_MISMATCH");
});
