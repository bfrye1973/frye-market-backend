// Engine18 PRIVATE PROVISIONING STANDBY — NO LIVE MARKET DATA.
 // Strictly prepares host capability evidence for a later manager-approved trial.
 // No Ironbeam auth, source socket, R2 upload, chart, trading or HTTP listener.
import {existsSync,mkdirSync,readFileSync,statSync,statfsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const MOUNT='/var/data/engine18-recorder';
const authorized=process.env.ENGINE18_LIVE_CAPTURE_APPROVED==='YES' ||
 process.env.ENGINE18_MANAGER_TRIAL_ACCEPTED==='YES';
if(authorized){
 process.stderr.write('ENGINE18_STANDBY_REFUSED_LIVE_FLAGS\n');
 process.exit(78);
}
function diskMounted(){
 try{
  const table=readFileSync('/proc/self/mountinfo','utf8');
  return table.split('\n').some(line=>{
   const head=line.split(' - ')[0].trim().split(/\s+/);
   return head.length>4&&head[4]===MOUNT;
  });
 }catch{return false;}
}
function inspectClock(){
 // No shell, credentials, network or privileged host changes. Chrony parser
 // quality remains separately required; command success alone is not proof.
 const result=spawnSync('chronyc',['tracking','-n'],{
  encoding:'utf8',timeout:2000,windowsHide:true,maxBuffer:8192
 });
 return {
  commandAvailable:!result.error || result.error.code!=='ENOENT',
  commandSuccess:result.status===0,
  trackingOutputPresent:result.status===0&&/Ref time \(UTC\)|Reference ID/.test(result.stdout||'')
 };
}
function snapshot(){
 let diskFreeBytes=null,diskTotalBytes=null,recordsWritable=false;
 try{
  if(diskMounted()){
   const folder=MOUNT+'/records';
   mkdirSync(folder,{recursive:true,mode:0o700});
   recordsWritable=statSync(folder).isDirectory();
   const stat=statfsSync(MOUNT,{bigint:true});
   diskFreeBytes=String(stat.bavail*stat.bsize);
   diskTotalBytes=String(stat.blocks*stat.bsize);
  }
 }catch{}
 const status={
  schema:'engine18.privateStandby.v1',
  liveCaptureActive:false,
  ironbeamConnectionActive:false,
  backupUploadsActive:false,
  privateDiskMounted:diskMounted(),
  recordsDirectoryReady:recordsWritable,
  diskFreeBytes,diskTotalBytes,
  chrony:inspectClock(),
  clockQuality:'UNVERIFIED_UNTIL_INDEPENDENT_VALIDATION',
  serviceRole:'PRIVATE_STANDBY_ONLY'
 };
 return status;
}
if(!existsSync(MOUNT))process.stderr.write('ENGINE18_PRIVATE_STANDBY_DISK_NOT_PRESENT\n');
process.stdout.write('ENGINE18_PRIVATE_HOST_CHECK '+JSON.stringify(snapshot())+'\n');
const timer=setInterval(()=>{
 process.stdout.write('ENGINE18_PRIVATE_HOST_CHECK '+JSON.stringify(snapshot())+'\n');
},60000);
process.once('SIGTERM',()=>{clearInterval(timer);process.exit(0);});
process.once('SIGINT',()=>{clearInterval(timer);process.exit(0);});
