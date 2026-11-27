import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {readDailyPaperEvidence as read} from "../logic/trading/engine8DailyEvidenceReader.js";
const root="/synthetic";
const opts={paperDir:root,journalDir:root};
test("missing evidence stays null",()=>{const x=read({...opts,read:()=>({status:"UNAVAILABLE",reason:"FILE_NOT_FOUND"})});assert.equal(x.values.orders,null);assert.equal(x.coverage,"UNPROVEN");});
test("changed store invalidates entire capture",()=>{let n=0;const x=read({...opts,read:()=>({status:"OK",sha256:String(n++),value:[]})});assert.equal(x.stability,"CHANGED");assert.ok(Object.values(x.values).every(v=>v===null));});
test("invalid shape never becomes empty store",()=>{const x=read({...opts,read:()=>({status:"OK",sha256:"same",value:{}})});assert.equal(x.stores.orders.reason,"INVALID_STORE_SHAPE");assert.equal(x.values.orders,null);});
test("bounded actual file capture is read only and rejects corrupt JSON and symlink",()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),"e8e-test-"));try{const o=path.join(d,"paper-orders.json");fs.writeFileSync(o,"[]");fs.writeFileSync(path.join(d,"paper-executions.json"),"{");fs.symlinkSync(o,path.join(d,"trade-journal.json"));const x=read({paperDir:d,journalDir:d});assert.deepEqual(x.values.orders,[]);assert.equal(x.stores.executions.reason,"JSON_PARSE_FAILED");assert.equal(x.stores.journal.reason,"UNSAFE_FILE");assert.equal(fs.readFileSync(o,"utf8"),"[]");assert.equal(read({paperDir:d,journalDir:d,maxBytes:1}).values.orders,null);}finally{fs.rmSync(d,{recursive:true,force:true});}});

test("store metadata binds exact bytes and read interval",()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),"e8e-meta-"));try{fs.writeFileSync(path.join(d,"paper-orders.json"),"[]");const x=read({paperDir:d,journalDir:d});assert.equal(x.stores.orders.byteLength,2);assert.match(x.stores.orders.sha256,/^[a-f0-9]{64}$/);assert.ok(Date.parse(x.stores.orders.finishedAt)>=Date.parse(x.stores.orders.readAt));}finally{fs.rmSync(d,{recursive:true,force:true});}});
test("parent symlink is not an authorized evidence root",()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),"e8e-parent-"));try{const actual=path.join(d,"actual"),link=path.join(d,"link");fs.mkdirSync(actual);fs.writeFileSync(path.join(actual,"paper-orders.json"),"[]");fs.symlinkSync(actual,link);const x=read({paperDir:link,journalDir:actual});assert.equal(x.stores.orders.reason,"UNSAFE_EVIDENCE_ROOT");assert.equal(x.values.orders,null);}finally{fs.rmSync(d,{recursive:true,force:true});}});
test("two observed read-race failures still invalidate capture",()=>{const x=read({...opts,read:()=>({status:"ERROR",reason:"STORE_CHANGED_DURING_READ"})});assert.equal(x.stability,"CHANGED");});
