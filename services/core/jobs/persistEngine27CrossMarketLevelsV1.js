// Explicit, opt-in publication of Engine27 cross-market levels.
// A missing output location NEVER writes to production paths implicitly.
import fs from "node:fs/promises";
import path from "node:path";
import {buildEngine27CrossMarketSourceV1} from "./buildEngine27CrossMarketSourceV1.js";
export async function persistEngine27CrossMarketLevelsV1({
 filePath=null,apiKey=null,now=new Date(),fetchBars=undefined
}={}){
 if(typeof filePath!=="string"||!path.isAbsolute(filePath))
  return {written:false,reason:"ABSOLUTE_PUBLICATION_PATH_REQUIRED"};
 const publication=await buildEngine27CrossMarketSourceV1({apiKey,now,fetchBars});
 if(!publication?.instruments||Object.values(publication.instruments).every(x=>x?.available!==true))
  return {written:false,reason:"NO_VERIFIED_MARKET_LEVELS",publication};
 await fs.mkdir(path.dirname(filePath),{recursive:true});
 const temp=filePath+".pending-"+process.pid;
 try{
  await fs.writeFile(temp,JSON.stringify(publication,null,2)+"\n",{flag:"wx"});
  await fs.rename(temp,filePath);
 }finally{
  await fs.rm(temp,{force:true}).catch(()=>{});
 }
 return {written:true,filePath,schema:publication.schema,asOf:publication.asOf,
  availability:Object.fromEntries(Object.entries(publication.instruments).map(([k,v])=>[k,v.available]))};
}
