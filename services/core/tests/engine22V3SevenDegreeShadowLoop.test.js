import test from "node:test";
import assert from "node:assert/strict";
import {ENGINE22_V3_SCHEMA,ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT} from "../logic/engine22/v3/canonicalStructure.js";
import {buildEngine22V3ShadowSnapshot} from "../logic/engine22/v3/buildShadowSnapshot.js";
import {buildEngine22V3ContractProjection} from "../logic/engine22/v3/compareProtectedContracts.js";
import {buildEngine22V3OwnerBootstrap} from "../logic/engine22/v3/buildOwnerBootstrap.js";
import {inspectEngine11V2SevenDegreeShadow} from "../logic/engine22/v3/inspectEngine11SourceIdentityShadow.js";
import fs from "node:fs";
const tf={INTRADAY_SUBMICRO:"5m",MICRO:"10m",SUBMINUTE:"1h",
 MINUTE:"4h",MINOR:"1d",INTERMEDIATE:"1w",PRIMARY:"1mo"};
const stamp=i=>new Date(Date.UTC(2026,9,1,0,i*5)).toISOString();
const mark=(price,i)=>({price,time:stamp(i),status:"CONFIRMED"});
const canonical=()=>({
 schema:ENGINE22_V3_SCHEMA,symbol:"ES",sourceTimestamp:stamp(20),
 noPermissionCreated:true,noExecution:true,
 degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((d,i)=>[d,{
  degreeId:d,parentDegree:ENGINE22_V3_PARENT[d],parentWave:null,
  countId:d+"-count",sequenceId:d+"-seq",
  activeWave:"W3",sequenceDirection:"UP",lifecycle:"DEVELOPING",
  anchors:{W1_LOW:mark(100+i*100,0),W1_HIGH:mark(110+i*100,1),
   W2_LOW:mark(105+i*100,2)},
  history:[],provenance:{source:"TEST"},invalidation:{},fibModel:{},
 }])),
});
const bars=d=>[108,111,116,114,112,117,115].map((price,i)=>({
 sourceTimestamp:stamp(i+3),sourceBarId:d+"-"+i,timeframe:tf[d],
 high:price+1,low:price-1,close:price,closed:true,
 time:Date.parse(stamp(i+3))/1000,
}));
const source=(d)=>({structuralEligible:true,coverageComplete:true,
 sourceCountId:d+"-count",seriesId:d+"-series",datasetVersion:"1",
 priceBasis:"CONTINUOUS_ADJUSTED",timeframe:tf[d],bars:bars(d)});
