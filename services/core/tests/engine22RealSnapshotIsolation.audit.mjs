// Audit only: replay the exact ES Engine 22 input captured from one isolated
// strategy snapshot build; never modify production behavior or trade outputs.
import fs from "node:fs";
import { buildEngine22WaveStrategy } from "../logic/engine22/wave/buildEngine22WaveStrategy.js";
const saved=JSON.parse(fs.readFileSync("/tmp/engine22-audit-real-input.json","utf8"));
const scenarios=[
  ["baseline",saved],
  ["engine15_null",{...saved,engine15:null}],
  ["engine16_null",{...saved,engine16:null}],
  ["both_null",{...saved,engine15:null,engine16:null}],
];
const keys=["degreeStates","currentWavelength","waveFibState","microExecutionContext","waveOpportunity","tradeDecision","timelineRead"];
const strip=v=> {
 if(Array.isArray(v))return v.map(strip);
 if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v)
   .filter(([k])=>!["builtAt","generatedAt","updatedAt","createdAt","renderedAt","computedAt"].includes(k))
   .map(([k,x])=>[k,strip(x)]));
 return v;
};
const output=[];
for(const [name,input] of scenarios){
 try{
  const value=buildEngine22WaveStrategy(input);
  const record={name,error:null,outputs:{}};
  for(const key of keys){
    const v=key==="waveFibState"?value?.waveFibState?.activeStructures:value?.[key];
    record.outputs[key]=strip(v??null);
  }
  output.push(record);
 }catch(e){output.push({name,error:String(e?.stack||e),outputs:{}});}
}
const baseline=output[0];
const report=output.map(({name,error,outputs})=>({
 name,error,
 families:Object.fromEntries(keys.map(k=>[k,baseline.error||error?"NOT_COMPARABLE":
 JSON.stringify(outputs[k])===JSON.stringify(baseline.outputs[k])?"IDENTICAL":"DIFFERENT"])),
 opportunity:{readiness:outputs?.waveOpportunity?.readiness||null,
  blocked:outputs?.waveOpportunity?.armingBlockedReasonCodes||null},
 paperDecision:{decision:outputs?.tradeDecision?.decision||null,
  entryAllowed:outputs?.tradeDecision?.entryAllowed??null}
}));
console.log("ENGINE22_REAL_ES_ISOLATION_REPORT="+JSON.stringify(report));
if(output.some(o=>o.error))process.exitCode=2;
