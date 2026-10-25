import { CONTRACT_VERSION } from "../contracts/priceActionFib.v1.js";
const finite = x => typeof x === "number" && Number.isFinite(x);
export function evaluatePriceActionFib({degree="micro",owner=null,levels=null,candles=null,observedAt=null}={}) {
 const base={schema:CONTRACT_VERSION,degree,readOnly:true,sourceAuthority:"ENGINE22",state:"UNAVAILABLE",lastMeaningfulLevel:null,nextObjective:null,reasonCodes:[]};
 if(degree!=="micro") return {...base,reasonCodes:["MICRO_ONLY_INITIAL_SCOPE"]};
 if(!owner?.identity || owner.degree!=="micro" || !owner.direction) return {...base,reasonCodes:["OWNER_IDENTITY_UNAVAILABLE"]};
 if(!Array.isArray(levels)||!levels.length||levels.some(l=>!finite(l?.price)||!l?.id)) return {...base,reasonCodes:["ENGINE22_LEVELS_UNAVAILABLE"]};
 if(!Array.isArray(candles)||!candles.length) return {...base,reasonCodes:["COMPLETED_ES_CANDLES_UNAVAILABLE"]};
 if(!observedAt||candles.some(c=>c?.complete!==true||!finite(c.high)||!finite(c.low)||!finite(c.close)||!c.endTime||Date.parse(c.endTime)>Date.parse(observedAt))) return {...base,reasonCodes:["UNQUALIFIED_CANDLE_EVIDENCE"]};
 const last=candles[candles.length-1];
 const touched=levels.filter(l=>candles.some(c=>c.low<=l.price&&c.high>=l.price));
 if(!touched.length) return {...base,state:"AWAITING_REACTION",reasonCodes:["NO_LEVEL_TOUCH"]};
 const reached=touched[touched.length-1];
 return {...base,state:"UNCONFIRMED_TOUCH",lastMeaningfulLevel:{id:reached.id,price:reached.price},reasonCodes:["TOUCH_NOT_COMPLETION","CONFIRMATION_RULE_NOT_VERIFIED"],evidence:{lastCompletedCandleEnd:last.endTime}};
}
