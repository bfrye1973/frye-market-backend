// Opt-in watcher for the existing Engine18 research WEB service, not recorder standby.
// Persistent history in the existing R2 bucket; no chart/feed/trading modifications.
import {Engine18S3PrivateStore} from './engine18S3PrivateStore.js';
import {Engine18HandZoneR2History} from './engine18HandZoneR2History.js';
import {Engine18HandZoneWatcher} from './engine18HandZoneWatcher.js';
import {makeEngine18ChartZoneFetcher} from './engine18ChartZoneSource.js';
export async function startEngine18HandZoneResearch({env=process.env,fetchImpl=fetch}={}){
 if(env.ENGINE18_HAND_ZONE_WATCH_ENABLED!=='YES')return null;
 // These names already exist on the private recorder; never copy secret values to code.
 const required=['ENGINE18_R2_ENDPOINT','ENGINE18_R2_BUCKET','ENGINE18_R2_ACCESS_KEY',
  'ENGINE18_R2_SECRET_KEY','ENGINE18_R2_KEY_ID','ENGINE18_R2_ENCRYPTION_KEY_HEX'];
 if(required.some(k=>!env[k])||!/^[a-fA-F0-9]{64}$/.test(env.ENGINE18_R2_ENCRYPTION_KEY_HEX))
  throw Error('PRIVATE_HISTORY_CONFIG_UNAVAILABLE');
 const store=new Engine18S3PrivateStore({
  endpoint:env.ENGINE18_R2_ENDPOINT,bucket:env.ENGINE18_R2_BUCKET,
  region:env.ENGINE18_R2_REGION||'auto',accessKeyId:env.ENGINE18_R2_ACCESS_KEY,
  secretAccessKey:env.ENGINE18_R2_SECRET_KEY,keyId:env.ENGINE18_R2_KEY_ID,
  encryptionKey:Buffer.from(env.ENGINE18_R2_ENCRYPTION_KEY_HEX,'hex'),
  stagingRoot:'/tmp',fetchImpl
 });
 const watcher=new Engine18HandZoneWatcher({
  fetchSource:makeEngine18ChartZoneFetcher({fetchImpl}),
  store:new Engine18HandZoneR2History({store}),
  approvedKinds:env.ENGINE18_HAND_ZONE_APPROVED_KINDS?.split(',').filter(Boolean)||null,
  onChange:s=>console.log('ENGINE18_ZONE_CONTEXT_CHANGED',JSON.stringify({
   hash:s.hash,sourceRevision:s.sourceRevision,firstObservedAt:s.firstObservedAt,
   zones:s.zones.length,source:s.source,readOnly:true}))
 });
 await watcher.start();return watcher;
}
