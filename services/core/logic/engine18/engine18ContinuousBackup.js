// Engine18 Phase5 synthetic closed-hour backup supervisor.
// Runs independently of market intake; never touches active .jsonl.open.
// No production object-store connection or licensed market-data connection.
export class Engine18ContinuousBackup{
 constructor({backup,intervalMs=30000,onFailure=()=>{}}={}){
  if(!backup||(typeof backup.backupClosed!=='function'&&typeof backup.syncClosed!=='function')||!Number.isSafeInteger(intervalMs)||intervalMs<1||typeof onFailure!=='function')
   throw Error('backup and positive interval required');
  this.backup=backup;this.sync=typeof backup.syncClosed==='function'?()=>backup.syncClosed():()=>backup.backupClosed();
  this.intervalMs=intervalMs;this.onFailure=onFailure;
  this.timer=null;this.active=false;this.inFlight=null;this.attempts=0;this.failures=0;
  this.lastSuccessAtMs=null;this.lastFailureAtMs=null;
 }
 tick(){
  if(this.inFlight)return this.inFlight;
  this.attempts++;
  const work=Promise.resolve().then(()=>this.sync()).then(result=>{
   this.lastSuccessAtMs=Date.now();return result;
  },err=>{
   this.failures++;this.lastFailureAtMs=Date.now();
   try{this.onFailure('PRIVATE_BACKUP_FAILED');}catch{}
   throw Error('closed-hour backup failed; recorder intake unaffected');
  });
  const tracked=work.finally(()=>{if(this.inFlight===tracked)this.inFlight=null;});
  this.inFlight=tracked;return tracked;
 }
 start(){
  if(this.active)throw Error('backup already scheduled');
  this.active=true;
  this.timer=setInterval(()=>{void this.tick().catch(()=>{});},this.intervalMs);
  this.timer.unref?.();
 }
 async stop(){
  this.active=false;if(this.timer){clearInterval(this.timer);this.timer=null;}
  if(this.inFlight)await this.inFlight.catch(()=>{});
 }
 health({nowMs=Date.now()}={}){
  const source=this.backup.health?.({nowMs})??{};
  return Object.freeze({schema:'engine18.continuousBackup.health.v1',active:this.active,
   inFlight:this.inFlight!==null,attempts:this.attempts,failures:this.failures,
   backupLagMs:this.lastSuccessAtMs===null?null:Math.max(0,nowMs-this.lastSuccessAtMs),
   lastFailureAtMs:this.lastFailureAtMs,pendingRotationArchives:source.pendingRotationArchives??null,
   completedArchives:source.completedArchives??source.remoteArchived??null,
   retryCount:source.retries??null});
 }
}