test("single V3 shadow loop has seven independent card read models and leaves official view untouched",()=>{
 const c=canonical(),unchanged=structuredClone(c);
 const sources=Object.fromEntries(ENGINE22_V3_DEGREES.slice(0,5).map(d=>[d,source(d)]));
 const evidence=Object.fromEntries(ENGINE22_V3_DEGREES.slice(0,5).map(d=>[tf[d],bars(d)]));
 const result=buildEngine22V3ShadowSnapshot({
  canonical:c,sourceByDegree:sources,barsByTf:evidence,
  evaluationTimeMs:Date.UTC(2026,10,1),
 });
 assert.equal(result.available,true);
 assert.equal(result.v3LiveShadow.shadowOnly,true);
 assert.equal(result.v3LiveShadow.publishAuthorized,false);
 assert.equal(Object.keys(result.v3LiveShadow.degrees).length,7);
 for(const degree of ENGINE22_V3_DEGREES.slice(0,5)){
  const card=result.v3LiveShadow.degrees[degree.toLowerCase()];
  assert.equal(card.degree,degree);
  assert.equal(card.dataStatus,"SHADOW_READY",degree);
  assert.equal(card.activeWave,"W3");
  assert.equal(card.sourceTimeframe,tf[degree]);
  assert.equal(card.fibonacci.modelType,"EXTENSION");
  assert.equal(card.levels.length,5);
  assert.equal(card.officialFibAuthorityChanged,false);
  assert.equal(card.anchorPromotionAllowed,false);
  assert.equal(card.noExecution,true);
  assert.ok(card.swingHighCount>0,degree);
 }
 for(const degree of ["INTERMEDIATE","PRIMARY"]){
  const card=result.v3LiveShadow.degrees[degree.toLowerCase()];
  assert.equal(card.dataStatus,"INSUFFICIENT_HISTORY");
  assert.equal(card.levels.length,0);
  assert.equal(card.fibonacci.available,false);
 }
 assert.deepEqual(c,unchanged);
 assert.equal(result.degreeStates.degrees.micro.activeWave,"W3");
 assert.equal(result.currentWavelength.degrees.micro.fibModel.available,true);
 assert.equal(result.engine22Display.degrees.micro.noExecution,true);
});
test("node evidence alone never authorizes shadow Fibonacci",()=>{
 const c=canonical();
 const out=buildEngine22V3ShadowSnapshot({canonical:c,barsByTf:{"10m":bars("MICRO")},
  evaluationTimeMs:Date.UTC(2026,10,1)});
 const card=out.v3LiveShadow.degrees.micro;
 assert.equal(card.nodeEvidenceAvailable,true);
 assert.equal(card.dataStatus,"PROVISIONAL_NODE_EVIDENCE");
 assert.ok(card.reasonCodes.includes("VALIDATED_ENGINE11_SOURCE_REQUIRED"));
 assert.equal(card.levels.length,0);
 assert.equal(card.activeWave,c.degrees.MICRO.activeWave);
});
test("wrong-degree provenance fails independently and no wave candidate becomes confirmation",()=>{
 const c=canonical(),s=source("MICRO");s.sourceCountId="SUBMINUTE-count";
 const out=buildEngine22V3ShadowSnapshot({canonical:c,
  sourceByDegree:{MICRO:s,SUBMINUTE:source("SUBMINUTE")}});
 assert.equal(out.v3LiveShadow.degrees.micro.dataStatus,"INSUFFICIENT_HISTORY");
 assert.equal(out.v3LiveShadow.degrees.subminute.dataStatus,"SHADOW_READY");
 assert.equal(out.v3LiveShadow.degrees.micro.lifecycle,"DEVELOPING");
 assert.equal(out.v3LiveShadow.degrees.micro.lifecycleReplay,null);
});
test("shadow touch may be TOUCHED, but canonical lifecycle never advances on Fib alone",()=>{
 const c=canonical(),original=structuredClone(c);
 const out=buildEngine22V3ShadowSnapshot({canonical:c,
  sourceByDegree:{MICRO:source("MICRO")}});
 assert.equal(out.v3LiveShadow.degrees.micro.fibonacci.waveCompletionConfirmed,false);
 assert.equal(out.v3LiveShadow.degrees.micro.lifecycle,"DEVELOPING");
 assert.deepEqual(c,original);
});

test("existing V3 compatibility projection forwards seven-degree sidecar without replacing legacy fields",()=>{
 const c=canonical();
 const shadow=buildEngine22V3ShadowSnapshot({canonical:c,sourceByDegree:{MICRO:source("MICRO")}});
 const projected=buildEngine22V3ContractProjection({shadow});
 assert.equal(projected.available,true);
 assert.equal(projected.v3LiveShadow.shadowOnly,true);
 assert.equal(Object.keys(projected.v3LiveShadow.degrees).length,7);
 assert.equal(projected.v3LiveShadow.degrees.micro.dataStatus,"SHADOW_READY");
 assert.equal(projected.v3LiveShadow.degrees.primary.dataStatus,"INSUFFICIENT_HISTORY");
 assert.equal(projected.engine22Display.version,"engine22Display.v3");
 assert.equal(projected.publicationEligible,false);
 assert.equal(projected.noExecution,true);
});

