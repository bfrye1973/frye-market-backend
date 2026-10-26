// Shadow-only informational alert gate. No broker, push notification or execution authority.
// Require two consecutive completed 5m bullish observations (10m persistence).
export function createMicroAlignmentAlertGate(){
 let previous=null,active=false,latestAlert=null;
 const recent=[];
 function observe(event){
  if(event?.schema!=="engine27.v3.microFiveMinuteAlignmentEvent.v1"||
     !Number.isFinite(Date.parse(event.closedAt))||event.noExecution!==true)return null;
  const at=Date.parse(event.closedAt);
  if(previous&&at<=previous.at)return null;
  const consecutive=previous&&at-previous.at===300000;
  const bullish=event.marketAligned===true&&event.ES?.state==="UP"&&
    event.QQQ?.state==="UP"&&event.VIX?.state==="DOWN";
  if(!bullish){active=false;previous={at,bullish:false};return null}
  const confirmed=consecutive&&previous.bullish===true;
  previous={at,bullish:true};
  if(!confirmed||active)return null;
  active=true;
  latestAlert=Object.freeze({schema:"engine27.v3.microAlignmentAlert.v1",
   id:"MICRO-BULLISH-10M-"+event.closedAt,at:event.closedAt,
   type:"BULLISH_MARKET_ALIGNMENT_10M",informationalOnly:true,
   executionAuthorized:false,noExecution:true,
   confirmation:"TWO_CONSECUTIVE_COMPLETED_5M_BULLISH_WINDOWS",
   microDirection:event.microDirection??null,
   engine25Qualified:event.engine25Qualified===true,
   engine29Qualified:event.engine29Qualified===true});
  recent.unshift(latestAlert);if(recent.length>20)recent.pop();
  return latestAlert;
 }
 return Object.freeze({observe,status:()=>({schema:"engine27.v3.microAlignmentAlertGate.v1",
  confirmation:"TWO_CONSECUTIVE_COMPLETED_5M_BULLISH_WINDOWS",
  oneMinuteAlertsEnabled:false,notificationsEnabled:false,
  active,latestAlert,recent:recent.slice(0,10),noExecution:true})});
}
