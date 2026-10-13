import test from 'node:test';
import assert from 'node:assert/strict';
const clock=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
test('2020 spring opening moves by UTC offset without changing Chicago clock',()=>{assert.equal(clock('2020-03-06T23:00:00Z'),'17:00');assert.equal(clock('2020-03-08T22:00:00Z'),'17:00');});
test('2020 fall opening uses standard offset',()=>assert.equal(clock('2020-11-01T23:00:00Z'),'17:00'));
test('2026 DST conversions remain timezone-dependent',()=>{assert.equal(clock('2026-03-08T22:00:00Z'),'17:00');assert.equal(clock('2026-11-01T23:00:00Z'),'17:00');});
test('dated pause removal cannot be projected back into 2020',()=>{
 const applicability=date=>date<'2021-06-28'?'PRE_REMOVAL_BASELINE_REQUIRES_EXCEPTIONS':'POST_REMOVAL_BASELINE_REQUIRES_EXCEPTIONS';
 assert.notEqual(applicability('2020-03-10'),applicability('2021-06-28'));
});
test('proposed alignment preserves open segments while terminal bar is partial',()=>{
 const open=Date.parse('2026-09-09T22:00:00Z'),close=Date.parse('2026-09-10T21:00:00Z'),step=4*3600000;
 const windows=[];for(let start=open;start<close;start+=step)windows.push([start,Math.min(start+step,close)]);
 assert.equal(windows.length,6);assert.equal(windows.at(-1)[1]-windows.at(-1)[0],3*3600000);assert.equal(windows.flat().at(-1),close);
});
test('known closure does not authorize filling unrelated unknown absence',()=>{
 const classify=(calendar,activity)=>calendar==='CLOSED'?'EXPECTED_CLOSURE':activity==='VERIFIED_NO_TRADES'?'VERIFIED_NO_TRADES':'UNKNOWN_ABSENCE';
 assert.equal(classify('UNRESOLVED',null),'UNKNOWN_ABSENCE');assert.equal(classify('OPEN',null),'UNKNOWN_ABSENCE');assert.equal(classify('CLOSED',null),'EXPECTED_CLOSURE');
});
test('elapsed period without source watermark remains provisional',()=>{
 const finality=(elapsed,watermark)=>elapsed&&watermark?'COMPLETION_CANDIDATE_REQUIRES_ACCEPTANCE':'PROVISIONAL';assert.equal(finality(true,null),'PROVISIONAL');assert.equal(finality(false,'proof'),'PROVISIONAL');
});
test('month duration cannot use fixed thirty-day substitution',()=>assert.equal((Date.parse('2020-03-01')-Date.parse('2020-02-01'))/86400000,29));
