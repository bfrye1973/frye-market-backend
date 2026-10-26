// Read-only Engine12 point-in-time extractor. No historical engine reruns.
import {createHash} from "node:crypto";
const valid=t=>typeof t==="string"&&Number.isFinite(Date.parse(t));
const price=x=>typeof x==="number"&&Number.isFinite(x)&&x>0;
const contract=x=>typeof x==="string"&&/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(x);
export function extractReplayResearchSeed(replay,{resolvedContract=null,sourcePath=null}={}){
 const at=replay?.snapshotTime, p=replay?.currentPrice;
 const identity=resolvedContract??replay?.resolvedEsContract??replay?.resolvedContract??null;
 const reasons=[];
 if(replay?.schema!=="engine12.multiStrategyReplay.v1"||!valid(at))reasons.push("INVALID_CANONICAL_REPLAY");
 if(!price(p))reasons.push("MISSING_ES_PRICE");
 if(!contract(identity))reasons.push("UNVERIFIED_EXACT_ES_CONTRACT");
 if(!replay?.strategies?.["intraday_scalp@10m"])reasons.push("STRATEGY1_REPLAY_MISSING");
 if(reasons.length)return {available:false,reasons,noExecution:true};
 const snapshot=JSON.stringify({at,p,identity,sourcePath});
 const id="E27-ES10-"+createHash("sha256").update(snapshot).digest("hex").slice(0,24);
 return Object.freeze({schema:"engine27.v3.probabilityResearchSeed.v1",id,
  predictionTimestampUtc:at,predictionPrice:p,resolvedEsContract:identity,
  source:"CANONICAL_ENGINE12_REPLAY",sourcePath,
  strategyId:"intraday_scalp@10m",horizonMinutes:10,
  engine22Status:"POINT_IN_TIME_VERIFICATION_REQUIRED",
  engine25Status:"POINT_IN_TIME_VERIFICATION_REQUIRED",
  engine29Status:"POINT_IN_TIME_VERIFICATION_REQUIRED",
  probabilityStatus:"NOT_CALIBRATED",probabilities:{up:null,down:null,sideways:null},
  noExecution:true,noJournalWrite:true});
}
