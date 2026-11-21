// Phase 3 trusted clock source adapter. Read-only; no shell, network credentials,
// or raw chronyc output in status/errors. Never fabricate offsets when unavailable.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
const MONTHS=Object.freeze({Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11});
export function parseChronyReferenceUtc(value){
 if(typeof value!=='string')return null;
 // Chrony labels this field UTC but does not append a timezone to its output.
 // Strict Date.UTC avoids TZ-dependent Date.parse of "Tue Nov 10 20:59:30 2026".
 const m=value.trim().match(/^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/);
 if(!m)return null;
 const [,day,month,d,h,min,sec,year]=m;
 const Y=+year,M=MONTHS[month],D=+d,H=+h,I=+min,S=+sec;
 if(Y<2000||Y>9999||D<1||D>31||H>23||I>59||S>59)return null;
 const ms=Date.UTC(Y,M,D,H,I,S),date=new Date(ms);
 if(date.getUTCFullYear()!==Y||date.getUTCMonth()!==M||date.getUTCDate()!==D||
    date.getUTCHours()!==H||date.getUTCMinutes()!==I||date.getUTCSeconds()!==S)return null;
 if(day&&!new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(date).startsWith(day))return null;
 return ms;
}
export function parseChronyTracking(text,{nowMs=Date.now(),maxReferenceAgeMs=120000}={}){
 if(typeof text!=='string'||text.length>100000)return null;
 const lines=Object.fromEntries(text.split(/\r?\n/).map(x=>{
  const idx=x.indexOf(':');return idx<0?[]:[x.slice(0,idx).trim(),x.slice(idx+1).trim()];
 }).filter(x=>x.length));
 const stratum=Number(lines['Stratum']);
 if(!Number.isInteger(stratum)||stratum<1||stratum>15||lines['Leap status']!=='Normal')return null;
 const refDate=parseChronyReferenceUtc(lines['Ref time (UTC)']||'');
 if(refDate===null||nowMs<refDate||nowMs-refDate>maxReferenceAgeMs)return null;
 const status=lines['System time']||'';
 const m=status.match(/^([+-]?\d+(?:\.\d+)?)\s+seconds\s+(fast|slow)\s+of\s+NTP\s+time$/i);
 const dispersion=Number((lines['Root dispersion']||'').match(/^([0-9.]+)\s+seconds$/)?.[1]);
 const rms=Number((lines['RMS offset']||'').match(/^([0-9.]+)\s+seconds$/)?.[1]);
 if(!m||!Number.isFinite(dispersion)||dispersion<0||!Number.isFinite(rms)||rms<0)return null;
 const magnitude=Number(m[1]);
 if(!Number.isFinite(magnitude)||magnitude<0)return null;
 const offsetNs=BigInt(Math.round(magnitude*1e9))*(m[2].toLowerCase()==='fast'?1n:-1n);
 const uncertaintyNs=BigInt(Math.round(dispersion*1e9)+Math.round(rms*1e9));
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
