import test from "node:test";
import assert from "node:assert/strict";
import { selectApprovedSchwabRealAccounts as select } from "../logic/trading/schwab/selectApprovedSchwabRealAccounts.js";

const acct=(last4,hash="hash-"+last4)=>({maskedAccountNumber:"****"+last4,accountHash:hash});

test("two approved plus unrelated discovered accounts produce exactly two authorized polls",()=>{
  const out=select([acct("5671"),acct("6380"),acct("3914"),acct("0747"),acct("7727"),acct("2888"),acct("0144")]);
  assert.equal(out.ok,true);
  assert.equal(out.approved.length,2);
  assert.equal(out.skippedCount,5);
  assert.deepEqual(out.approved.map(x=>x.identity.journalAccount),["INTRADAY","SWING"]);
  assert.deepEqual(out.errors,[]);
});

test("unrelated accounts alone do not become either trading account",()=>{
  const out=select([acct("5671"),acct("2888")]);
  assert.equal(out.ok,false);
  assert.equal(out.approved.length,0);
  assert.equal(out.errors.filter(x=>x.error==="APPROVED_SCHWAB_ACCOUNT_MISSING").length,2);
});

test("missing approved account fails closed",()=>{
  const out=select([acct("6380"),acct("5671")]);
  assert.equal(out.ok,false);
  assert.ok(out.errors.some(x=>x.account==="SCHWAB_0747" && x.error==="APPROVED_SCHWAB_ACCOUNT_MISSING"));
});

test("approved account with missing hash fails closed",()=>{
  const out=select([acct("6380",""),acct("0747")]);
  assert.equal(out.ok,false);
  assert.ok(out.errors.some(x=>x.account==="SCHWAB_6380" && x.error==="APPROVED_SCHWAB_ACCOUNT_HASH_MISSING"));
});

test("duplicate approved account fails closed without duplicate polling",()=>{
  const out=select([acct("6380"),acct("6380","other-hash"),acct("0747")]);
  assert.equal(out.ok,false);
  assert.ok(out.errors.some(x=>x.error==="DUPLICATE_APPROVED_SCHWAB_ACCOUNT"));
});

test("no foreign account can mutate approved mapping",()=>{
  const out=select([acct("6380"),acct("0747"),acct("1234")]);
  assert.equal(out.ok,true);
  assert.deepEqual(out.approved.map(x=>x.identity.brokerAccountLabel),["SCHWAB_6380","SCHWAB_0747"]);
});
