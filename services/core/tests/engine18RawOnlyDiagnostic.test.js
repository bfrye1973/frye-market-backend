import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {verifyEngine18RawOnlyEnvironment,runEngine18RawOnlyDiagnostic} from '../logic/engine18/engine18RawOnlyDiagnosticWorker.js';
const m='/var/data/engine18-recorder',root=m+'/records';
const env=()=>({
 IRONBEAM_USERNAME:'protected-user',IRONBEAM_PASSWORD:'protected-password',
 IRONBEAM_API_KEY:'protected-key',
 ENGINE18_R2_ENDPOINT:'https://test.example.invalid',
 ENGINE18_R2_BUCKET:'private-test',ENGINE18_R2_ACCESS_KEY:'access',
 ENGINE18_R2_SECRET_KEY:'longsecret',ENGINE18_R2_ENCRYPTION_KEY_HEX:'a'.repeat(64),
 ENGINE18_R2_KEY_ID:'key-v1',ENGINE18_INDEPENDENT_INVENTORY_PIN:'0',
 ENGINE18_RECORDER_DISK:root,ENGINE18_RAW_DIAGNOSTIC_CONTRACT:'XCME:ES.Z26',
 ENGINE18_RAW_DIAGNOSTIC_MINUTES:'1',
 ENGINE18_RAW_DIAGNOSTIC_OWNER_APPROVED:'YES',
 ENGINE18_RAW_DIAGNOSTIC_MANAGER_APPROVED:'YES',
 ENGINE18_RAW_DIAGNOSTIC_RESTORE_VERIFIED:'YES',
 ENGINE18_RAW_DIAGNOSTIC_RESTORE_RECEIPT:'RESTORED-SYNTHETIC-001',
 ENGINE18_RAW_DIAGNOSTIC_COST_APPROVED:'YES',
 ENGINE18_RAW_DIAGNOSTIC_OPERATOR_START:'YES',
 ENGINE18_IRONBEAM_ES_DEMO_ENTITLED:'YES',
 ENGINE18_CME_CALENDAR_VERIFIED:'YES',
 ENGINE18_LIVE_CAPTURE_APPROVED:'NO',
 ENGINE18_MANAGER_TRIAL_ACCEPTED:'NO',
 ENGINE18_PRIVATE_STANDBY:'NO'
});
const validate={stat:()=>({isDirectory:()=>true}),mountTable:()=> '42 11 0:1 / '+m+' rw - ext4 /dev/mock rw'};
test('strict 1-5 minute ES-only manual activation, dedicated disk and independent backup gates',()=>{
 assert.equal(verifyEngine18RawOnlyEnvironment(env(),validate).clockQuality,'UNVERIFIED');
 for(const name of ['ENGINE18_RAW_DIAGNOSTIC_OWNER_APPROVED','ENGINE18_RAW_DIAGNOSTIC_MANAGER_APPROVED',
 'ENGINE18_RAW_DIAGNOSTIC_RESTORE_VERIFIED','ENGINE18_RAW_DIAGNOSTIC_COST_APPROVED',
 'ENGINE18_IRONBEAM_ES_DEMO_ENTITLED','ENGINE18_CME_CALENDAR_VERIFIED',
 'ENGINE18_RAW_DIAGNOSTIC_OPERATOR_START']){
  const altered=env();altered[name]='NO';
  assert.throws(()=>verifyEngine18RawOnlyEnvironment(altered,validate),/gate closed/);
 }
 for(const minutes of ['0','6','2.5','-1']){
  const altered=env();altered.ENGINE18_RAW_DIAGNOSTIC_MINUTES=minutes;
  assert.throws(()=>verifyEngine18RawOnlyEnvironment(altered,validate),/1-5 minutes/);
 }
 for(const v of ['/var/data/replay/journal',root+'/../other']){
  const altered=env();altered.ENGINE18_RECORDER_DISK=v;
  assert.throws(()=>verifyEngine18RawOnlyEnvironment(altered,validate),/dedicated ES/);
 }
 const stale=env();stale.ENGINE18_INDEPENDENT_INVENTORY_PIN='not-a-number';
 assert.throws(()=>verifyEngine18RawOnlyEnvironment(stale,validate),/independently pinned/);
 const insecure=env();insecure.ENGINE18_R2_ENDPOINT='http://test.example.invalid';
 assert.throws(()=>verifyEngine18RawOnlyEnvironment(insecure,validate),/HTTPS/);
 const live=env();live.ENGINE18_LIVE_CAPTURE_APPROVED='YES';
 assert.throws(()=>verifyEngine18RawOnlyEnvironment(live,validate),/must not share/);
 const standby=env();standby.ENGINE18_PRIVATE_STANDBY='YES';
 assert.throws(()=>verifyEngine18RawOnlyEnvironment(standby,validate),/standby mode/);
 assert.throws(()=>verifyEngine18RawOnlyEnvironment(env(),{...validate,mountTable:()=>''}),/mount not verified/);
});
test('capture cannot begin without operator signal or an independently pinned inventory',async()=>{
 await assert.rejects(runEngine18RawOnlyDiagnostic({env:env(),WebSocketImpl:class Dummy{}}),/operator stop signal/);
 const controller=new AbortController();let attempted=0;
 await assert.rejects(runEngine18RawOnlyDiagnostic({
  env:env(),operatorSignal:controller.signal,WebSocketImpl:class Dummy{},
  dependencies:{validation:validate,
   createStore:()=>({}),
   createCoordinator:()=>({inventory:async()=>{attempted++;throw Error('remote pin mismatch');}}),
   openRecorder:()=>{throw Error('recorder must not open before inventory');}}
 }),/remote pin mismatch/);
 assert.equal(attempted,1);
});
function mockComponents({disconnect=false,backupFail=false}={}){
 let recorderClosed=false,frames=0,sourceStopped=false,backupSyncs=0,opened=0,sourceStarted=0;
 let onSourceAlert,writerFailed=false;
 const writer={
  offer:async()=>{frames++;return {receivedWallNs:'1'};},
  fail:()=>{writerFailed=true;},
  close:async()=>{recorderClosed=true;},
  health:()=>({failedClosed:writerFailed,rejected:0,gapCount:disconnect?1:0,
   recorded:frames,recordingActive:!recorderClosed&&!writerFailed,unacknowledged:0,
   diskFreeBytes:'40000000000',diskTotalBytes:'50000000000'})
 };
 const source={
  start:async()=>{sourceStarted++;if(disconnect)onSourceAlert('SOURCE_DISCONNECTED');return true;},
  stop:async()=>{sourceStopped=true;},
  health:()=>({active:true,connected:!disconnect,disconnections:disconnect?1:0,
   reconnects:0,captureUncertain:disconnect,framesReceived:1})
 };
 const backup={inventory:async()=>({lastSeq:0}),syncClosed:async()=>{
  backupSyncs++;if(backupFail)throw Error('private backup failed');
 }};
 const scheduler={tick:async()=>{},start:()=>{},stop:async()=>{},health:()=>({
  failures:0,lastFailureAtMs:null})};
 return {parts:{validation:validate,createStore:()=>({}),createCoordinator:()=>backup,
   openRecorder:async()=>{opened++;return writer;},
   createScheduler:()=>scheduler,
   createSource:({onAlert})=>{onSourceAlert=onAlert;return source;}},
  state:()=>({recorderClosed,frames,sourceStopped,backupSyncs,opened,sourceStarted,writerFailed})};
}
test('manual stop seals recorder then verifies encrypted remote inventory; raw-only identity remains unverified',async()=>{
 const setup=mockComponents(),signal=new AbortController();
 const session=await runEngine18RawOnlyDiagnostic({env:env(),WebSocketImpl:class Dummy{},
  operatorSignal:signal.signal,dependencies:setup.parts});
 assert.equal(session.mode,'RAW_FRAMES_ONLY');
 assert.equal(session.health().clockQuality,'UNVERIFIED');
 assert.equal(session.health().timingInferenceAllowed,false);
 const result=await session.stop('OPERATOR_STOP');
 assert.equal(result.remoteArchiveVerified,true);
 assert.equal(result.postTrialIndependentRestoreVerified,false);
 assert.equal(result.clockQuality,'UNVERIFIED');
 assert.equal(setup.state().sourceStopped,true);
 assert.equal(setup.state().recorderClosed,true);
 assert.equal(setup.state().backupSyncs,1);
 assert.equal(await session.stop('OPERATOR_STOP'),result);
});
test('disconnect/GAP immediately marks output unclean and requires recovery',async()=>{
 const setup=mockComponents({disconnect:true}),signal=new AbortController();
 await assert.rejects(runEngine18RawOnlyDiagnostic({env:env(),WebSocketImpl:class Dummy{},
  operatorSignal:signal.signal,dependencies:setup.parts}),/failed closed/);
 assert.equal(setup.state().writerFailed,true);
 assert.equal(setup.state().sourceStopped,true);
 assert.equal(setup.state().recorderClosed,false);
});
test('backup failures never count as successful clean restore',async()=>{
 const setup=mockComponents({backupFail:true}),signal=new AbortController();
 const session=await runEngine18RawOnlyDiagnostic({env:env(),WebSocketImpl:class Dummy{},
  operatorSignal:signal.signal,dependencies:setup.parts});
 await assert.rejects(session.stop('OPERATOR_STOP'),/private encrypted final archive upload failed/);
 assert.equal(setup.state().backupSyncs,1);
});
test('existing clock-verified recording code and original 5ms gate remain unmodified',()=>{
 const p=path.resolve(import.meta.dirname,'../logic/engine18/engine18ControlledLiveWorker.js');
 const code=fs.readFileSync(p,'utf8');
 assert.match(code,/makeChronySampler/);
 assert.match(code,/5000000n/);
 assert.doesNotMatch(code,/ENGINE18_RAW_DIAGNOSTIC_OWNER_APPROVED/);
 const standby=fs.readFileSync(path.resolve(import.meta.dirname,'../logic/engine18/engine18PrivateStandby.js'),'utf8');
 assert.doesNotMatch(standby,/engine18RawOnlyDiagnosticEntrypoint/);
});
