// Phase 3 trusted clock source adapter. Read-only; no shell, network credentials,
// or raw chronyc output in status/errors. Never fabricate offsets when unavailable.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
export function parseChronyTracking(text,{nowMs=Date.now(),maxReferenceAgeMs=120000}={}){
 if(typeof text!=='string'||text.length>100000)return null;
 const lines=Object.fromEntries(text.split(/\r?\n/).map(x=>{
  const idx=x.indexOf(':');return idx<0?[]:[x.slice(0,idx).trim(),x.slice(idx+1).trim()];
 }).filter(x=>x.length));
 const stratum=Number(lines['Stratum']);
 if(!Number.isInteger(stratum)||stratum<1||stratum>15||lines['Leap status']!=='Normal')return null;
 const refDate=Date.parse(lines['Ref time (UTC)']||'');
 if(!Number.isFinite(refDate)||nowMs<refDate||nowMs-refDate>maxReferenceAgeMs)return null;
 const status=lines['System time']||'';
 const m=status.match(/^([+-]?\d+(?:\.\d+)?)\s+seconds\s+(fast|slow)\s+of\s+NTP\s+time$/i);
 const dispersion=Number((lines['Root dispersion']||'').match(/^([0-9.]+)\s+seconds$/)?.[1]);
 const rms=Number((lines['RMS offset']||'').match(/^([0-9.]+)\s+seconds$/)?.[1]);
 if(!m||!Number.isFinite(dispersion)||dispersion<0||!Number.isFinite(rms)||rms<0)return null;
 const magnitude=Number(m[1]);
 if(!Number.isFinite(magnitude)||magnitude<0)return null;
 const offsetNs=BigInt(Math.round(magnitude*1e9))*(m[2].toLowerCase()==='fast'?1n:-1n);
 const uncertaintyNs=BigInt(Math.ceil((dispersion+rms)*1e9));
 if(uncertaintyNs<0n)return null;
 return Object.freeze({verified:true,source:'CHRONY',offsetNs:String(offsetNs),uncertaintyNs:String(uncertaintyNs)});
}
export function makeChronySampler({command='chronyc',maxReferenceAgeMs=120000,exec=execFileAsync,now=()=>Date.now()}={}){
 if(command!=='chronyc')throw Error('only chronyc trusted source executable allowed');
 return async()=>{
  try{
   const result=await exec(command,['tracking','-n'],{timeout:2500,maxBuffer:100000});
   return parseChronyTracking(result.stdout,{nowMs:now(),maxReferenceAgeMs});
  }catch{return null;} // explicitly UNVERIFIED, no potentially secret-bearing stderr
 };
}
