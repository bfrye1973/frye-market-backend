import {hash} from '../acceptanceResearchV1/eligibility.js';
export const FRAME={SUBMICRO:['5m','5min'],MICRO:['10m','10min'],SUBMINUTE:['1h','1hour'],MINUTE:['4h','4hour'],MINOR:['1d','1session'],INTERMEDIATE:['1w','1week'],PRIMARY:['1mo','1month']};
const DAY=86400000,monthCodes=['H','M','U','Z'];
export function coordinate(node){
 if(node.price===null)return {state:'BLANK_PRICE_PLACEHOLDER',utcCandidates:[]};
 if(typeof node.rawDate!=='number'||!Number.isInteger(node.rawDate)||node.rawDate<40000||node.rawDate>60000)return {state:'MALFORMED_OR_UNSUPPORTED_DATE',originalDate:node.rawDate,utcCandidates:[]};
 const date=new Date(Date.UTC(1899,11,30)+node.rawDate*DAY).toISOString().slice(0,10);
 if(typeof node.rawTime!=='number'||!Number.isFinite(node.rawTime)||node.rawTime<0||node.rawTime>=1)return {state:'UNRESOLVED_TIME_OR_DURATION',date,originalTime:node.rawTime,utcCandidates:[]};
 const minutes=Math.round(node.rawTime*1440);if(Math.abs(node.rawTime*1440-minutes)>1e-6)return {state:'UNRESOLVED_SUBMINUTE_PRECISION',date,originalTime:node.rawTime,utcCandidates:[]};
 const local=date+'T'+String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')+':00';
 return {state:'MINUTE_PRECISION_TIMEZONE_UNCONFIRMED',date,recordedLocalTime:local,originalTime:node.rawTime,utcCandidates:[{hypothesis:'OWNER_REPORTED_PHOENIX_UNCONFIRMED',utc:new Date(Date.parse(local+'-07:00')).toISOString()},{hypothesis:'UTC_ALTERNATIVE_UNCONFIRMED',utc:local+'.000Z'}]};
}
export function thirdFriday(year,quarter){const first= new Date(Date.UTC(year,quarter*3+2,1));return new Date(first.getTime()+((5-first.getUTCDay()+7)%7+14)*DAY).toISOString().slice(0,10);}
export function contractPair(date){const ts=Date.parse(date+'T00:00:00Z'),year=Number(date.slice(0,4));const list=[];for(let y=year;y<=year+1;y++)for(let q=0;q<4;q++)list.push({full:'ES'+monthCodes[q]+y,ticker:'ES'+monthCodes[q]+String(y).slice(-1),nominalExpiration:thirdFriday(y,q),year:y,quarter:q});const i=list.findIndex(x=>Date.parse(x.nominalExpiration+'T00:00:00Z')>=ts);return list.slice(i,i+2);}
export function researchRolls(){const rolls=[];for(let year=2020;year<=2026;year++)for(let q=0;q<4;q++){if(year===2020&&q===0||year===2026&&q===3)continue;const old={full:'ES'+monthCodes[q]+year,ticker:'ES'+monthCodes[q]+String(year).slice(-1)},ny=q===3?year+1:year,nq=(q+1)%4,next={full:'ES'+monthCodes[nq]+ny,ticker:'ES'+monthCodes[nq]+String(ny).slice(-1)};const rollDate=new Date(Date.parse(thirdFriday(year,q)+'T00:00:00Z')-4*DAY).toISOString().slice(0,10);rolls.push({old,next,rollDate,policyVersion:'CME_CUSTOMARY_MONDAY_CALENDAR_RESEARCH_V1',tradingViewSwitchVerified:false,datedCmeTable:year>=2025});}return rolls;}
export const nano=iso=>String(BigInt(Date.parse(iso))*1000000n);
export function buildPlan(nodes){
 const queries=new Map(),add=q=>{q.queryId='node-research-query:'+hash(q);queries.set(q.queryId,q);};
 const meta=new Map();
 for(const node of nodes){const c=coordinate(node);if(!c.utcCandidates.length)continue;const pair=contractPair(c.date);for(const contract of pair){meta.set(contract.full+'|'+c.date,{purpose:'CONTRACT_METADATA',contract,date:c.date});
  for(const h of c.utcCandidates){const center=Date.parse(h.utc);add({purpose:'NODE_MINUTE_DIAGNOSTIC',nodeId:node.id,degree:node.degree,contract,timeframe:'1m_DIAGNOSTIC_NOT_STRUCTURAL',resolution:'1min',hypothesis:h.hypothesis,targetUtc:h.utc,from:new Date(center-60*60000).toISOString(),to:new Date(center+61*60000).toISOString()});}
  const [timeframe,resolution]=FRAME[node.degree],center=Date.parse(c.utcCandidates[0].utc),guard=timeframe==='1mo'?40*DAY:timeframe==='1w'?9*DAY:timeframe==='1d'?2*DAY:3*3600000;
  add({purpose:'NODE_NATIVE_FRAME',nodeId:node.id,degree:node.degree,contract,timeframe,resolution,hypothesis:c.utcCandidates[0].hypothesis,targetUtc:c.utcCandidates[0].utc,from:new Date(center-guard).toISOString(),to:new Date(center+guard).toISOString()});
 }}
 const rolls=researchRolls();for(const roll of rolls){for(const contract of [roll.old,roll.next]){const center=Date.parse(roll.rollDate+'T00:00:00Z');meta.set(contract.full+'|'+roll.rollDate,{purpose:'CONTRACT_METADATA',contract,date:roll.rollDate});add({purpose:'ROLL_OVERLAP',contract,rollId:roll.old.full+'->'+roll.next.full,rollDate:roll.rollDate,timeframe:'1d',resolution:'1session',from:new Date(center-10*DAY).toISOString(),to:new Date(center+7*DAY).toISOString()});}}
 for(const q of meta.values())add(q);
 const result={schemaVersion:'engine11.node-reconciliation-plan.research.v1',registrySha:'482ef74bc46367718fb207148d5e92a7b0cc248a',queries:[...queries.values()],rolls,structuralEligible:false};if(result.queries.length>300)throw Error('QUERY_BUDGET_300');return result;
}
