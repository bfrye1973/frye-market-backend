import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3RawBarArchivePacket as prepare}
 from "../logic/engine3/v6/buildEngine3RawBarArchivePacket.js";
import {auditEngine3RawBarPacketForCalibration as audit}
 from "../logic/engine3/v6/auditEngine3RawBarPacketForCalibration.js";
const t=Date.parse("2026-11-17T17:00:00Z");
const bar=(duration,close)=>({time:(close-duration)/1000,
 open:100,high:101,low:99,close:100});
const packet=()=>prepare({evaluationTimeMs:t,
 bars1m:[bar(60000,t)],bars5m:[bar(300000,t)],bars10m:[bar(600000,t)],
 engine26:{candidateId:"C",zoneId:"Z",
  engine3AuthorizationStartedAt:new Date(t-600000).toISOString()},
 activation:{activationSource:"ENGINE26_AUTHORIZED",activationStartedAtMs:t-600000}});
test("preparation packet without approved source/writer is inadmissible",()=>{
 const p=packet();
 assert.equal(p.ok,true);
 const result=audit({prepared:p});
 assert.equal(result.calibrationAdmissible,false);
 assert.equal(result.failClosed,true);
 assert.ok(result.issues.includes("BAR_SOURCE_PROVENANCE_NOT_VERIFIED"));
 assert.ok(result.issues.includes("WRITER_AND_STORAGE_OWNER_UNVERIFIED"));
 assert.ok(result.issues.includes("DURABILITY_AND_FAILURE_SAFETY_UNVERIFIED"));
 assert.ok(result.issues.includes("END_TO_END_CHECKSUM_READBACK_UNVERIFIED"));
 assert.equal(result.writerInvoked,false);assert.equal(result.recorderActivatedByAudit,false);
});
test("observed activation cannot be asserted authoritative for historical calibration",()=>{
 const p=prepare({evaluationTimeMs:t,
  bars1m:[bar(60000,t)],bars5m:[bar(300000,t)],bars10m:[bar(600000,t)],
  engine26:{candidateId:"C",zoneId:"Z"},
  activation:{activationSource:"ENGINE3_OBSERVED",activationStartedAtMs:t}});
 const result=audit({prepared:p});
 assert.ok(result.issues.includes("OBSERVED_ACTIVATION_NOT_AUTHORITATIVE"));
 assert.equal(result.calibrationAdmissible,false);
});
test("invalid or future synthetic bar cannot pass even with claimed storage proof",()=>{
 const p=packet();
 const altered=structuredClone(p);
 altered.packet.completedBars["1m"][0].endMs=t+60000;
 const result=audit({prepared:altered,storageReceipt:{sha256:p.sha256},
  readback:{sha256:p.sha256}});
 assert.ok(result.issues.includes("INVALID_OR_FUTURE_BAR_1m"));
 assert.ok(result.issues.includes("END_TO_END_CHECKSUM_READBACK_UNVERIFIED"));
});
test("missing timeframes and unverified source identity remain visible fail-closed",()=>{
 const p=packet();
 const altered=structuredClone(p);
 altered.packet.completedBars["10m"]=[];
 altered.packet.engine26.candidateId=null;
 const result=audit({prepared:altered});
 assert.ok(result.issues.includes("EMPTY_TIMEFRAME_10m"));
 assert.ok(result.issues.includes("MISSING_ENGINE26_IDENTITY"));
 assert.equal(result.failClosed,true);
});
test("no receipt from restart, disk-full or backpressure means calibration denied",()=>{
 const p=packet();
 const source={provider:"VENDOR",feedId:"SOURCE",contractId:"ESZ6",
  priceBasis:"EXPLICIT",rollPolicy:"EXPLICIT",clockProvenance:"VERIFIED",
  barCompletionMethod:"EXPLICIT",observedAsOfTimeMs:t};
 const storage={owner:"TBD",writerOwnerApproved:true,writerVersion:"1",
  immutableNamespace:"test",durablyCommitted:true,writeMode:"EXCLUSIVE_NO_OVERWRITE",
  restartReconciled:false,diskFailureFailClosed:false,backpressureFailClosed:false,
  sha256:p.sha256,dedupeKey:p.dedupeKey};
 const result=audit({prepared:p,sourceEvidence:source,storageReceipt:storage,
  readback:{sha256:p.sha256,dedupeKey:p.dedupeKey}});
 assert.ok(result.issues.includes("DURABILITY_AND_FAILURE_SAFETY_UNVERIFIED"));
 assert.equal(result.calibrationAdmissible,false);
});
