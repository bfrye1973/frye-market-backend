import {MICRO_MANAGER_SCHEMA,MICRO_ACCOUNT} from "../contracts/manager.v1.js";
import {assembleMicroInputs} from "./assembleMicroInputs.js";
import {evaluatePriceActionFib} from "../priceActionFib/evaluatePriceActionFib.js";
import {evaluateNeighboringAlignment} from "../neighboringAlignment/evaluateNeighboringAlignment.js";
import {evaluateMarketConfirmation} from "../marketConfirmation/evaluateMarketConfirmation.js";
import {evaluatePositionIntelligence} from "../positionIntelligence/evaluatePositionIntelligence.js";
import {evaluateOriginalThesis} from "../entryThesisMemory/evaluateOriginalThesis.js";
import {evaluateHistoricalReplay} from "../historicalValidation/evaluateReplay.js";

export function buildMicroIntelligenceV3(input={}){
 const {contract,sources}=assembleMicroInputs(input);
 // Refuse unqualified ES bars; do not silently repair timestamps, sources or identities.
 const priceActionFib=evaluatePriceActionFib({snapshot:sources.snapshot,
 esBars10m:contract.qualified?sources.esBars10m:null,
 sourceSymbol:"ES",evaluatedAt:sources.evaluatedAt});
 const neighboringAlignment=evaluateNeighboringAlignment({snapshot:sources.snapshot});
 const marketConfirmation=evaluateMarketConfirmation({degree:"micro",symbol:"ES",evaluatedAt:sources.evaluatedAt,
 engine25:sources.engine25,engine29:sources.engine29,crossMarketLevels:sources.crossMarketLevels,
 crossMarketReactions:sources.crossMarketReactions,esInstitutionalContext:sources.esInstitutionalContext});
 const positionIntelligence=evaluatePositionIntelligence({journal:sources.journal,officialPlans:sources.officialPlans});
 const journalRows=Array.isArray(sources.journal?.trades)?sources.journal.trades:[];
 const openTrades=journalRows.filter(t=>t?.accountMode==="REAL"&&t?.brokerAccountLabel===MICRO_ACCOUNT&&
 t?.status!=="CLOSED"&&t?.realBroker?.contracts?.some(c=>c?.status==="OPEN"));
 const rawOwner=sources.snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.currentWavelength?.degrees?.micro?.ownerMicroCDown;
 const currentOwner=neighboringAlignment.micro?{degree:"micro",countId:rawOwner?.sourceCountId??null,
 direction:neighboringAlignment.micro.direction,activeWave:neighboringAlignment.micro.activeWave}:null;
 const entryThesisMemory={schema:"engine27.v3.entryThesisCollection.v1",state:positionIntelligence.available?
 "EVALUATED":"UNAVAILABLE",positions:openTrades.map(trade=>evaluateOriginalThesis({trade,currentOwner,
 currentNeighbors:{submicro:{available:!!neighboringAlignment.neighbors.submicro,
 direction:neighboringAlignment.neighbors.submicro?.direction??null}}})),
 reasonCodes:positionIntelligence.available?[]:["ENGINE10_POSITION_SOURCE_UNAVAILABLE"]};
 const replay=sources.replay??{};
 const historicalValidation=evaluateHistoricalReplay({snapshots:replay.snapshots??null,
 predictions:replay.predictions??null,cutoff:replay.cutoff??null,outcomes:replay.outcomes??null});
 const coreReady=contract.qualified&&priceActionFib.available&&neighboringAlignment.available;
 const strategyAssessment={state:coreReady?"OBSERVATION_ONLY":"UNAVAILABLE",
 waveDirection:coreReady?priceActionFib.workingWave?.direction??null:null,
 nextProvisionalFibReference:coreReady?priceActionFib.nextReferenceLevel:null,
 confirmedObjective:null,entryAuthorized:false,
 reasonCodes:coreReady?["ENGINE27_CANNOT_AUTHORIZE_TRADES"]:["CORE_ES_OR_OWNER_EVIDENCE_UNAVAILABLE"]};
 const positionAssessment={state:positionIntelligence.state,
 openContractCount:positionIntelligence.positions.length,
 originalTheses:entryThesisMemory.positions,
 holdExitRecommendation:null,reasonCodes:positionIntelligence.reasonCodes};
 return {schema:MICRO_MANAGER_SCHEMA,mode:"READ_ONLY_SHADOW",symbol:"ES",degree:"micro",account:MICRO_ACCOUNT,
 evaluatedAt:sources.evaluatedAt,acceptance:"NOT_PRODUCTION_ACCEPTED",sourceAssembly:contract,
 modules:{priceActionFib,neighboringAlignment,marketConfirmation,positionIntelligence,
 entryThesisMemory,historicalValidation},strategyAssessment,positionAssessment,
 noPermissionCreated:true,noSizingCreated:true,noExecution:true,noJournalWrite:true,
 noOrderModification:true};
}
