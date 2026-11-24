#!/usr/bin/env node
// Engine3 v6 Phase C experimental A/C comparison. OFFLINE / READ-ONLY.
// Does NOT reach production, trigger orders, record licensed market data,
// or substitute retrospective candles for original Engine12 decision truth.
//
// Input file: { "rows": [{ "replay": <PhaseA compact decision row>,
//                        "fixture": <runEngine3V6ResearchFixture input>,
//                        "asOfReplayVerified": true }], ... }
// Bar file: plain text CSV exactly as in Phase A's bar manifest.
// Missing original authorization/fixture data makes the comparison INCOMPLETE,
// not a fictitious v6 "zero-signal victory".
import fs from "node:fs";
import crypto from "node:crypto";
import {runEngine3V6ResearchFixture} from "../../../services/core/logic/engine3/v6/runEngine3V6ResearchFixture.js";
import {scorePhaseA} from "./phaseAHarness.core.js";

const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>
  x.startsWith("--")?[...a,[x.slice(2),all[i+1]]]:a,[]));
const fail=(reason)=>{process.stderr.write("PHASE_C_INCOMPLETE: "+reason+"\n");process.exit(2)};
if(!args.packets||!args.bars||!args["bars-sha256"]||!args.out)
  fail("Need --packets, --bars, --bars-sha256, --out; never fetch unlicensed bars");
const file=JSON.parse(fs.readFileSync(args.packets,"utf8"));
if(!Array.isArray(file.rows)||!file.rows.length)
  fail("REPLAY_FIXTURE_ROWS_MISSING");
const rawBars=fs.readFileSync(args.bars,"utf8").trim();
const barHash=crypto.createHash("sha256").update(rawBars).digest("hex");
if(barHash.toLowerCase()!==String(args["bars-sha256"]).toLowerCase())
  fail("PHASE_A_BAR_SHA256_MISMATCH");
const bars=rawBars.split("\n").map(line=>{
 const [t,o,h,l,c,v]=line.split(",").map(Number);
 if(![t,o,h,l,c,v].every(Number.isFinite))fail("INVALID_CANDLE_CSV");
 return {t,o,h,l,c,v};
});
if(!bars.every((x,i)=>i===0||x.t>bars[i-1].t))fail("NON_MONOTONIC_BAR_SERIES");
const ordered=[...file.rows].sort((a,b)=>
  Date.parse(a?.replay?.snap||0)-Date.parse(b?.replay?.snap||0));
const canonical=[],shadow=[],audit=[];let priorShadow=null;
for(const [i,item] of ordered.entries()){
 const r=item?.replay,packet=item?.fixture;
 if(!r||!r.snap||!Number.isFinite(Date.parse(r.snap)))
   fail("INVALID_REPLAY_ROW_AT_INDEX_"+i);
 canonical.push(r);
 if(item.asOfReplayVerified!==true||!packet||
     packet.evaluationTimeMs!==Date.parse(r.snap)){
  audit.push({snapshot:r.snap,reason:"MISSING_OR_UNVERIFIED_AS_OF_V6_PACKET"});
  shadow.push({...r,e3:"NEUTRAL",e3q:null});
  priorShadow=null;continue;
 }
 // Do not invent Engine26 authorizationStartedAt. Readiness below gates the
 // *research comparator* even though the pure v6 runner can label uncertainty.
 const packetInput={...packet,priorShadow};
 const out=runEngine3V6ResearchFixture(packetInput);
 if(out.readiness?.status!=="AUTHORITATIVE_TIMESTAMP_VALID"){
  audit.push({snapshot:r.snap,reason:"ENGINE26_AUTHORIZATION_PROVENANCE_UNVERIFIED",
    source:out.readiness?.status??"UNKNOWN"});
  shadow.push({...r,e3:"NEUTRAL",e3q:null});
  priorShadow=null;continue;
 }
 const direction=out.shadow?.canonicalDirection??"NEUTRAL";
 const quality=out.causal?.control?.quality??null;
 shadow.push({...r,e3:direction,e3q:quality});
 priorShadow=out.nextShadowState;
 audit.push({snapshot:r.snap,reason:"ADMITTED_SHADOW_RESEARCH",
   direction,quality,breakout:out.breakoutAttestation?.status,
   transition:out.trace?.transition});
}
const valid=audit.every(x=>x.reason==="ADMITTED_SHADOW_RESEARCH");
const baseline=scorePhaseA(canonical,bars);
const result={
 schema:"engine3.phaseC.acComparison.v1",status:valid?"EXPLORATORY_COMPLETE":"INCOMPLETE_MISSING_CAUSAL_EVIDENCE",
 mode:"OFFLINE_READ_ONLY",noPermissionCreated:true,noExecution:true,
 provenance:{canonical:"ENGINE12_AS_OF_IF_SOURCE_ATTESTED",
   v6:"RECOMPUTED_OFFLINE_SHADOW",
   bars:"RETROSPECTIVE_OHLC_ORIGINAL_ARRIVAL_FINALITY_CONTRACT_UNKNOWN",
   barsSha256:barHash,barCount:bars.length},
 baseline:baseline.summary.e3,
 // Do not report apparent v6 zero-call performance for inadmissible snapshots.
 v6:valid?scorePhaseA(shadow,bars).summary.e3:null,
 counts:{total:ordered.length,admitted:audit.filter(x=>x.reason==="ADMITTED_SHADOW_RESEARCH").length,
   missing:audit.filter(x=>x.reason!=="ADMITTED_SHADOW_RESEARCH").length},
 audit,
 noCanonicalPromotion:true,notSection6Acceptance:true,
};
fs.writeFileSync(args.out,JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,baseline:result.baseline,v6:result.v6,counts:result.counts},null,2));
if(!valid)process.exitCode=2;
