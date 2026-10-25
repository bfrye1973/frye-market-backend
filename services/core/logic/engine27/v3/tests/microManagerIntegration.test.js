import test from "node:test";
import assert from "node:assert/strict";
import {buildMicroIntelligenceV3 as build} from "../manager/buildMicroIntelligenceV3.js";
import {STRATEGY_CONFIGURATIONS} from "../manager/strategyConfigurations.js";
const at="2026-10-23T17:40:00Z";
const micro={version:"engine22.microCDownOwnerWatch.v1",direction:"DOWN",activeWave:"C",parentDegree:"subminute",parentWave:"C",stage:"DEVELOPING_CANDIDATE",waveA:{high:7898,low:7678},waveB:{high:7813.25},levels:[{key:"e236",price:7761.25,status:"WATCH",provisional:true},{key:"e382",price:7729.25,status:"WATCH",provisional:true}]};
const submicro={version:"engine22.submicroCDownOwnerWatch.v1",direction:"DOWN",activeWave:"C",parentDegree:"micro",parentWave:"C"};
const subminute={version:"engine22.subminuteCurrentCDownReference.v1",direction:"DOWN",activeWave:"C",parentDegree:"minute",parentWave:"W2"};
const snapshot={symbol:"ES",now:at,strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{currentWavelength:{degrees:{micro:{ownerMicroCDown:micro},submicro:{ownerSubmicroCDown:submicro},subminute:{ownerCurrentCDown:subminute}}}}}}};
const stamp=Math.floor(Date.parse("2026-10-23T17:20:00Z")/1000);
const bars=[{time:stamp,open:7765,high:7770,low:7759,close:7760}];
const barSource={symbol:"ES",timeframe:"10m",timestampUnit:"UNIX_SECONDS_BAR_START",sourceQualified:true,source:"VERIFIED_ES_10M"};
const base={snapshot,esBars10m:bars,esBarSource:barSource,evaluatedAt:at};
test("unified contract has six modules and separates decisions",()=>{const r=build(base);assert.equal(r.schema,"engine27.v3.microUnifiedIntelligence.v1");assert.equal(Object.keys(r.modules).length,6);assert.equal(r.strategyAssessment.state,"OBSERVATION_ONLY");assert.equal(r.positionAssessment.state,"UNAVAILABLE");assert.equal(r.noExecution,true)});
test("unconfirmed Fib touch does not become target or permission",()=>{const r=build(base);assert.equal(r.modules.priceActionFib.state,"UNCONFIRMED_TOUCH");assert.equal(r.strategyAssessment.confirmedObjective,null);assert.equal(r.strategyAssessment.entryAuthorized,false)});
test("missing source attestation fails closed",()=>{const r=build({...base,esBarSource:null});assert.equal(r.strategyAssessment.state,"UNAVAILABLE");assert.equal(r.sourceAssembly.qualified,false)});
test("wrong timestamp unit not guessed or normalized",()=>assert.equal(build({...base,esBarSource:{...barSource,timestampUnit:"UNIX_MILLISECONDS"}}).strategyAssessment.state,"UNAVAILABLE"));
test("stale ES bars fail price qualification",()=>assert.equal(build({...base,evaluatedAt:"2026-10-23T22:40:00Z"}).strategyAssessment.state,"UNAVAILABLE"));
test("wrong wave owner version fails closed",()=>{const s=structuredClone(snapshot);s.strategies["intraday_scalp@10m"].engine22WaveStrategy.currentWavelength.degrees.micro.ownerMicroCDown.version="old";assert.equal(build({...base,snapshot:s}).strategyAssessment.state,"UNAVAILABLE")});
test("lower-degree correction is not invalidation",()=>{const s=structuredClone(snapshot);s.strategies["intraday_scalp@10m"].engine22WaveStrategy.currentWavelength.degrees.submicro.ownerSubmicroCDown.direction="UP";const r=build({...base,snapshot:s});assert.equal(r.modules.neighboringAlignment.state,"CORRECTIVE_MIXED_DIRECTION");assert.equal(r.modules.neighboringAlignment.structuralConflictConfirmed,false)});
test("unavailable QQQ VIX E29 never become neutral confirmation",()=>{const r=build(base);assert.equal(r.modules.marketConfirmation.sources.qqq.state,"UNAVAILABLE");assert.equal(r.modules.marketConfirmation.sources.vix.state,"UNAVAILABLE");assert.equal(r.modules.marketConfirmation.sources.engine29.state,"UNAVAILABLE")});
test("no Engine10 never invents position PnL stop or thesis",()=>{const r=build(base);assert.equal(r.modules.positionIntelligence.available,false);assert.equal(r.positionAssessment.originalTheses.length,0);assert.equal(r.positionAssessment.holdExitRecommendation,null)});
test("unmatched Engine9 plan never attaches to real position",()=>{const trade={tradeId:"T1",accountMode:"REAL",brokerAccountLabel:"SCHWAB_6380",direction:"LONG",symbol:"/MESZ26:XCME",status:"OPEN",identity:{candidateId:"C",planId:"P",strategyId:"micro"},realBroker:{contracts:[{contractId:"K",status:"OPEN",entryPrice:7700}]}};const plan={candidateId:"OTHER",planId:"P",strategyId:"micro",direction:"LONG",managementReady:true,official:true,officialStopPrice:7680,officialTargets:[]};const r=build({...base,journal:{ok:true,trades:[trade]},officialPlans:[plan]});assert.equal(r.modules.positionIntelligence.positions[0].officialManagement,null);assert.equal(r.positionAssessment.originalTheses[0].state,"ENTRY_STRUCTURE_UNAVAILABLE")});
test("replay rejects future snapshot without influencing strategy",()=>{const r=build({...base,replay:{snapshots:[{symbol:"ES",snapshotTime:"2026-10-23T18:00:00Z"}],predictions:[],outcomes:[],cutoff:at}});assert.equal(r.modules.historicalValidation.state,"UNAVAILABLE");assert.equal(r.strategyAssessment.state,"OBSERVATION_ONLY")});
test("seven distinct account mappings and E29 gate",()=>{assert.equal(new Set(STRATEGY_CONFIGURATIONS.map(x=>x.account)).size,7);assert.deepEqual(STRATEGY_CONFIGURATIONS.filter(x=>x.engine29).map(x=>x.degree),["submicro","micro"])});
test("snapshot and evidence are not mutated",()=>{const s=structuredClone(snapshot),b=structuredClone(bars);build(base);assert.deepEqual(snapshot,s);assert.deepEqual(bars,b)});

