import test from "node:test";
import assert from "node:assert/strict";
import {studyWaveNegotiatedZone} from "../waveObservation/studyWaveNegotiatedZone.js";
const candidate={zoneId:"zone-1",candidateId:"candidate-1",location:{type:"NEGOTIATED"},
 entryZone:{low:7780,high:7790,midline:7785},activationRangePoints:3};
const at="2026-10-28T18:30:00Z";
test("measures inside-zone extreme without assuming completion",()=>{
 const r=studyWaveNegotiatedZone({waveExtremePrice:7783,engine26Candidate:candidate,sourceSnapshotTime:at});
 assert.equal(r.available,true);assert.equal(r.relation,"INSIDE");
 assert.equal(r.distancePoints,0);assert.equal(r.distanceToMidpointPoints,2);
 assert.equal(r.waveCompletionConfirmed,false);assert.equal(r.zoneId,"zone-1");
});
test("distance outside zone uses nearest boundary rather than midpoint",()=>{
 const r=studyWaveNegotiatedZone({waveExtremePrice:7772,engine26Candidate:candidate,sourceSnapshotTime:at});
 assert.equal(r.distancePoints,8);assert.equal(r.signedDistancePoints,-8);
 assert.equal(r.relation,"BELOW");assert.equal(r.distanceToMidpointPoints,13);
});
test("rejects invalid or non-negotiated zone and missing original timestamp",()=>{
 assert.equal(studyWaveNegotiatedZone({waveExtremePrice:7772,engine26Candidate:{...candidate,location:{type:"OTHER"}},sourceSnapshotTime:at}).available,false);
 assert.equal(studyWaveNegotiatedZone({waveExtremePrice:7772,engine26Candidate:candidate}).available,false);
 assert.equal(studyWaveNegotiatedZone({waveExtremePrice:7772,engine26Candidate:{...candidate,entryZone:{low:7790,high:7780}},sourceSnapshotTime:at}).available,false);
});
