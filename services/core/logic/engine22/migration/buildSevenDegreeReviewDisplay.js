// Presentation-only adapter for Engine22 seven-degree structural shadow.
// Takes verified source-provenanced provisional count objects, never creates
// structural truth in the frontend. No execution/permission projections.
const line=(label,value)=>({label,value:String(value??"—")});
const fmt=p=>Number.isFinite(Number(p))?Number(p).toFixed(2):"—";
export function buildSevenDegreeReviewDisplay({legacyDisplay=null,shadow=null}={}){
 if(!legacyDisplay||shadow?.status!=="READ_ONLY_STRUCTURAL_SHADOW")
   return legacyDisplay;
 const micro=shadow.degrees?.micro,sub=shadow.degrees?.submicro;
 if(!micro?.anchors||!sub?.sourceProvenance||!sub?.origin) return legacyDisplay;
 const historical=(mark)=>`${fmt(mark?.price)} · ${mark?.localTime||"time unverified"}`;
 return {
  ...legacyDisplay,
  degreeOrder:["submicro","micro","subminute","minute","minor","intermediate","primary"],
  headline:"Seven-degree Elliott structural REVIEW — no automation authority",
  degrees:{
   ...legacyDisplay.degrees,
   submicro:{
    degree:"submicro",label:"Intraday Submicro",subtitle:"Separate operating child count",
    badge:"MIGRATION REVIEW",active:false,direction:sub.sequenceDirection,
    headline:"Existing operating Micro sequence → independent Submicro candidate",
    rows:[line("Parent",`Micro · ${sub.parentContext.countId}`),
      line("Origin",fmt(sub.origin.price)),
      line("Source ID",sub.sourceProvenance.sourceCountId),
      line("Wave",sub.activeWave)],
    levels:[],rules:["Original Micro history preserved; new count not locked.",
      "No automation, trading, or account-routing permission."],
    noExecution:true,noPermissionCreated:true,watchOnly:true
   },
   micro:{
    degree:"micro",label:"Micro",subtitle:"Larger provisional owner-accepted count",
    badge:"W5 REVIEW",active:false,direction:"UP",
    headline:"Micro W5 UP candidate · W1/W4 wick overlap accepted provisionally",
    rows:[line("W1 low",historical(micro.anchors.w1Low)),
      line("W1 high",historical(micro.anchors.w1High)),
      line("W2 low",historical(micro.anchors.w2Low)),
      line("W3 high",historical(micro.anchors.w3High)),
      line("W4 low",historical(micro.anchors.w4Low)),
      line("Overlap",`${fmt(micro.structuralReview.w1w4OverlapPoints)} ES points`)],
    levels:[],rules:["Provisional owner-accepted overlap, not confirmed standard impulse.",
      "Historical bar identity pending; no execution permission."],
    noExecution:true,noPermissionCreated:true,watchOnly:true
   }
  },
  flags:{...legacyDisplay.flags,noExecution:true,noPermissionCreated:true,watchOnly:true},
 };
}
