import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root='docs/architecture/';
const observations=JSON.parse(readFileSync(root+'ENGINE11_ES_CALENDAR_OBSERVATIONS_V1.json','utf8'));
const sample=name=>observations.samples.find(x=>x.name===name);
test('authentic minute reconciliation preserves both source dates even when arithmetic matches',()=>{
 assert.equal(observations.comparisons.length,18);assert.ok(observations.comparisons.every(x=>x.matched));
 for(const name of ['2020_conflict_1min','2020_conflict_5min','2020_conflict_10min','2020_conflict_1hour']){
  const rows=sample(name).collisions;assert.equal(rows.length,2);assert.equal(rows[0].window_start,rows[1].window_start);assert.notEqual(rows[0].session_end_date,rows[1].session_end_date);
 }
});
test('authentic pause observations have exact absent minutes rather than a generic holiday inference',()=>{
 const before=sample('pause_before_change'),after=sample('pause_after_change');assert.equal(before.timestamps.length,30);assert.equal(after.timestamps.length,45);
 const utc=ns=>new Date(Number(BigInt(ns)/1000000n)).toISOString().slice(11,16);
 assert.ok(!before.timestamps.some(ns=>utc(ns)>='20:15'&&utc(ns)<'20:30'));
 assert.equal(after.timestamps.filter(ns=>utc(ns)>='20:15'&&utc(ns)<'20:30').length,15);
});
test('authentic DST and maintenance samples agree with observed UTC boundaries without certifying calendar',()=>{
 const utc=ns=>new Date(Number(BigInt(ns)/1000000n)).toISOString();
 assert.equal(utc(sample('spring_2020_open').timestamps[0]),'2020-03-08T22:00:00.000Z');
 assert.equal(utc(sample('fall_2020_open').timestamps[0]),'2020-11-01T23:00:00.000Z');
 assert.ok(sample('maintenance_2026').timestamps.every(ns=>{const t=utc(ns);return t<'2026-09-10T21:00:00.000Z'||t>='2026-09-10T22:00:00.000Z';}));
 assert.ok(observations.samples.every(x=>x.calendarAccepted===false&&x.structuralEligible===false));
});
test('new authentic historical metadata explains missing field without invented settlement',()=>{
 const e=JSON.parse(readFileSync(root+'ENGINE11_ES_2020_METADATA_EVIDENCE_V1.json','utf8'));
 for(const label of ['ESH0-date','ESM0-date']){const x=e.metadata.find(y=>y.label===label);assert.equal(x.binding,null);assert.equal(x.bindingFailure,'V2_FULL_CONTRACT_BINDING_UNRESOLVED');assert.equal(x.returnedMetadata[0].product_code,'ES');assert.equal(x.returnedMetadata[0].trading_venue,'XCME');assert.ok(x.returnedMetadata[0].last_trade_date.startsWith('2020-'));assert.ok(!('settlement_date' in x.returnedMetadata[0]));}
});
