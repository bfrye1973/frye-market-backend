import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSchwabRealFutureTransaction as normalize,
  resolveSchwabJournalAccount as resolve,
} from "../logic/trading/schwab/engine8RealFillNormalizer.js";

const tx=(activityId)=>({
  activityId,type:"TRADE",status:"VALID",time:"2026-10-22T13:42:18+0000",
  transferItems:[
    {instrument:{assetType:"CURRENCY",symbol:"CURRENCY_USD"},amount:2.6,cost:-2.6,feeType:"COMMISSION"},
    {instrument:{assetType:"FUTURE",symbol:"/MESZ26:XCME"},amount:1,price:7730.25,cost:-38651.25,positionEffect:"OPENING"},
  ]
});
test("new MINOR account normalizes only under explicit seven scope",()=>{
  assert.equal(normalize({transaction:tx("134209487262"),maskedAccountNumber:"****5671"}).ok,false);
  const out=normalize({transaction:tx("134209487262"),maskedAccountNumber:"****5671",accountScope:"SEVEN_STRATEGIES"});
  assert.equal(out.ok,true);
  assert.equal(out.fill.brokerAccountLabel,"SCHWAB_5671");
  assert.equal(out.fill.journalAccount,"MINOR");
  assert.equal(out.fill.brokerTransactionId,"134209487262");
  assert.equal(out.fill.futuresContractCode,"MESZ26");
  assert.equal(out.fill.fillTime,"2026-10-22T13:42:18+0000");
  assert.equal(out.fill.quantity,1);
  assert.equal(out.fill.fillPrice,7730.25);
  assert.equal(out.fill.direction,"LONG");
});
test("legacy account normalization and identity remain bitwise compatible",()=>{
  const input={transaction:tx("134198140062"),maskedAccountNumber:"****6380"};
  const baseline=normalize(input);
  const scoped=normalize({...input,accountScope:"SEVEN_STRATEGIES"});
  assert.equal(baseline.ok,true);
  assert.equal(scoped.ok,true);
  assert.deepEqual(scoped.fill,baseline.fill);
  assert.equal(scoped.fill.journalAccount,"INTRADAY");
});
test("unknown broker identities cannot be coerced into account scope",()=>{
  assert.equal(resolve("****9999",{accountScope:"SEVEN_STRATEGIES"}).ok,false);
  assert.equal(resolve("****5671",{accountScope:"UNAPPROVED"}).ok,false);
});
