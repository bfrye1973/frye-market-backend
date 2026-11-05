import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, "../routes/engine25FullDashboard.js"), "utf8");
function extract(start, next) {
  const first = src.indexOf("function " + start + "(");
  const end = src.indexOf("\nfunction " + next + "(", first);
  assert.ok(first >= 0 && end > first);
  return src.slice(first, end);
}
const methods = [
  extract("safeNumber", "componentScore"),
  extract("componentScore", "normalizeStressItem"),
  extract("normalizeStressItem", "buildCreditStressDetail"),
  extract("buildCreditStressDetail", "diff"),
].join("\n");
const { buildCreditStressDetail, normalizeStressItem } = new Function(methods +
  "\nreturn {buildCreditStressDetail, normalizeStressItem};")();

const marketHealth = {
  components: {
    creditFragility: {
      score: 55,
      inputs: { engine29CreditGroup: { tactical: { state: "FORMING" } } },
    },
    creditStress: { score: 51, inputs: { highYieldSpread: 3.32, nfci: -0.45 } },
    bondMarket: {
      score: 55,
      inputs: {
        engine29RatesDurationGroup: { structural: { state: "FORMING" } },
        officialSlowMacroContext: { DGS10: 4.2, DGS2: 3.6, T10Y2Y: 0.6, T10Y3M: 0.9 },
      },
    },
    macroPressure: { inputs: { TLT: { close: 82.02, latestDate: "2026-11-05" } } },
  },
};
const marketFeeds = {
  quickRead: {
    creditFragility: {
      HYG: { ok:true, close: 80, latestDate:"2026-11-05", pctChange5d:-1.3, aboveEma20:false },
      JNK: { ok:true, close: 94, latestDate:"2026-11-05" },
      LQD: { ok:true, close: 108, latestDate:"2026-11-05" },
      KRE: { ok:true, close: 56, latestDate:"2026-11-05" },
    },
    marketTrend: { IWM: {ok:true, close: 230, latestDate:"2026-11-05"} },
  },
};
const macroFeeds = { sources:{ fred:{ latest:{
  DGS10:{value:4.2,date:"2026-11-04"},
  DGS2:{value:3.6,date:"2026-11-04"},
  T10Y2Y:{value:0.6,date:"2026-11-04"},
  T10Y3M:{value:0.9,date:"2026-11-04"},
} } } };
function get(detail, group, key) {
  const item=detail.groups[group].items.find(x=>x.key===key);
  assert.ok(item);
  return item;
}

test("Engine29 score authority preserved", () => {
  const d=buildCreditStressDetail(marketHealth,marketFeeds,macroFeeds);
  assert.equal(d.scores.creditFragility,55);
  assert.equal(d.scores.bondMarket,55);
  assert.equal(d.scores.creditStress,51);
});
test("Credit ETF details read actual approved daily market feed without changing Engine29 score", () => {
  const d=buildCreditStressDetail(marketHealth,marketFeeds,macroFeeds);
  for(const symbol of ["HYG","JNK","LQD","KRE","IWM"]){
    assert.equal(get(d,"creditEtfFragility",symbol).available,true);
    assert.equal(get(d,"creditEtfFragility",symbol).observationDate,"2026-11-05");
  }
  assert.equal(get(d,"creditEtfFragility","HYG").close,80);
  assert.equal(get(d,"creditEtfFragility","HYG").pctChange5d,-1.3);
});
test("Rates detail preserves official slow FRED value without borrowing another artifact's date", () => {
  const d=buildCreditStressDetail(marketHealth,marketFeeds,macroFeeds);
  for(const [symbol,price] of Object.entries({DGS10:4.2,DGS2:3.6,T10Y2Y:0.6,T10Y3M:0.9})){
    const item=get(d,"ratesCurvePressure",symbol);
    assert.equal(item.available,true);
    assert.equal(item.value,price);
    assert.equal(item.observationDate,null);
  }
  assert.equal(get(d,"ratesCurvePressure","TLT").close,82.02);
});
test("Missing ETF remains unavailable with null momentum", () => {
  const market={quickRead:{creditFragility:{HYG:{ok:false,pctChange5d:0}},marketTrend:{}}};
  const d=buildCreditStressDetail(marketHealth,market,macroFeeds);
  const hyg=get(d,"creditEtfFragility","HYG");
  assert.equal(hyg.available,false);
  assert.equal(hyg.pctChange5d,null);
  assert.equal(hyg.state,"UNAVAILABLE");
  assert.equal(get(d,"creditEtfFragility","JNK").available,false);
});
test("No FRED value remains unavailable (never fake zero)", () => {
  const mh=structuredClone(marketHealth);
  mh.components.bondMarket.inputs.officialSlowMacroContext={};
  const d=buildCreditStressDetail(mh,marketFeeds,null);
  const x=get(d,"ratesCurvePressure","DGS10");
  assert.equal(x.available,false);
  assert.equal(x.value,null);
});
test("Zero percent is valid only for a real available price", () => {
  const valid=normalizeStressItem("HYG","HYG",{ok:true,close:83,pctChange5d:0});
  const invalid=normalizeStressItem("HYG","HYG",{ok:false,pctChange5d:0});
  assert.equal(valid.pctChange5d,0);
  assert.equal(invalid.pctChange5d,null);
});
test("Numeric legacy FRED fallback continues working", () => {
  const mh=structuredClone(marketHealth);
  mh.components.bondMarket={score:61,inputs:{tenYear:4.1,twoYear:3.9}};
  const d=buildCreditStressDetail(mh,null,null);
  assert.equal(get(d,"ratesCurvePressure","DGS10").value,4.1);
  assert.equal(d.scores.bondMarket,61);
});

