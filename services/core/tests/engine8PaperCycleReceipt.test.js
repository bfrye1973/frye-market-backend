import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPaperCycleReceipt as receipt} from '../logic/trading/engine8PaperCycleReceipt.js';
const run=p=>receipt({code:0,stdout:JSON.stringify(p)},'2026-11-25T15:01:00Z');
test('skip distinguishes exact blocker from success',()=>{const r=run({status:'AUTO_PAPER_EXECUTION_SKIPPED',reason:'ENGINE8_ADAPTER_NOT_READY_ENVIRONMENT_ARMED',skipped:true,engine8:{status:'DUPLICATE_ORDER_BLOCKED',executable:false,blockers:['PAPER_ACCEPTANCE_STATE_UNAVAILABLE']}});assert.deepEqual(r.blockers,['PAPER_ACCEPTANCE_STATE_UNAVAILABLE']);assert.equal(r.orderCreated,null);assert.equal(r.skipped,true);});
test('completed exposes fill and journal flags separately',()=>{const r=run({status:'AUTO_PAPER_EXECUTION_COMPLETED',skipped:false,execution:{orderCreated:true,fillCreated:true,journalCompleted:false,journalPending:true}});assert.equal(r.fillCreated,true);assert.equal(r.journalCompleted,false);assert.equal(r.journalPending,true);});
test('disabled is not a fill',()=>{const r=run({status:'AUTO_PAPER_EXECUTION_SKIPPED',reason:'ENGINE8_AUTO_PAPER_EXECUTION_DISABLED',skipped:true});assert.equal(r.fillCreated,null);assert.equal(r.reason,'ENGINE8_AUTO_PAPER_EXECUTION_DISABLED');});
test('malformed output unknown',()=>assert.equal(receipt({code:0,stdout:'bad'},'now').status,'RESULT_UNAVAILABLE'));
test('no raw detail or account identifiers',()=>{const r=run({status:'AUTO_PAPER_EXECUTION_BRIDGE_ERROR',reason:'CANONICAL_PAPER_EXECUTION_REJECTED',detail:{secret:'SECRET_EXAMPLE'},engine8:{candidateId:'PRIVATE_ID',blockers:['valid text','ENGINE10_JOURNAL_PENDING']}});assert.deepEqual(r.blockers,['ENGINE10_JOURNAL_PENDING']);assert.doesNotMatch(JSON.stringify(r),/SECRET_EXAMPLE|PRIVATE_ID/);});
