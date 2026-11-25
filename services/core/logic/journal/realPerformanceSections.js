// Engine 10 — pure nine-section REAL Journal reporting selectors.
// Physical broker identity stays separate from immutable campaign performance group.
import {classifyRealCampaignAtEntry, REAL_ACCOUNT_REGISTRY} from "./realAccountClassification.js";

export const REAL_PERFORMANCE_GROUPS=Object.freeze([
 "SWING","INTRADAY","SUBMICRO","MICRO","SUBMINUTE","MINUTE",
 "MINOR","INTERMEDIATE","PRIMARY"
]);
const upper=v=>String(v??"").trim().toUpperCase();
const num=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const isReal=t=>upper(t?.accountMode)==="REAL";
export function realCampaignPerformanceGroup(trade){
 if(!isReal(trade))return null;
 const saved=upper(trade?.performanceGroup);
 if(REAL_PERFORMANCE_GROUPS.includes(saved))return saved;
 // Legacy historical campaigns retain their original account classification.
 const legacy=upper(trade?.journalAccount);
 const entry=trade?.entry?.time||trade?.createdAt;
 const label=upper(trade?.brokerAccountLabel||trade?.realBroker?.brokerAccountLabel);
 const mapping=REAL_ACCOUNT_REGISTRY.find(a=>a.brokerAccountLabel===label);
 if(!mapping)return REAL_PERFORMANCE_GROUPS.includes(legacy)?legacy:null;
 const derived=classifyRealCampaignAtEntry({brokerAccountLabel:label,entryTime:entry});
 if(!derived.ok)return REAL_PERFORMANCE_GROUPS.includes(legacy)?legacy:null;
 // Pre-existing legacy records without explicit cutover migration are NOT
 // silently reclassified, even if they contain post-cutover timestamps.
 if(legacy==="SWING"||legacy==="INTRADAY")return legacy;
 return derived.classification;
}
export function buildRealPerformanceSections(trades=[]){
 const sections=Object.fromEntries(REAL_PERFORMANCE_GROUPS.map(k=>[k,{group:k,campaigns:0,openContracts:0,closedContracts:0,grossRealized:0,fees:0,netRealized:0,winningContracts:0,losingContracts:0,breakevenContracts:0,profitFactor:null,winRate:null,maxDrawdown:null}]));
 const all={campaigns:0,openContracts:0,closedContracts:0,grossRealized:0,fees:0,netRealized:0,winningContracts:0,losingContracts:0,breakevenContracts:0};
 const unknown=[];const outcomes=Object.fromEntries([...REAL_PERFORMANCE_GROUPS,"ALL_REAL"].map(k=>[k,[]]));
 for(const trade of trades){
  if(!isReal(trade))continue;
  const group=realCampaignPerformanceGroup(trade);
  if(!group||!sections[group]){unknown.push(trade?.tradeId||null);continue;}
  const contracts=trade?.realBroker?.contracts||[];
  const open=contracts.filter(c=>upper(c.status)==="OPEN");
  const closed=contracts.filter(c=>upper(c.status)==="CLOSED");
  const gross=num(trade?.summary?.grossRealizedPnL)??num(trade?.brokerImport?.grossRealizedTradePnL)??0;
  const fees=num(trade?.summary?.actualFees)??num(trade?.brokerImport?.actualFees)??0;
  const net=num(trade?.summary?.netRealizedPnL)??(gross-fees);
  const closedPnls=closed.map(c=>num(c.netRealizedPnL)??num(c.realizedPnL)??num(c.grossRealizedPnL));
  for(const c of closed){
    const netOutcome=num(c.netRealizedPnL)??num(c.netPnL);
    if(netOutcome!==null){
      const item={time:c.closingFillTime||c.exitTime||trade?.summary?.closeTime||trade?.entry?.time||"",net:netOutcome};
      outcomes[group].push(item);outcomes.ALL_REAL.push(item);
    }
  }
  const counts={winningContracts:closedPnls.filter(v=>v!==null&&v>0).length,losingContracts:closedPnls.filter(v=>v!==null&&v<0).length,breakevenContracts:closedPnls.filter(v=>v===0).length};
  for(const dest of [sections[group],all]){
   dest.campaigns++;dest.openContracts+=open.length;dest.closedContracts+=closed.length;
   dest.grossRealized+=gross;dest.fees+=fees;dest.netRealized+=net;
   for(const [k,v] of Object.entries(counts))dest[k]+=v;
  }
 }
 for(const dest of [...Object.values(sections),all]){
  const denominator=dest.winningContracts+dest.losingContracts+dest.breakevenContracts;
  dest.winRate=denominator?dest.winningContracts/denominator:null;
  const key=dest.group||"ALL_REAL";
  const values=outcomes[key].slice().sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const gains=values.filter(x=>x.net>0).reduce((a,x)=>a+x.net,0);
  const losses=values.filter(x=>x.net<0).reduce((a,x)=>a+Math.abs(x.net),0);
  dest.profitFactor=values.length&&losses>0?Math.round(gains/losses*100)/100:null;
  if(values.length){
    let cumulative=0,peak=0,drawdown=0;
    for(const v of values){cumulative+=v.net;peak=Math.max(peak,cumulative);drawdown=Math.max(drawdown,peak-cumulative);}
    dest.maxDrawdown=Math.round(drawdown*100)/100;
  }
  for(const key of ["grossRealized","fees","netRealized"])dest[key]=Math.round(dest[key]*100)/100;
 }
 return {schema:"engine10.realPerformanceSections.v1",sections,allReal:all,unknownRealCampaigns:unknown};
}
