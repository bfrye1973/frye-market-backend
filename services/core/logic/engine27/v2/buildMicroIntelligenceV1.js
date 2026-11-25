// Engine27 MICRO-only interpretation, strictly read-only.
// Not an entry/exit authority. The original entry-time thesis is not invented.
const valid=x=>typeof x==="number"&&Number.isFinite(x);
const directions=["UP","DOWN"];
export function buildEngine27MicroIntelligenceV1({working=null,context=null,reactions=null,price=null}={}){
 const micro=working?.degrees?.micro, left=working?.degrees?.submicro,right=working?.degrees?.subminute;
 const unavailable={schema:"engine27.microIntelligence.v1",mode:"READ_ONLY",available:false,
  state:"EVIDENCE_UNAVAILABLE",noPermissionCreated:true,noExecution:true,noJournalWrite:true};
 if(!micro?.available)return {...unavailable,reasonCodes:["ENGINE22_CURRENT_MICRO_MODEL_MISSING"]};
 const direction=micro.waveDirection, objectives=micro?.potentialCompletion?.levels??[];
 const eligible=objectives.filter(x=>valid(x?.price)&&x?.provisional!==true)
   .sort((a,b)=>direction==="DOWN"?b.price-a.price:a.price-b.price);
 const current=valid(price)?price:null;
 const next=current===null?null:eligible.find(x=>direction==="DOWN"?x.price<current:x.price>current)??null;
 const neighboring=[left,right].map((r,i)=>({degree:i?"subminute":"submicro",direction:r?.available?r.waveDirection:null,
  compatible:r?.available&&r.waveDirection===direction?"DIRECTIONALLY_CONSISTENT":"NOT_ESTABLISHED"}));
 const adjacency=neighboring.every(x=>x.compatible==="DIRECTIONALLY_CONSISTENT")?
  "WORKING_DIRECTIONS_AGREE":"NEIGHBOR_CONTEXT_UNRESOLVED";
 const p=context?.participation,t=context?.tactical;
 const q=reactions?.interpretation;
 const evidence={engine25:p?.fresh===true?p.state??"UNAVAILABLE":"UNAVAILABLE",
  engine29:t?.fresh===true?t.overallState??"UNAVAILABLE":"UNAVAILABLE",
  qqq:q?.qqq??"UNAVAILABLE",vix:q?.vix??"UNAVAILABLE",
  combined:q?.state??"UNAVAILABLE"};
 const explanation=current===null?"Fresh ES reference price unavailable: next target cannot be ranked.":
 next?`Micro ${direction} working; next Engine22 objective ${next.price} is ahead of verified reference price ${current}.`:
 "No further eligible owner Fibonacci objective beyond current ES price is published.";
 return {...unavailable,available:true,state:"WORKING_COUNT_UNCONFIRMED",
  wave:micro.activeWave,direction,currentPrice:current,nextObjective:next?{price:next.price,key:next.key,status:next.status}:null,
  neighboring,adjacency,evidence,positionThesis:"ENTRY_STRUCTURE_UNAVAILABLE",
  positionAction:"CONSULT_OFFICIAL_MANAGEMENT_PLAN",
  explanation,warning:"Working direction and cross-market evidence do not independently authorize holding or closing a position.",
  reasonCodes:[],noPermissionCreated:true,noExecution:true,noJournalWrite:true};
}
