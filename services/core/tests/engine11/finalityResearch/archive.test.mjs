import test from 'node:test';import assert from 'node:assert/strict';
import { packResearch,restoreResearch } from '../../../logic/engine11/finalityResearchV1/archive.js';
const make=()=>packResearch([{name:'original-response.json',bytes:Buffer.from('{ "window_start": 1738274340000000000, "results": [] }\n')},{name:'receipt.json',bytes:Buffer.from('fixture-original-byte-proof')}]);
test('sandbox archive restores exact original bytes with compressed and raw manifests',()=>{const a=make(),r=restoreResearch(a);assert.equal(r[0].bytes.toString(),'{ "window_start": 1738274340000000000, "results": [] }\n');assert.equal(a.manifest.durable,false);assert.equal(a.manifest.structuralEligible,false);});
test('archive manifest mutation rejected',()=>{const a=make();a.manifest.totalRawBytes++;assert.throws(()=>restoreResearch(a),/MANIFEST/);});
test('compressed archive corruption rejected before decoding',()=>{const a=make();a.files[0].gzipBase64=Buffer.from('wrong').toString('base64');assert.throws(()=>restoreResearch(a),/COMPRESSED_DIGEST/);});
test('archive names reject traversal, collisions and absolute destinations',()=>{for(const names of [['../original'],['/absolute'],['duplicate','duplicate']])assert.throws(()=>packResearch(names.map(name=>({name,bytes:Buffer.from('x')}))),/ARCHIVE_NAME/);});
test('bounded archive and restore reject excessive bytes',()=>{assert.throws(()=>packResearch([{name:'x',bytes:Buffer.alloc(5)}],{maxBytes:4}),/BYTE_BUDGET/);assert.throws(()=>restoreResearch(make(),{maxBytes:4}),/BYTE_BUDGET/);});
test('missing archive member rejected',()=>{const a=make();a.files.pop();assert.throws(()=>restoreResearch(a),/MANIFEST/);});
