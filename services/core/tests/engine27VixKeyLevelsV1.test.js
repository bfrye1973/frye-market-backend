import test from "node:test";
import assert from "node:assert/strict";
import {buildVixKeyLevelsV1} from "../logic/engine27/crossMarket/buildVixKeyLevelsV1.js";
const raw=[
 ["2026-10-12",20.35,18.85,19.40],
 ["2026-10-13",20.51,18.92,20.00],
 ["2026-10-14",19.50,17.25,18.20],
 ["2026-10-15",18.15,16.46,16.46],
 ["2026-10-16",19.50,17.34,18.90],
 ["2026-10-19",19.40,18.93,19.10],
 ["2026-10-20",20.18,19.13,19.50],
 ["2026-10-21",19.20,16.68,16.68],
 ["2026-10-22",20.31,18.85,19.05],
 ["2026-10-23",20.66,18.87,19.45]
];
const candles=raw.map(([time,high,low,close])=>({time,high,low,close,completed:true}));
const call=(opt={})=>buildVixKeyLevelsV1({candles,source:"POLYGON_DIRECT_I_VIX",symbol:"I:VIX",asOf:"2026-10-24T12:00:00Z",...opt});
test("VIX levels use only qualified direct index bars and produce independent clusters",()=>{
 const o=call();assert.equal(o.schema,"engine27.vixKeyLevels.v1");
 assert.equal(o.available,true);
 assert.ok(o.levels.some(l=>l.center>=18.8&&l.center<=19.3));
 assert.ok(o.levels.every(l=>l.status==="WATCH"&&l.verifiedBreak===false));
});
test("VIX prohibits UVXY and stale or unsupported input",()=>{
 assert.equal(call({symbol:"UVXY"}).available,false);
 assert.equal(call({asOf:"2026-11-15T00:00:00Z"}).available,false);
 assert.equal(call({source:null}).available,false);
});