test("Truthy unusable legacy ETF objects cannot mask a valid Polygon observation", () => {
  const mh = structuredClone(marketHealth);
  mh.components.creditFragility.inputs = {
    ...mh.components.creditFragility.inputs,
    HYG: { ok: false, close: 999, pctChange5d: 0 },
    JNK: { ok: true, close: null, pctChange5d: 0 },
    LQD: { state: "UNAVAILABLE" },
    KRE: { ok: false },
    IWM: { structuralState: "FORMING" },
  };
  const d = buildCreditStressDetail(mh,marketFeeds,macroFeeds);
  for(const [key,close] of Object.entries({HYG:80,JNK:94,LQD:108,KRE:56,IWM:230})){
    assert.equal(get(d,"creditEtfFragility",key).close,close);
    assert.equal(get(d,"creditEtfFragility",key).available,true);
  }
  assert.equal(d.scores.creditFragility,55);
});
test("Usable legacy price stays preferred to Polygon detail", () => {
  const mh=structuredClone(marketHealth);
  mh.components.creditFragility.inputs.HYG={ok:true,close:79,latestDate:"2026-11-03"};
  const d=buildCreditStressDetail(mh,marketFeeds,macroFeeds);
  assert.equal(get(d,"creditEtfFragility","HYG").close,79);
  assert.equal(get(d,"creditEtfFragility","HYG").observationDate,"2026-11-03");
});
test("Mismatched FRED source dates never attach to official slow-context values", () => {
  const mh=structuredClone(marketHealth);
  mh.components.bondMarket.inputs.officialSlowMacroContext.DGS10=4.8;
  const macro=structuredClone(macroFeeds);
  macro.sources.fred.latest.DGS10={value:4.2,date:"2026-10-30"};
  const d=buildCreditStressDetail(mh,marketFeeds,macro);
  const item=get(d,"ratesCurvePressure","DGS10");
  assert.equal(item.value,4.8);
  assert.equal(item.observationDate,null);
});
test("FRED detail fallback keeps value and observation date from the same object", () => {
  const mh=structuredClone(marketHealth);
  mh.components.bondMarket.inputs.officialSlowMacroContext.DGS2=null;
  const d=buildCreditStressDetail(mh,marketFeeds,macroFeeds);
  const item=get(d,"ratesCurvePressure","DGS2");
  assert.equal(item.value,3.6);
  assert.equal(item.observationDate,"2026-11-04");
});
test("No FRED data leaves official value visible but undated", () => {
  const d=buildCreditStressDetail(marketHealth,marketFeeds,null);
  assert.equal(get(d,"ratesCurvePressure","DGS10").value,4.2);
  assert.equal(get(d,"ratesCurvePressure","DGS10").observationDate,null);
});
