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
test("Rates detail uses existing official FRED context with dates", () => {
  const d=buildCreditStressDetail(marketHealth,marketFeeds,macroFeeds);
  for(const [symbol,price] of Object.entries({DGS10:4.2,DGS2:3.6,T10Y2Y:0.6,T10Y3M:0.9})){
    const item=get(d,"ratesCurvePressure",symbol);
    assert.equal(item.available,true);
    assert.equal(item.value,price);
    assert.equal(item.observationDate,"2026-11-04");
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
