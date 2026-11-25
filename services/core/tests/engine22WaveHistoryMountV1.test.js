import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyEngine22HistoryMount} from "../logic/engine22/history/verifyHistoryMountV1.js";
test("rejects absent and unverified mounts without writing",()=>{
 const root=mkdtempSync(join(tmpdir(),"e22mount-"));
 try{
  const directory=join(root,"engine22-wave-history");
  assert.equal(verifyEngine22HistoryMount({directory,mountPath:root,mountInfoPath:join(root,"missing")}).ok,false);
  const fake=join(root,"mountinfo");
  writeFileSync(fake,"1 0 0:1 / /other rw - ext4 /dev/fake rw\n");
  assert.equal(verifyEngine22HistoryMount({directory,mountPath:root,mountInfoPath:fake}).reason,"PERSISTENT_MOUNT_UNVERIFIED");
  assert.equal(verifyEngine22HistoryMount({directory:root,mountPath:root,mountInfoPath:fake}).reason,"HISTORY_DIRECTORY_OUTSIDE_DEDICATED_SUBFOLDER");
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("accepts isolated directory only when mountinfo identifies the mount",()=>{
 const root=mkdtempSync(join(tmpdir(),"e22mount-"));
 try{
  const directory=join(root,"engine22-wave-history");
  mkdirSync(directory);
  const fake=join(root,"mountinfo");
  writeFileSync(fake,`1 0 0:1 / ${root} rw - ext4 /dev/fake rw\n`);
  assert.equal(verifyEngine22HistoryMount({directory,mountPath:root,mountInfoPath:fake}).ok,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