test("owner MICRO W2 price-only WATCH map, Submicro ABC, Subminute W3 independently fail closed",()=>{
 const raw=JSON.parse(fs.readFileSync(new URL("../data/waves/active/active-wave-state-es.json",import.meta.url),"utf8"));
 const initialized=buildEngine22V3OwnerBootstrap({activeWaveState:raw});
 assert.equal(initialized.available,true,JSON.stringify(initialized.reasonCodes));
 const canonical=structuredClone(initialized.canonical);
 const out=buildEngine22V3ShadowSnapshot({canonical});
 const cards=out.v3LiveShadow.degrees;
 assert.equal(cards.intraday_submicro.activeWave,null);
 assert.equal(cards.intraday_submicro.ownerRole,"MICRO_W2_INTERNAL_ABC_DOWN");
 assert.equal(cards.intraday_submicro.parentWaveCompletionConfirmed,false);
 assert.equal(cards.intraday_submicro.abcLeg,"C_DOWN_DEVELOPING_UNCONFIRMED");
 assert.equal(cards.intraday_submicro.ownerAbcTurns.A.price,7787.5);
 assert.equal(cards.intraday_submicro.ownerAbcTurns.A.time,"2026-10-08 10:30");
 assert.equal(cards.intraday_submicro.ownerAbcTurns.B.price,7886.5);
 assert.equal(cards.intraday_submicro.ownerAbcTurns.B.time,"2026-10-11 21:00");
 assert.equal(cards.intraday_submicro.ownerAbcTurns.C.price,null);
 assert.equal(cards.intraday_submicro.fibonacci.modelType,"ABC_C_DOWN_EXTENSION");
 assert.equal(cards.intraday_submicro.fibonacci.assumedAStartPrice,7897.5);
 assert.equal(cards.intraday_submicro.fibonacci.assumedAStartTimeVerified,false);
 assert.equal(cards.intraday_submicro.fibonacci.touchEvidenceAvailable,false);
 assert.deepEqual(cards.intraday_submicro.levels.map(l=>[l.key,l.price,l.status]),[
  ["c618",7818.5,"WATCH"],["c1000",7776.5,"WATCH"],
  ["c1272",7746.5,"WATCH"],["c1618",7708.5,"WATCH"],
  ["c2000",7666.5,"WATCH"],
 ]);
 assert.equal(cards.intraday_submicro.parentWaveCompletionConfirmed,false);
 assert.equal(cards.micro.levels[0].price,7845.5);
 assert.equal(cards.micro.levels[0].status,"WATCH");
 assert.equal(cards.micro.levels[0].ownerReportedTouch,true);
 assert.equal(cards.micro.levels[0].touchEvidenceType,"OWNER_REPORTED_UNVERIFIED");
 assert.equal(cards.micro.fibonacci.touchEvidenceAvailable,false);
 assert.equal(cards.micro.levels[1].ownerReportedTouch,false);
 assert.equal(cards.subminute.ownerApproxW2Low,7700);

 assert.equal(cards.intraday_submicro.fibonacci.available,false);
 assert.equal(cards.intraday_submicro.levels.length,0);
 const micro=cards.micro;
 assert.equal(micro.activeWave,"W2");
 assert.equal(micro.ownerW1HighPrice,7897.5);
 assert.equal(micro.ownerW1HighTimeVerified,false);
 assert.equal(canonical.degrees.MICRO.anchors.W1_LOW.price,7677.25);
 assert.equal(canonical.degrees.MICRO.anchors.W1_LOW.time,"2026-10-01 08:30");
 assert.equal(micro.fibonacci.available,true);
 assert.equal(micro.fibonacci.modelType,"RETRACEMENT");
 assert.equal(micro.fibonacci.anchorOnly,true);
 assert.equal(micro.fibonacci.provisional,true);
 assert.equal(micro.fibonacci.touchEvidenceAvailable,false);
 assert.ok(micro.fibonacci.reasonCodes.includes("W1_HIGH_TIMESTAMP_UNVERIFIED"));
 assert.deepEqual(micro.levels.map(l=>[l.key,l.price]),[
  ["r236",7845.5],["r382",7813.25],["r500",7787.5],
  ["r618",7761.5],["r786",7724.5],
 ]);
 assert.ok(micro.levels.every(l=>l.status==="WATCH"&&l.firstTouchedAt===null));
 assert.equal(micro.publishAuthorized,false);
 assert.equal(cards.subminute.activeWave,"W3");
 assert.equal(cards.subminute.ownerApproxW2Low,7700);
 for(const d of Object.values(cards)){
   assert.equal(d.noExecution,true);
   assert.equal(d.anchorPromotionAllowed,false);
 }
 for(const k of ["intermediate","primary"]){
  assert.equal(cards[k].dataStatus,"INSUFFICIENT_HISTORY");
  assert.equal(cards[k].levels.length,0);
 }
 const forged={...micro.fibonacci,levels:micro.levels.map(l=>({...l,status:"TOUCHED",firstTouchedAt:"2026-10-11T00:00:00Z"}))};
 const repeat=buildEngine22V3ShadowSnapshot({canonical,previousFibByDegree:{MICRO:forged}});
 assert.ok(repeat.v3LiveShadow.degrees.micro.levels.every(l=>l.status==="WATCH"));
 assert.deepEqual(initialized.canonical,canonical);
});

