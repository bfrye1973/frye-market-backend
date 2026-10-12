import test from 'node:test';
import assert from 'node:assert/strict';
import { targetWindows, degreeInputs } from './march2020Plan.mjs';
test('March target keeps seven inputs independent and native', () => {
  assert.equal(degreeInputs.length, 7);
  assert.deepEqual(degreeInputs.map(x => x.timeframe), ['5m', '10m', '1h', '4h', '1d', '1w', '1mo']);
  assert.equal(degreeInputs.at(-1).resolution, '1month');
});
test('target covers March 2020 through exact observation time without future requests', () => {
  const asOf = '2026-10-12T23:00:00.000Z';
  const windows = targetWindows(asOf), primary = windows.filter(x => x.role.startsWith('CALENDAR'));
  assert.equal(primary[0].from, '2020-03-01T00:00:00.000Z');
  assert.equal(primary.at(-1).to, asOf);
  for (let i = 1; i < primary.length; i++) assert.equal(primary[i - 1].to, primary[i].from);
  assert.ok(windows.every(x => Date.parse(x.to) <= Date.parse(asOf)));
});
test('2020 transition includes explicit H and M same-window evidence', () => {
  const windows = targetWindows('2026-10-12T23:00:00.000Z');
  assert.equal(windows[0].fullContract, 'ESH2020');
  assert.equal(windows.at(-1).fullContract, 'ESM2020');
  assert.equal(windows[0].from, windows.at(-1).from);
  assert.equal(windows[0].to, windows.at(-1).to);
});
test('research rejects invalid target without implying canonical anchor', () => {
  assert.throws(() => targetWindows('invalid'));
  assert.throws(() => targetWindows('2020-02-01T00:00:00Z'));
});