test("optional live ES price observation stays advisory and separate from six modules",()=>{
 const s=Math.floor(Date.parse("2026-10-23T17:30:00Z")/1000);
 const evt={ok:true,type:"bar",symbol:"ES",resolvedSymbol:"ESZ26",tf:"10m",mode:"eth",
 bar:{time:s,open:7765,high:7770,low:7759,close:7760}};
 const r=build({...base,livePriceEvent:evt,expectedEsContract:"ESZ26",liveObservedAt:"2026-10-23T17:31:00Z"});
 assert.equal(r.livePriceObservation.state,"LIVE_PRICE_OBSERVED");
 assert.equal(r.livePriceObservation.confirmedWaveCompletion,false);
 assert.equal(r.strategyAssessment.confirmedObjective,null);
 assert.equal(r.positionAssessment.holdExitRecommendation,null);
 assert.equal(Object.keys(r.modules).length,6);
});
test("live wrong-contract event is unavailable, no guessed ES price",()=>{
 const s=Math.floor(Date.parse("2026-10-23T17:30:00Z")/1000);
 const evt={ok:true,type:"bar",symbol:"ES",resolvedSymbol:"ESH27",tf:"10m",mode:"eth",
 bar:{time:s,open:7765,high:7770,low:7759,close:7760}};
 const r=build({...base,livePriceEvent:evt,expectedEsContract:"ESZ26",liveObservedAt:"2026-10-23T17:31:00Z"});
 assert.equal(r.livePriceObservation.state,"UNAVAILABLE");
 assert.equal(r.strategyAssessment.entryAuthorized,false);
});
