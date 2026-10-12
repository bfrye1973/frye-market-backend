import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IsolatedRawStore, datasetFromAcquisition } from '../../logic/engine11/rawCandles/store.js';
import { createRawReader } from '../../logic/engine11/rawCandles/reader.js';
import { acquisition, FROM, TO, row, response } from './fixtures.js';

async function setup(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine11-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new IsolatedRawStore({ root, isolated: true }), source = await acquisition(overrides);
  const published = await store.publish(source), reader = createRawReader({ store, cursorSecret: 'fixture-cursor-key-longer-than-32-characters' });
  const query = { ...published, timeframe: '1m', from: FROM, to: TO };
  return { root, store, source, published, reader, query };
}

test('store requires explicit isolation and forbids production paths', () => {
  for (const args of [{ root: '/tmp/x' }, { root: 'relative', isolated: true }, { root: '/var/data/replay/engine11', isolated: true }, { root: '/opt/render/project', isolated: true }]) {
    assert.throws(() => new IsolatedRawStore(args));
  }
});
test('complete acquisition survives restart with immutable IDs', async t => {
  const { store, root, published } = await setup(t);
  const before = await store.read(published.datasetVersion), after = await new IsolatedRawStore({ root, isolated: true }).read(published.datasetVersion);
  assert.deepEqual(before, after); assert.equal(after.structuralEligible, false);
});
test('idempotent concurrent publication never clobbers objects', async t => {
  const { store, source, published } = await setup(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => store.publish(source)));
  results.forEach(x => assert.deepEqual(x, published));
});
test('correction creates new dataset, old revision preserved', async t => {
  const { store, published } = await setup(t);
  const revised = await acquisition({ fetchImpl: async () => response({ results: [row(0, { volume: 12 }), row(1), row(2)] }) });
  const next = await store.publish(revised); assert.notEqual(next.datasetVersion, published.datasetVersion);
  assert.equal((await store.read(published.datasetVersion)).records[0].volume, 10);
  assert.equal((await store.read(next.datasetVersion)).records[0].volume, 12);
});
test('incomplete acquisition cannot publish', async t => {
  const { store } = await setup(t);
  await assert.rejects(store.publish(await acquisition({ maxRows: 1 })), { code: 'INCOMPLETE_ACQUISITION_NOT_PUBLISHABLE' });
});
test('tampered prices, identities, finality and coverage cannot publish', async t => {
  const { source, store } = await setup(t);
  for (const change of [s => s.records[0].close = 7800.5, s => s.records[0].rawRevisionId = 'invented',
    s => s.records[0].structuralEligible = true, s => s.quality.coverageComplete = false,
    s => s.receipt.rawRevisionIds = []]) {
    const clone = structuredClone(source); change(clone); await assert.rejects(store.publish(clone));
  }
});
test('unknown coverage is preserved as truncated research, never eligibility', async t => {
  const { reader, query } = await setup(t, { fetchImpl: async () => response({ results: [row(0)] }) });
  const result = await reader(query); assert.equal(result.truncated, true); assert.equal(result.structuralEligible, false); assert.equal(result.bars.length, 1);
});
test('pinned pagination union has no gaps/duplicates and retries identical', async t => {
  const { reader, query } = await setup(t);
  const first = await reader({ ...query, limit: 1 }), second = await reader({ ...query, limit: 1, cursor: first.nextCursor });
  const third = await reader({ ...query, limit: 1, cursor: second.nextCursor });
  assert.equal(new Set([...first.bars, ...second.bars, ...third.bars].map(x => x.rawCandleId)).size, 3);
  assert.equal(third.hasMore, false); assert.equal(third.nextCursor, null);
  assert.deepEqual(await reader({ ...query, limit: 1 }), first);
});
test('cursor change/tamper and query drift rejected', async t => {
  const { reader, query } = await setup(t);
  const first = await reader({ ...query, limit: 1 });
  await assert.rejects(reader({ ...query, cursor: first.nextCursor.slice(0, -1) + (first.nextCursor.endsWith('a') ? 'b' : 'a') }), { code: 'INVALID_CURSOR' });
  await assert.rejects(reader({ ...query, cursor: first.nextCursor, from: '2026-10-12T13:01:00Z' }), { code: 'CURSOR_PIN_MISMATCH' });
  await assert.rejects(reader({ ...query, cursor: first.nextCursor, completedOnly: false }), { code: 'CURSOR_PIN_MISMATCH' });
});
test('cursor cannot cross dataset versions', async t => {
  const { reader, query, store } = await setup(t), first = await reader({ ...query, limit: 1 });
  const next = await store.publish(await acquisition({ fetchImpl: async () => response({ results: [row(0, { volume: 15 }), row(1), row(2)] }) }));
  await assert.rejects(reader({ ...query, ...next, cursor: first.nextCursor }), { code: 'CURSOR_PIN_MISMATCH' });
});
test('adjusted basis, structural and execution purposes rejected', async t => {
  const { reader, query } = await setup(t);
  for (const purpose of ['EXECUTION', 'STRUCTURAL', 'JOURNAL', 'RISK']) await assert.rejects(reader({ ...query, purpose }), { code: 'CONSUMER_NOT_AUTHORIZED' });
  await assert.rejects(reader({ ...query, priceBasis: 'CONTINUOUS_ADJUSTED' }));
});
test('read window cannot imply unpublished coverage', async t => {
  const { reader, query } = await setup(t);
  await assert.rejects(reader({ ...query, from: '2026-10-12T12:59:00Z' }), { code: 'READ_OUTSIDE_PUBLISHED_RANGE' });
  await assert.rejects(reader({ ...query, timeframe: '1w' }), { code: 'SERIES_QUERY_MISMATCH' });
});
test('asOf refuses evidence first observed later', async t => {
  const { reader, query, source } = await setup(t);
  const before = new Date(Date.parse(source.receipt.observedAt) - 1000).toISOString();
  await assert.rejects(reader({ ...query, asOf: before }));
  const later = new Date(Math.max(Date.parse(source.receipt.observedAt), Date.parse(TO)) + 1000).toISOString();
  assert.equal((await reader({ ...query, asOf: later })).count, 3);
});
test('unknown finality requires explicit provisional read', async t => {
  const { reader, query } = await setup(t, { sourceAsOf: null });
  assert.equal((await reader(query)).count, 0); assert.equal((await reader({ ...query, completedOnly: false })).count, 3);
});
test('content corruption detected rather than silently repaired', async t => {
  const { root, store, published } = await setup(t);
  await fs.writeFile(path.join(root, 'datasets', published.datasetVersion + '.json'), '{"bad":true}');
  await assert.rejects(store.read(published.datasetVersion), { code: 'CORRUPT_DATASET' });
});
test('bad or nonexistent version cannot switch to latest', async t => {
  const { store } = await setup(t);
  await assert.rejects(store.read('../latest'), { code: 'INVALID_DATASET_VERSION' });
  await assert.rejects(store.read('0'.repeat(64)), { code: 'DATASET_UNAVAILABLE' });
});
test('store rejects symlink redirect', async t => {
  const { root, source } = await setup(t), link = root + '-alias';
  await fs.symlink(root, link); t.after(() => fs.unlink(link));
  const store = new IsolatedRawStore({ root: link, isolated: true });
  await assert.rejects(store.publish(source), { code: 'STORE_SYMLINK_FORBIDDEN' });
});
test('publication failure before receipt leaves no false publication receipt', async t => {
  const { store, source, root } = await setup(t);
  const original = store.writeObject.bind(store);
  store.writeObject = async (kind, value) => { if (kind === 'receipts') throw Error('injected receipt failure'); return original(kind, value); };
  await assert.rejects(store.publish(source));
  store.writeObject = original;
  const published = await store.publish(source);
  assert.equal((await store.read(published.datasetVersion)).records.length, 3);
  assert.equal((await fs.readdir(path.join(root, 'receipts'))).length, 1);
});
test('orphan complete dataset is unreadable until publication manifest commits', async t => {
  const { store } = await setup(t);
  const source = await acquisition({ fetchImpl: async () => response({ results: [row(0, { volume: 21 }), row(1), row(2)] }) });
  const expected = datasetFromAcquisition(source).datasetVersion;
  const original = store.writeObject.bind(store);
  store.writeObject = async (kind, value, name) => { if (kind === 'publications') throw Error('injected publication crash'); return original(kind, value, name); };
  await assert.rejects(store.publish(source));
  await assert.rejects(store.read(expected), { code: 'DATASET_UNAVAILABLE' });
  store.writeObject = original;
  await store.publish(source); assert.equal((await store.read(expected)).records[0].volume, 21);
});
test('publication receipt corruption blocks reads', async t => {
  const { root, store, published } = await setup(t);
  await fs.writeFile(path.join(root, 'receipts', published.receiptId + '.json'), '{}');
  await assert.rejects(store.read(published.datasetVersion), { code: 'CORRUPT_PUBLICATION' });
});
test('symlink root rejected before creating any object directory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine11-empty-')), link = root + '-alias';
  await fs.symlink(root, link); t.after(async () => { await fs.unlink(link); await fs.rm(root, { recursive: true }); });
  const store = new IsolatedRawStore({ root: link, isolated: true });
  await assert.rejects(store.publish(await acquisition()), { code: 'STORE_SYMLINK_FORBIDDEN' });
  assert.deepEqual(await fs.readdir(root), []);
});
