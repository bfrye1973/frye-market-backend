// Design invariants only; not an implementation or replacement for PR #102.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../../../logic/engine11/rawCandles/identity.js';
const sourceKey = x => hash(['source-key-v2-proposal',x.provider,x.contract,x.resolution,x.timestampNs,x.sessionLabel,x.alignmentVersion]);
const revision = x => hash([sourceKey(x),hash(x.payload)]);
const observation = x => hash([x.receiptId,x.page,x.ordinal,hash(x.payload)]);
const canonical = x => hash(['analytical-key-v2-proposal',x.series,x.contractLineage,x.basis,x.calendar,x.policy,x.start,x.end]);
const source = { provider:'MASSIVE_FUTURES',contract:'CME:ES:2026-09',resolution:'4hour',timestampNs:'1788984000000000000',sessionLabel:'2026-09-09',alignmentVersion:'UNRESOLVED',payload:{close:7648},receiptId:'a',page:1,ordinal:1 };
test('proposal preserves same timestamp across sessions without treating as correction',()=>assert.notEqual(sourceKey(source),sourceKey({...source,sessionLabel:'2026-09-10'})));
test('proposal preserves overlapping quarterly contracts',()=>assert.notEqual(sourceKey(source),sourceKey({...source,contract:'CME:ES:2026-12'})));
test('content changes are candidate revisions of same source key, never proof of correction',()=>{
  const next={...source,payload:{close:7652}};assert.equal(sourceKey(source),sourceKey(next));assert.notEqual(revision(source),revision(next));
});
test('repeat observation receipt preserved independently of unchanged source revision',()=>{
  const next={...source,receiptId:'b'};assert.equal(revision(source),revision(next));assert.notEqual(observation(source),observation(next));
});
test('row ordinal preserves byte-equivalent repeats within one receipt',()=>assert.notEqual(observation(source),observation({...source,ordinal:2})));
test('native resolutions cannot share source identity',()=>assert.notEqual(sourceKey(source),sourceKey({...source,resolution:'1hour'})));
test('full source timestamp remains exact decimal text',()=>assert.notEqual(sourceKey(source),sourceKey({...source,timestampNs:'1788984000000000001'})));
test('canonical interval identity is independent of provider label',()=>{
  const x={series:'ES-raw-contract',contractLineage:'lineage1',basis:'RAW_CONTRACT',calendar:'c1',policy:'p1',start:'2026-09-09T20:00:00Z',end:'2026-09-09T21:00:00Z'};
  assert.equal(canonical(x),canonical({...x,providerLabel:'other'}));
  for(const field of ['series','contractLineage','basis','calendar','policy','start','end'])assert.notEqual(canonical(x),canonical({...x,[field]:'changed'}));
});
