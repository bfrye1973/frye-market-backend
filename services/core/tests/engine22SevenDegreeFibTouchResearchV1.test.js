import test from "node:test";
import assert from "node:assert/strict";
import {reduceFibTouchObservationV1,FIB_TOUCH_DEGREES_V1} from "../logic/engine22/research/reduceFibTouchesV1.js";
const level=(degree="micro")=>({degree,countId:"count-1",modelKey:"model-1",seriesId:"ESZ2026",priceBasis:"RAW_ES_CONTRACT",key:"r618",price:7800,direction:"DOWN",originAt:"2026-10-14T14:00:00Z"});
const candle=(low=7799)=>({seriesId:"ESZ2026",priceBasis:"RAW_ES_CONTRACT",sourceBarId:"bar-1",sourceTimestamp:"2026-10-14T14:05:00Z",low,high:7810,eligible:true,completed:true});
test("every structural degree uses same touch-state reducer",()=>{for(const degree of FIB_TOUCH_DEGREES_V1){const row=reduceFibTouchObservationV1({level:level(degree),candle:candle()});assert.equal(row.status,"TOUCHED",degree)}});
test("unreached level stays watch",()=>assert.equal(reduceFibTouchObservationV1({level:level(),candle:candle(7801)}).status,"WATCH"));
test("first valid touch persists when later candle moves away",()=>{const first=reduceFibTouchObservationV1({level:level(),candle:candle()});const later=reduceFibTouchObservationV1({level:level(),candle:{...candle(7802),sourceBarId:"bar-2",sourceTimestamp:"2026-10-14T14:10:00Z"},previous:first});assert.deepEqual(later,first);});
test("new model identity does not inherit old touch",()=>{const prior=reduceFibTouchObservationV1({level:level(),candle:candle()});const next=reduceFibTouchObservationV1({level:{...level(),modelKey:"model-2"},candle:candle(7801),previous:prior});assert.equal(next.status,"WATCH")});
test("wrong series, price basis and pre-origin candles cannot touch",()=>{for(const bar of [{...candle(),seriesId:"ESU2026"},{...candle(),priceBasis:"ADJUSTED"},{...candle(),sourceTimestamp:"2026-10-14T13:55:00Z"},{...candle(),eligible:false}])assert.equal(reduceFibTouchObservationV1({level:level(),candle:bar}).status,"WATCH")});
test("missing count/price/source identity fails closed",()=>{assert.equal(reduceFibTouchObservationV1({level:{...level(),countId:null},candle:candle()}).status,"UNAVAILABLE");});
test("upward and downward touches use directionally correct candle extrema",()=>{const up={...level(),direction:"UP",price:7811};assert.equal(reduceFibTouchObservationV1({level:up,candle:candle()}).status,"WATCH");assert.equal(reduceFibTouchObservationV1({level:up,candle:{...candle(),high:7812}}).status,"TOUCHED")});

test("a changed wave origin or direction cannot inherit prior touch",()=>{
 const first=reduceFibTouchObservationV1({level:level(),candle:candle()});
 const originChanged=reduceFibTouchObservationV1({level:{...level(),originAt:"2026-10-14T14:04:00Z"},candle:candle(7801),previous:first});
 const directionChanged=reduceFibTouchObservationV1({level:{...level(),direction:"UP"},candle:candle(7801),previous:first});
 assert.equal(originChanged.status,"WATCH");
 assert.equal(directionChanged.status,"WATCH");
 assert.notEqual(directionChanged.identity,first.identity);
 assert.equal(directionChanged.firstTouchedBarId,null);
});
