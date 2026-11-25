// Thin adapter only. Engine2C research cannot affect trading, Replay, or LIVE OHLC.
import {createResearchHistoricalHandler} from '../logic/engine2c/researchHistoricalServingV2.js';
import {createHash,timingSafeEqual} from 'node:crypto';
const digest=v=>createHash('sha256').update(String(v)).digest();
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>0&&b.length>0&&timingSafeEqual(digest(a),digest(b));
const flag=x=>x==='true';
export function makeEngine2cResearchRoute({settings=process.env,privateRoot=settings.ENGINE2C_PRIVATE_ROOT?
  settings.ENGINE2C_PRIVATE_ROOT.replace(/\/+$/,'')+'/pages':undefined}={}){
 const key=settings.ENGINE2C_HISTORY_OWNER_KEY;
 const configured=flag(settings.ENGINE2C_HISTORY_ENABLED)&&flag(settings.ENGINE2C_HISTORY_LICENSED)&&
    typeof key==='string'&&key.length>=32;
 const handler=createResearchHistoricalHandler({
   enabled:configured,licensedAudience:configured,privateRoot,
   verifySession:async({headers})=>{
     const header=String(headers['x-engine2c-access']??'');
     return equal(header,key)?{authenticated:true,subject:'owner-research-test'}:null;
   },
   authorizeViewer:async({subject})=>configured&&subject==='owner-research-test'
 });
 return async (req,res)=>{
   // This endpoint must never be broadly cached or embedded in trading snapshots.
   const response=await handler({method:req.method,query:req.query,headers:req.headers,context:{ip:req.ip}});
   for(const [k,v] of Object.entries(response.headers??{}))res.setHeader(k,v);
   // Do not rely on project-wide reflective CORS policy for this licensed page.
   const origin=req.get('origin');
   if(origin==='https://frye-dashboard.onrender.com'){
     res.setHeader('Access-Control-Allow-Origin',origin);
     res.setHeader('Vary','Origin, Cookie, Authorization');
     res.setHeader('Access-Control-Allow-Headers','Accept, X-Engine2C-Access');
     res.setHeader('Access-Control-Allow-Methods','GET');
   }else{
     res.removeHeader('Access-Control-Allow-Origin');
     res.removeHeader('Access-Control-Allow-Credentials');
   }
   res.status(response.status).send(response.body);
 };
}
