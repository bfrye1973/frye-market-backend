import {CONTRACT_VERSION} from "../contracts/priceActionFib.v1.js";
export function evaluateTradePriceFib({liveObservation=null,owner=null}={}){
 const base={schema:CONTRACT_VERSION,mode:"READ_ONLY",available:false,state:"UNAVAILABLE",lastMeaningfulLevel:null,nextObjective:null,nextReferenceLevel:null,confirmation:"UNCONFIRMED",reasonCodes:[],noPermissionCreated:true,noExecution:true};
 if(owner?.version!=="engine22.microCDownOwnerWatch.v1"||!Array.isArray(owner.levels))return {...base,reasonCodes:["ENGINE22_MICRO_OWNER_UNAVAILABLE"]};
 if(liveObservation?.available!==true||liveObservation?.state!=="LIVE_TRADE_OBSERVED")return {...base,reasonCodes:["LIVE_ES_TRADE_UNAVAILABLE"]};
 return {...base,available:true,state:liveObservation.provisionalTouches.length?"UNCONFIRMED_TOUCH":"AWAITING_REACTION",
 lastMeaningfulLevel:liveObservation.provisionalTouches.at(-1)??null,
 nextReferenceLevel:liveObservation.nextProvisionalReference,nextObjective:null,
 workingWave:{activeWave:owner.activeWave,direction:owner.direction,stage:owner.stage??null},
 evidence:{source:"POLYGON_DIRECT_ES_TRADE",asOf:liveObservation.lastTradeAt,price:liveObservation.currentPrice},
 reasonCodes:["TRADE_REACTION_NOT_WAVE_COMPLETION","FIB_LEVELS_REMAIN_PROVISIONAL"]};
}
