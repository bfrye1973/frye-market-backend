// Engine27 V6 read-only targeted research probe; no original Replay mutation.
const base="https://frye-market-backend-1.onrender.com/api/v1/replay/es";
const date="2026-10-28";
async function read(url){const r=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error("HTTP_"+r.status);return r.json();}
const list=await read(base+"/times?date="+date);
const times=(list.times??[]).filter(t=>/^1[01]\d\d$|^12[0-3]\d$/.test(t));
const sample=[...new Set([times[0],times[Math.floor(times.length/2)],times.at(-1)].filter(Boolean))];
for(const time of sample)try{
 const response=await read(base+"/snapshot?date="+date+"&time="+time);
 const s=response?.snapshot??response?.data??response;
 const strategy=s?.strategies?.["intraday_scalp@10m"]??{};
 const eng=strategy?.engine22WaveStrategy??{};
 const auth=eng?.authorizedWorkingStructure??{};
 const micro=auth?.degrees?.micro??{},sub=auth?.degrees?.submicro??{};
 const zone=strategy?.engine26LocationCandidate??{};
 const summarise=w=>({wave:w.activeWave??null,direction:w.direction??null,stage:w.stage??null,
  modelVersion:w.modelVersion??null,levels:(w.levels??[]).filter(x=>x.status==="TOUCHED").map(x=>({key:x.key,price:x.price,touchedAt:x.touchedAt??null})),
  review:w.review??null});
 process.stdout.write(JSON.stringify({date,time,snapshotTime:s.snapshotTime,authStatus:auth.status??null,
  micro:summarise(micro),submicro:summarise(sub),
  negotiated:zone?.location?.type??null,zoneIdAvailable:Boolean(zone.zoneId),
  zoneBoundsPresent:Boolean(zone?.entryZone?.low!=null && zone?.entryZone?.high!=null),
  rawCandleInReplay:Boolean(strategy?.bars10m||strategy?.candles10m),
  physicalContractPresent:Boolean(s.resolvedEsContract||s.resolvedContract)})+"\n");
}catch(e){process.stdout.write(JSON.stringify({date,time,error:String(e.message).slice(0,50)})+"\n");}
