import test from 'node:test';
import assert from 'node:assert/strict';
import {ENGINE18_DAILY_SCHEMA,EXISTING_REAL_PIN,LEGACY_SYNTHETIC_PIN,
 EXISTING_RAW_NAMESPACE,PRIVATE_DISK,evaluateEngine18DailyRawSession,
 evaluateEngine18DailyRunHealth} from '../logic/engine18/engine18DailyRawSessionReadiness.js';
const GB=1024**3;
const fixture=()=>({
 plan:{schema:ENGINE18_DAILY_SCHEMA,executionMode:'PREPARE_ONLY',startApproved:false,
  calendarVerified:true,isCmeHoliday:false,sessionSource:'APPROVED_CME_ES_CALENDAR',
  startUtc:'2026-11-18T00:00:00.000Z',stopUtc:'2026-11-18T23:00:00.000Z',
  contract:'XCME:ES.Z26',contractApproval:'PINNED_PHYSICAL_CONTRACT',
  feedTypes:['depths','quotes','trades'],priceBasisPolicy:'RAW_PHYSICAL_NO_ROLL',
  ownerLicenseApproved:true,ownerCostApproved:true,budgetCents:5000,
  retentionDays:30,maxQueued:4096,maxQueueBytes:32*1024*1024,
  maxBackupLagMs:120000,maxRemoteBytes:20*GB},
 inventory:{namespace:EXISTING_RAW_NAMESPACE,...EXISTING_REAL_PIN,
  syntheticLastSeq:LEGACY_SYNTHETIC_PIN.lastSeq,
  syntheticHeadHash:LEGACY_SYNTHETIC_PIN.headHash,
  localReplayVerified:true,appendOnlyRecoveryVerified:true,independentR2RestoreVerified:true},
 disk:{mountPath:PRIVATE_DISK,sizeGB:50,totalBytes:50*GB,freeBytes:40*GB},
 sourceEntitlement:{licensedEsDepthQuotesTrades:true,storageRetentionConfirmed:true},
 clock:{quality:'VERIFIED_5MS'},
 storage:{aes256GcmVerified:true,immutableWriteVerified:true,
  backupFailsClosed:true,queueFailClosed:true},
 nowMs:Date.parse('2026-11-17T12:00:00.000Z')
});
const gate=x=>evaluateEngine18DailyRawSession(x);
test('synthetic all-green plan is still PREPARE-ONLY, never connects to source',()=>{
 const r=gate(fixture());
 assert.equal(r.ok,true);assert.equal(r.marketConnectionAllowed,false);
 assert.equal(r.tradingAllowed,false);assert.equal(r.readiness,'PREPARED_NOT_AUTHORIZED_TO_RECORD');
});
test('no implicit owner approval, indefinite session or wrong calendar',()=>{
 for(const mutate of [
  x=>{x.plan.startApproved=true},
  x=>{x.plan.executionMode='RUN'},
  x=>{x.plan.stopUtc='2026-11-20T00:00:00.000Z'},
  x=>{x.plan.isCmeHoliday=true},
  x=>{x.plan.calendarVerified=false},
  x=>{x.plan.stopUtc=x.plan.startUtc},
  x=>{x.nowMs=Date.parse(x.plan.stopUtc)}
 ]){const x=fixture();mutate(x);assert.equal(gate(x).ok,false);}
});
test('CME contract roll must be explicit; reject unlicensed or wrong subscription',()=>{
 const x=fixture();x.plan.contract='XCME:ES.H27';
 assert.equal(gate(x).reason,'ROLLOVER_UNVERIFIED');
 x.plan.rollDecisionApproved=true;assert.equal(gate(x).ok,true);
 x.plan.contract='XCME:ES.M27';assert.equal(gate(x).ok,false);
 x.plan.contract='XCME:ES.Z26';x.plan.feedTypes=['depths','trades'];
 assert.equal(gate(x).ok,false);
});
test('real pinned lastSeq=492/remote hash and legacy synthetic 4 protected',()=>{
 for(const mutate of [
  x=>{x.inventory.lastSeq=0},
  x=>{x.inventory.lastSeq=493},
  x=>{x.inventory.headHash='0'.repeat(64)},
  x=>{x.inventory.syntheticLastSeq=0},
  x=>{x.inventory.syntheticHeadHash='0'.repeat(64)},
  x=>{x.inventory.localReplayVerified=false},
  x=>{x.inventory.appendOnlyRecoveryVerified=false},
  x=>{x.inventory.independentR2RestoreVerified=false}
 ]){const x=fixture();mutate(x);assert.equal(gate(x).ok,false);}
});
test('reject clock exception, insufficient dedicated disk or missing R2 protections',()=>{
 for(const mutate of [
  x=>{x.clock.quality='UNVERIFIED'},
  x=>{x.disk.freeBytes=9*GB},
  x=>{x.disk.sizeGB=100},
  x=>{x.storage.aes256GcmVerified=false},
  x=>{x.storage.backupFailsClosed=false},
  x=>{x.plan.ownerCostApproved=false},
  x=>{x.sourceEntitlement.storageRetentionConfirmed=false},
  x=>{x.plan.priceBasisPolicy='ROLL_ADJUST'},
  x=>{x.plan.maxQueueBytes=33*1024*1024},
  x=>{x.plan.maxRemoteBytes=Infinity}
 ]){const x=fixture();mutate(x);assert.equal(gate(x).ok,false);}
});
const healthy=()=>({
 nowMs:100,stopMs:10000,
 writer:{recordingActive:true,failedClosed:false,rejected:0,gapCount:0,
  unacknowledged:1,diskFreeBytes:40*GB,diskTotalBytes:50*GB},
 source:{active:true,connected:true,captureUncertain:false,disconnections:0,reconnects:0},
 backup:{failures:0,lastFailureAtMs:null,inFlight:false,backupLagMs:30000},
 remoteBytes:10,maxRemoteBytes:100
});
test('healthy report is read-only and hard deadline prevents indefinite capture',()=>{
 assert.deepEqual(evaluateEngine18DailyRunHealth(healthy()),{stop:false,reason:null});
 const a=healthy();a.nowMs=a.stopMs;
 assert.equal(evaluateEngine18DailyRunHealth(a).reason,'HARD_SESSION_DEADLINE');
});
test('headroom, queue, gaps, reconnect, backup and budget fail closed',()=>{
 for(const [mutate,reason] of [
  [x=>{x.writer.diskFreeBytes=9*GB},'LOCAL_RECORDING_UNSAFE'],
  [x=>{x.writer.unacknowledged=3686},'LOCAL_RECORDING_UNSAFE'],
  [x=>{x.writer.gapCount=1},'LOCAL_RECORDING_UNSAFE'],
  [x=>{x.source.reconnects=1},'SOURCE_CONTINUITY_UNVERIFIED'],
  [x=>{x.source.captureUncertain=true},'SOURCE_CONTINUITY_UNVERIFIED'],
  [x=>{x.backup.failures=1},'REMOTE_BACKUP_UNSAFE'],
  [x=>{x.backup.backupLagMs=120001},'REMOTE_BACKUP_UNSAFE'],
  [x=>{x.remoteBytes=100},'REMOTE_BUDGET_LIMIT']
 ]){const x=healthy();mutate(x);assert.equal(evaluateEngine18DailyRunHealth(x).reason,reason);}
});
test('no recording activation API exists in preparation module',async()=>{
 const mod=await import('../logic/engine18/engine18DailyRawSessionReadiness.js');
 assert.ok(!Object.keys(mod).some(k=>/start|connect|trade|record|subscribe|capture/i.test(k)));
});
