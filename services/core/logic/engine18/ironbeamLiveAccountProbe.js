// Isolated, one-account, read-only Ironbeam V2 live connectivity probe.
// No auto-run, persistence, order methods, demo fallback or credential output.
const BASE='https://live.ironbeamapi.com/v2';
const validId=x=>typeof x==='string'&&/^\S{1,10}$/.test(x);
export async function probeIronbeamLiveAccount({env={},fetchImpl=globalThis.fetch}={}){
 const result={authenticated:false,live:false,discoveredCount:null,accountVerified:false,balanceVerified:false,positionsVerified:false,readOnly:true};
 if(env.IRONBEAM_LIVE_ACCOUNT_PROBE_ENABLED!=='YES')return {...result,reason:'DISABLED'};
 const {IRONBEAM_LIVE_USERNAME:username,IRONBEAM_LIVE_PASSWORD:password,IRONBEAM_LIVE_API_KEY:apikey,IRONBEAM_LIVE_PROBE_ACCOUNT_ID:accountId}=env;
 if(![username,password,apikey].every(x=>typeof x==='string'&&x.trim())||!validId(accountId))return {...result,reason:'CONFIGURATION_MISSING'};
 const deadline=AbortSignal.timeout(20000);
 let stage='AUTH';
 async function call(path,options={}){
  const res=await fetchImpl(BASE+path,{...options,redirect:'error',signal:deadline});
  if(!res.ok)throw new Error('HTTP_'+res.status);
  const data=await res.json();
  if(!data||typeof data!=='object'||data.status==='ERROR')throw new Error('RESPONSE_INVALID');
  return data;
 }
 try{
  const login=await call('/auth',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({username,password,apikey})});
  if(login.status!=='OK'||typeof login.token!=='string'||!login.token)return {...result,reason:'AUTH_RESPONSE_INVALID'};
  result.authenticated=true;
  const opts={method:'GET',headers:{Authorization:'Bearer '+login.token,Accept:'application/json'}};
  stage='DISCOVERY';
  const info=await call('/info/trader',opts);
  if(info.status!=='OK'||info.isLive!==true||!Array.isArray(info.accounts)||!info.accounts.every(validId)||new Set(info.accounts).size!==info.accounts.length)return {...result,reason:'LIVE_DISCOVERY_INVALID'};
  result.live=true;result.discoveredCount=info.accounts.length;
  if(!info.accounts.includes(accountId))return {...result,reason:'ACCOUNT_NOT_AUTHORIZED'};
  result.accountVerified=true;
  stage='BALANCE';
  const balance=await call('/account/'+encodeURIComponent(accountId)+'/balance?balanceType=CURRENT_OPEN',opts);
  const rows=Array.isArray(balance.balances)?balance.balances:[balance];
  const matching=rows.filter(x=>x?.accountId===accountId);
  if(matching.length!==1||typeof matching[0].cashBalance!=='number'||!Number.isFinite(matching[0].cashBalance))return {...result,reason:'BALANCE_SCHEMA_UNVERIFIED'};
  result.balanceVerified=true;
  stage='POSITIONS';
  const positions=await call('/account/'+encodeURIComponent(accountId)+'/positions',opts);
  if(!Array.isArray(positions.positions)||positions.positions.some(x=>x?.accountId!==accountId))return {...result,reason:'POSITIONS_SCHEMA_UNVERIFIED'};
  result.positionsVerified=true;
  return {...result,reason:'PASS'};
 }catch(e){const m=String(e?.message||'');return {...result,reason:stage+'_'+(/^HTTP_[0-9]{3}$/.test(m)?m:'REQUEST_FAILED')};}
}
