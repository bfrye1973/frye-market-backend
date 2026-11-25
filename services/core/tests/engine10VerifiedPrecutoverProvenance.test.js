import test from "node:test";
import assert from "node:assert/strict";
import {planVerifiedPrecutoverProvenance,applyVerifiedPrecutoverProvenanceToCopy}
  from "../logic/journal/verifiedPrecutoverProvenance.js";

const definitions=[
 ["TRD-MES-schwab_real_broker-2026-10-22T05-30-35+0000-90dc","SCHWAB_7727","134185163978","2026-10-22T05:30:35+0000","SUBMINUTE"],
 ["TRD-MES-schwab_real_broker-2026-10-22T06-29-15+0000-d892","SCHWAB_3914","134186181985","2026-10-22T06:29:15+0000","MINUTE"]
];
function fixture(){
 return definitions.map(([tradeId,account,id,at,group])=>({
  tradeId,accountMode:"REAL",brokerAccountLabel:account,performanceGroup:group,
  performanceClassificationSource:"LEGACY_COMPATIBILITY",journalAccount:group,
  entry:{time:at,brokerTransactionId:id},
  events:[{eventType:"REAL_ENTRY_FILL",brokerTransactionId:id,price:7730,fees:2.6}],
  realBroker:{contracts:[{contractId:tradeId+"|CTR|"+id+"|1",status:"OPEN",entryPrice:7730}]},
  summary:{actualFees:2.6,netRealizedPnL:-2.6}
 }));
}
test("exact two exceptions change provenance only, never accounting or original",()=>{
 const input=fixture(),original=structuredClone(input);
 const plan=planVerifiedPrecutoverProvenance(input);
 assert.equal(plan.ok,true);
 assert.equal(plan.changes.length,2);
 const updated=applyVerifiedPrecutoverProvenanceToCopy(input,plan);
 assert.deepEqual(input,original);
 for(let i=0;i<2;i++){
  assert.equal(updated[i].performanceClassificationSource,"VERIFIED_PRECUTOVER_ACCOUNT_EXCEPTION");
  assert.ok(updated[i].performanceClassificationVersion);
  const a=structuredClone(updated[i]),b=structuredClone(original[i]);
  delete a.performanceClassificationSource;delete b.performanceClassificationSource;
  delete a.performanceClassificationVersion;delete b.performanceClassificationVersion;
  assert.deepEqual(a,b);
 }
 assert.equal(planVerifiedPrecutoverProvenance(updated).changes.length,0);
});
test("wrong opening transaction, account, time or contract blocks ALL changes",()=>{
 for(const mutate of [
  x=>x[0].entry.brokerTransactionId="wrong",
  x=>x[0].entry.time="2026-10-22T05:30:36Z",
  x=>x[0].brokerAccountLabel="SCHWAB_3914",
  x=>x[0].realBroker.contracts[0].contractId="other",
  x=>x[0].performanceGroup="SWING",
  x=>x[0].performanceClassificationSource="VERIFIED_OCT22_CUTOVER",
  x=>x.push(structuredClone(x[0])),
 ]){
  const input=fixture();mutate(input);
  const p=planVerifiedPrecutoverProvenance(input);
  assert.equal(p.ok,false);
  assert.throws(()=>applyVerifiedPrecutoverProvenanceToCopy(input,p));
 }
});
test("unrelated campaigns are byte-equivalent as objects",()=>{
 const data=fixture();
 const unrelated={tradeId:"PAPER",accountMode:"PAPER",summary:{netRealizedPnL:75},events:[]};
 data.push(unrelated);
 const output=applyVerifiedPrecutoverProvenanceToCopy(data,planVerifiedPrecutoverProvenance(data));
 assert.deepEqual(output[2],unrelated);
});