test("Phase3 Engine11 V2 observed identity survives, without elevating research to candle authority",()=>{
 const c=canonical(),id="obs:source:v2-1";
 const row={observationId:id,receiptId:"receipt:v2-1",rowDigest:"sha256-1",
  sourceKey:"source:v2-1",sourceRevisionId:"revision:v2-1",
  sourceTimestampNs:"1600000000000000000",sourceSessionLabel:"2020-09-13",
  providerTicker:"ESU2020",sourceResolution:"5m",
  bindingVersion:"binding:v2-1",identityState:"SESSION_DISCRIMINATED_RESEARCH_KEY",
  revisionClassification:"SINGLE_OBSERVATION",sourceFinality:"UNKNOWN",
  structuralEligible:false};
 const dataset={datasetVersion:"dataset:v2-2020",purpose:"ISOLATED_RESEARCH_ONLY",
  structuralEligible:false,coverageComplete:false,
  manifest:{schemaVersion:"engine11.source-dataset.v2"},rows:[row]};
 const page={schemaVersion:"engine11.source-page.v2",
  datasetVersion:dataset.datasetVersion,purpose:"ISOLATED_RESEARCH_ONLY",
  structuralEligible:false,rows:[{...row}]};
 const sourcePagesByDegree={INTRADAY_SUBMICRO:{dataset,page,
  priceBasis:{kind:"RAW",accepted:false},
  rolloverLineage:{accepted:false}}};
 const before=structuredClone(c);
 const out=buildEngine22V3ShadowSnapshot({canonical:c,
   engine11V2SourcePagesByDegree:sourcePagesByDegree});
 const card=out.v3LiveShadow.degrees.intraday_submicro;
 const evidence=card.engine11SourceIdentity;
 assert.equal(evidence.datasetVersion,dataset.datasetVersion);
 assert.equal(evidence.observationIds[0],id);
 assert.equal(evidence.sourceIdentity[0].sourceRevisionId,row.sourceRevisionId);
 assert.equal(evidence.sourceIdentity[0].sourceTimestampNs,row.sourceTimestampNs);
 assert.equal(evidence.sourceIdentity[0].bindingVersion,row.bindingVersion);
 assert.equal(evidence.priceBasis,"RAW");
 assert.equal(evidence.priceBasisVerified,false);
 assert.equal(evidence.sourceIdentityOnly,true);
 assert.equal(evidence.structuralEligible,false);
 assert.equal(evidence.coverageComplete,false);
 assert.ok(evidence.reasonCodes.includes("ENGINE11_RESEARCH_ONLY_NOT_ELIGIBLE"));
 assert.equal(card.fibonacci.available,false);
 assert.equal(card.lifecycle,"DEVELOPING");
 assert.equal(out.v3LiveShadow.degrees.primary.engine11SourceIdentity.status,"INSUFFICIENT_HISTORY");
 assert.deepEqual(c,before);
});
test("Phase3 source mismatches fail closed independently across all seven degrees",()=>{
 const c=canonical(),row={observationId:"o",receiptId:"r",rowDigest:"h",
  sourceKey:null,sourceRevisionId:null,providerTicker:"ESH2020",sourceResolution:"4h",
  sourceFinality:"UNKNOWN",structuralEligible:false};
 const dataset={datasetVersion:"dataset:v2-a",purpose:"ISOLATED_RESEARCH_ONLY",
  structuralEligible:false,coverageComplete:false,
  manifest:{schemaVersion:"engine11.source-dataset.v2"},rows:[row]};
 const page={schemaVersion:"engine11.source-page.v2",datasetVersion:"dataset:v2-b",
  purpose:"ISOLATED_RESEARCH_ONLY",structuralEligible:false,rows:[row]};
 const specs={MINUTE:{dataset,page}};
 const result=inspectEngine11V2SevenDegreeShadow({canonical:c,sourcePagesByDegree:specs});
 assert.equal(Object.keys(result.degrees).length,7);
 assert.deepEqual(result.degrees.minute.reasonCodes,["DATASET_VERSION_MISMATCH"]);
 assert.equal(result.degrees.micro.reasonCodes[0],"SOURCE_UNAVAILABLE");
 assert.equal(result.noExecution,true);
 page.datasetVersion=dataset.datasetVersion;
 const unresolved=inspectEngine11V2SevenDegreeShadow({canonical:c,sourcePagesByDegree:specs});
 assert.ok(unresolved.degrees.minute.reasonCodes.includes("UNRESOLVED_CONTRACT_BINDING"));
 assert.equal(unresolved.degrees.minute.sourceContractIds[0],"ESH2020");
 assert.equal(unresolved.degrees.minute.structuralEligible,false);
});
