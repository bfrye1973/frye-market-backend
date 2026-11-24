import test from 'node:test';
import assert from 'node:assert/strict';
import {probeIronbeamLiveAccount} from '../logic/engine18/ironbeamLiveAccountProbe.js';
const env={IRONBEAM_LIVE_ACCOUNT_PROBE_ENABLED:'YES',IRONBEAM_LIVE_USERNAME:'fake',IRONBEAM_LIVE_PASSWORD:'fake',IRONBEAM_LIVE_API_KEY:'fake',IRONBEAM_LIVE_PROBE_ACCOUNT_ID:'A1'};
const fixtures=[{status:'OK',token:'fake-token'},{status:'OK',isLive:true,accounts:['A1','A2']},{accountId:'A1',cashBalance:0},{positions:[]}];
function transport(rows){const calls=[];return {calls,fetchImpl:async(url,opts)=>{calls.push([url,opts.method]);return {ok:true,json:async()=>rows[calls.length-1]};}};}
test('disabled never calls network',async()=>{const t=transport([]);assert.equal((await probeIronbeamLiveAccount({fetchImpl:t.fetchImpl})).reason,'DISABLED');assert.equal(t.calls.length,0);});
test('zero balance valid; only one account queried; no secrets returned',async()=>{const t=transport(fixtures);const r=await probeIronbeamLiveAccount({env,fetchImpl:t.fetchImpl});assert.equal(r.reason,'PASS');assert.equal(r.discoveredCount,2);assert.equal(t.calls.length,4);assert.ok(t.calls.every(([u])=>u.startsWith('https://live.ironbeamapi.com/v2/')));assert.ok(!JSON.stringify(r).includes('fake'));});
test('demo rejected',async()=>{const t=transport([fixtures[0],{...fixtures[1],isLive:false}]);assert.equal((await probeIronbeamLiveAccount({env,fetchImpl:t.fetchImpl})).reason,'LIVE_DISCOVERY_INVALID');assert.equal(t.calls.length,2);});
test('unlisted account rejected',async()=>{const t=transport([fixtures[0],{...fixtures[1],accounts:['A2']}]);assert.equal((await probeIronbeamLiveAccount({env,fetchImpl:t.fetchImpl})).reason,'ACCOUNT_NOT_AUTHORIZED');assert.equal(t.calls.length,2);});
test('mismatched balance rejected',async()=>{const t=transport([fixtures[0],fixtures[1],{accountId:'A2',cashBalance:0}]);assert.equal((await probeIronbeamLiveAccount({env,fetchImpl:t.fetchImpl})).reason,'BALANCE_SCHEMA_UNVERIFIED');});
