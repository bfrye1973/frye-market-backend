import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCalendarPlan, assessCoverage } from '../../logic/engine11/rawCandles/calendar.js';
import { normalizeRawRows } from '../../logic/engine11/rawCandles/normalize.js';
import { range } from '../../logic/engine11/rawCandles/identity.js';
import { plan, context, row, FROM, TO } from './fixtures.js';
const query = { timeframe: '1m', range: range(FROM, TO) };

test('calendar partitions full half-open range without a 24/7 assumption', () => {
  const calendar = validateCalendarPlan(plan(), query); assert.equal(calendar.intervals.length, 3);
  const a = normalizeRawRows([row(0), row(1), row(2)], context());
  assert.equal(assessCoverage(a.records, calendar, true, TO).coverageComplete, true);
});
for (const change of [p => p.intervals.splice(1, 1), p => p.intervals[1].start = p.intervals[0].start,
  p => p.timeframe = '5m', p => p.evidenceId = '', p => p.intervals[0].tradingDate = '2026-02-30',
  p => p.intervals[0].closeConvention = 'SETTLEMENT', p => p.intervals[0].finalityEvidenceId = '']) {
  test('invalid calendar evidence or alignment fails closed ' + change.toString(), () => {
    const p = plan(); change(p); assert.throws(() => validateCalendarPlan(p, query));
  });
}
test('closure is not reported as a missing source interval', () => {
  const p = plan(); p.intervals[1] = { ...p.intervals[1], kind: 'EXPECTED_CLOSURE' };
  const calendar = validateCalendarPlan(p, query), records = normalizeRawRows([row(0), row(2)], context({ calendar })).records;
  const quality = assessCoverage(records, calendar, true, TO); assert.equal(quality.coverageComplete, true); assert.equal(quality.expectedClosures.length, 1);
});
test('bar during expected closure is rejected', () => {
  const p = plan(); p.intervals[0].kind = 'EXPECTED_CLOSURE';
  assert.throws(() => normalizeRawRows([row()], context({ calendar: validateCalendarPlan(p, query) })));
});
test('missing interval stays unknown without fabricated flat candle', () => {
  const calendar = context().calendar, records = normalizeRawRows([row(0), row(2)], context()).records;
  const quality = assessCoverage(records, calendar, true, TO);
  assert.equal(quality.coverageComplete, false); assert.equal(quality.gaps[0].reason, 'UNKNOWN_SOURCE_ABSENCE'); assert.equal(records.length, 2);
});
test('no trade classification needs independent evidence', () => {
  const records = normalizeRawRows([row(0), row(2)], context()).records, missing = plan().intervals[1].start;
  assert.throws(() => assessCoverage(records, context().calendar, true, TO, [{ intervalStart: missing }]));
  const quality = assessCoverage(records, context().calendar, true, TO, [{ intervalStart: missing, source: 'VERIFIED_SOURCE_ACTIVITY', evidenceId: 'FIXTURE_TRADE_QUERY' }]);
  assert.equal(quality.coverageComplete, true); assert.equal(quality.verifiedNoTrades.length, 1);
});
test('no trade cannot contradict a real row', () => assert.throws(() => assessCoverage(
  normalizeRawRows([row(0)], context()).records, context().calendar, true, TO,
  [{ intervalStart: FROM, source: 'VERIFIED_SOURCE_ACTIVITY', evidenceId: 'FIXTURE' }])));
test('partial period remains unavailable independently of completed earlier bars', () => {
  const records = normalizeRawRows([row(0), row(1)], context()).records;
  const quality = assessCoverage(records, context().calendar, true, '2026-10-12T13:02:30Z');
  assert.equal(quality.gaps.at(-1).reason, 'PARTIAL_PERIOD');
});
test('session trading date need not equal UTC interval start date', () => {
  const p = plan(); p.intervals.forEach(x => { x.tradingDate = '2026-10-13'; });
  const calendar = validateCalendarPlan(p, query);
  const a = normalizeRawRows([row(0, { session_end_date: '2026-10-13' })], context({ calendar }));
  assert.equal(a.records[0].tradingDate, '2026-10-13');
});
