// Offline brokerage identity foundation. No network, credentials, orders or storage.
export const STRATEGIES=Object.freeze(['SUBMICRO','MICRO','SUBMINUTE','MINUTE','MINOR','INTERMEDIATE','PRIMARY']);
const validId=x=>typeof x==='string' && /^[A-Za-z0-9_-]{1,10}$/.test(x);
const fail=reason=>({ok:false,reason});
export function reconcileIronbeamAccounts(info,mapping){
 if(info?.status!=='OK'||info.isLive!==true||!Array.isArray(info.accounts)||!info.accounts.every(validId)||new Set(info.accounts).size!==info.accounts.length)return fail('DISCOVERY_INVALID');
 if(!Array.isArray(mapping)||mapping.length!==7||new Set(mapping.map(x=>x?.strategy)).size!==7||new Set(mapping.map(x=>x?.accountId)).size!==7||mapping.some(x=>!STRATEGIES.includes(x?.strategy)||!validId(x?.accountId)||!info.accounts.includes(x.accountId)))return fail('MAPPING_UNVERIFIED');
 return {ok:true,accounts:mapping.map(({accountId,strategy})=>Object.freeze({broker:'IRONBEAM',environment:'LIVE',accountId,strategy,executionEnabled:false}))};
}
// Provisional V2 shape from #394; vendor/live response verification required.
export function normalizeIronbeamBalance(response,accountId){
 if(!validId(accountId)||response?.status==='ERROR')return fail('BALANCE_UNAVAILABLE');
 const rows=Array.isArray(response?.balances)?response.balances:[response];
 if(rows.length!==1||rows[0]?.accountId!==accountId)return fail('BALANCE_IDENTITY_MISMATCH');
 const cash=rows[0].cashBalance;
 if(typeof cash!=='number'||!Number.isFinite(cash))return fail('BALANCE_UNAVAILABLE');
 return {ok:true,cashBalance:cash,availableMargin:null,netLiquidation:null,schemaVerified:false};
}
