// Engine12 isolated ES full replay cadence gate.
// Return true only if an existing immutable HHMM.json has already been saved
// for the current half-hour Arizona time bucket.
// Never reads/deletes/rewrites existing archives; no impact on live engines.
import fs from "node:fs";
import path from "node:path";
export function inspectEngine12ThirtyMinuteArchiveSlot({replayRoot,dateYmd,timeHHMM}={}){
 const fail=reason=>({ok:false,skip:false,reason});
 if(typeof replayRoot!=="string"||!replayRoot||!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd??"")||
    !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(timeHHMM??""))return fail("INVALID_SLOT_CONTEXT");
 const slot=Math.floor(Number(timeHHMM.slice(2))/30);
 const day=path.join(replayRoot,dateYmd);
 let names;
 try{names=fs.readdirSync(day,{withFileTypes:true});}
 catch(e){
  if(e?.code==="ENOENT")return {ok:true,skip:false,reason:"FIRST_SLOT_ARCHIVE",slot};
  return fail("ARCHIVE_DIRECTORY_INSPECTION_FAILED");
 }
 const present=names.some(x=>x.isFile()&&/^\d{4}\.json$/.test(x.name)&&
   x.name.slice(0,2)===timeHHMM.slice(0,2)&&
   Math.floor(Number(x.name.slice(2,4))/30)===slot);
 return {ok:true,skip:present,reason:present?"THIRTY_MINUTE_SLOT_ALREADY_ARCHIVED":"NEW_THIRTY_MINUTE_SLOT",slot};
}
