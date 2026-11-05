// PR #253 isolated read-only acceptance. Never used by production server.
// Fetches real ETF/FRED observations into this preview's ephemeral filesystem,
// serves existing Engine 25 Full Dashboard route and verifies display-only fields.
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchPolygonDailyBars,
  fetchFredSeries,
} from "../logic/engine25DataSources.js";
import fullDashboardRouter from "../routes/engine25FullDashboard.js";

if (process.env.ENGINE25_ISOLATED_ACCEPTANCE !== "1") {
  throw new Error("ENGINE25_ISOLATED_ACCEPTANCE_REQUIRED");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const polygonSymbols = ["HYG", "JNK", "LQD", "KRE", "IWM"];
const fredSymbols = ["DGS10", "DGS2", "T10Y2Y", "T10Y3M"];
const app = express();
app.disable("x-powered-by");
app.use("/api/v1", fullDashboardRouter);
let report = { state: "PENDING", previewOnly: true };
app.get("/acceptance", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(report);
});
app.get("/health", (_req, res) => res.json({ok:true, previewOnly:true}));
const port = Number(process.env.PORT || 10000);
app.listen(port, "0.0.0.0", () => {
  console.log("[engine25-credit-acceptance] listening", port);
  void run();
});
const n = (v) => v === null || v === undefined || v === "" ? null :
  (Number.isFinite(Number(v)) ? Number(v) : null);
async function run() {
  const missing = ["POLYGON_API_KEY", "FRED_API_KEY"].filter(
    key => !process.env[key]
  );
  if (missing.length) {
    report = { state: "NEEDS_CREDENTIALS", previewOnly: true, missingKeys: missing };
    console.log("[engine25-credit-acceptance] credentials not configured:", missing.join(","));
    return;
  }
  report = {state:"RUNNING",previewOnly:true};
  try {
    fs.mkdirSync(dataDir, {recursive:true});
    const asOf = new Date().toISOString().slice(0,10);
    const polygon = {};
    const fred = {};
    // Only the 9 owner-requested indicators; provider functions are unchanged.
    for (const symbol of polygonSymbols) {
      try {
        const entry = await fetchPolygonDailyBars({
          symbol, apiKey:process.env.POLYGON_API_KEY,
          from:"2025-08-01", to:asOf,
        });
        polygon[symbol] = {
          ok: entry.ok, close:entry.metrics?.close ?? null,
          latestDate:entry.latest?.date ?? null,
          aboveEma10:entry.metrics?.aboveEma10 ?? null,
          aboveEma20:entry.metrics?.aboveEma20 ?? null,
          aboveEma50:entry.metrics?.aboveEma50 ?? null,
          aboveEma200:entry.metrics?.aboveEma200 ?? null,
          pctChange5d:entry.metrics?.pctChange5d ?? null,
          pctChange20d:entry.metrics?.pctChange20d ?? null,
          pctChange50d:entry.metrics?.pctChange50d ?? null,
        };
      } catch(err) {
        polygon[symbol] = {ok:false,error:String(err?.message||err).replace(/apiKey=[^& ]+/gi,"apiKey=REDACTED").slice(0,250)};
      }
    }
    for(const symbol of fredSymbols){
      try {
        const entry = await fetchFredSeries({
          seriesId:symbol,apiKey:process.env.FRED_API_KEY,
          observationStart:"2026-01-01",
        });
        fred[symbol] = entry.latest ?
          {value:entry.latest.value,date:entry.latest.date} : null;
      } catch(err) {
        fred[symbol] = null;
      }
    }
    // Independently observe the newly deployed PRODUCTION full-dashboard
    // without writing to production or exposing the full payload publicly.
    let productionDetails = { reachable:false };
    try {
      const liveResponse = await fetch(
        "https://frye-market-backend-1.onrender.com/api/v1/engine25/full-dashboard",
        {signal:AbortSignal.timeout(20000)}
      );
      const live = await liveResponse.json();
      const g = live?.creditStressDetail?.groups || {};
      const items = (group, names) => Object.fromEntries(
        (g[group]?.items || []).filter(x => names.includes(x.key)).map(x => [
          x.key, { available:x.available, value:x.value, close:x.close, date:x.observationDate, status:x.state }
        ])
      );
      productionDetails = {
        reachable:liveResponse.ok && live.ok === true,
        status:liveResponse.status,
        error:live?.error || null,
        etfs:items("creditEtfFragility", polygonSymbols),
        rates:items("ratesCurvePressure", fredSymbols),
        scores:live?.creditStressDetail?.scores || null
      };
    } catch (e) {
      productionDetails = {reachable:false,error:String(e?.message || e).slice(0,140)};
    }
    console.log("[engine25-credit-acceptance] PRODUCTION_READ_ONLY",JSON.stringify(productionDetails));
    const raw = await fetch(
      "https://frye-market-backend-1.onrender.com/api/v1/engine25/market-health",
      {signal:AbortSignal.timeout(18000)}
    );
    if (!raw.ok) throw new Error("Live market-health READ returned HTTP "+raw.status);
    const source = await raw.json();
    const marketHealth = source?.data;
    if(!marketHealth?.components) throw new Error("Live market-health READ has no components");

    const inputs = {
      quickRead: {
        creditFragility: Object.fromEntries(polygonSymbols.filter(x=>x!=="IWM").map(x=>[x,polygon[x]])),
        marketTrend:{IWM:polygon.IWM},
      }
    };
    const macro = {
      sources:{fred:{latest:fred}}
    };
    fs.writeFileSync(path.join(dataDir,"engine25-market-health.json"),JSON.stringify(marketHealth));
    fs.writeFileSync(path.join(dataDir,"engine25-market-feeds-test.json"),JSON.stringify(inputs));
    fs.writeFileSync(path.join(dataDir,"engine25-data-test.json"),JSON.stringify(macro));

    const res=await fetch("http://127.0.0.1:"+port+"/api/v1/engine25/full-dashboard",{
      signal:AbortSignal.timeout(15000)
    });
    const view=await res.json();
    if(!res.ok || !view.ok) throw new Error("Preview dashboard failed HTTP "+res.status);
    const groups=view.creditStressDetail?.groups || {};
    const etfs=Object.fromEntries((groups.creditEtfFragility?.items||[]).filter(x=>polygonSymbols.includes(x.key)).map(x=>[
      x.key,{available:x.available,close:x.close,value:x.value,date:x.observationDate,expectedClose:polygon[x.key]?.close,expectedDate:polygon[x.key]?.latestDate}
    ]));
    const rates=Object.fromEntries((groups.ratesCurvePressure?.items||[]).filter(x=>fredSymbols.includes(x.key)).map(x=>[
      x.key,{available:x.available,value:x.value,date:x.observationDate,sourceValue:fred[x.key]?.value??null,sourceDate:fred[x.key]?.date??null}
    ]));

    const etfMatches=polygonSymbols.every(x=>
      (!polygon[x]?.ok || n(polygon[x]?.close)===null) ||
      (etfs[x]?.available===true && n(etfs[x]?.close)===n(polygon[x]?.close) && etfs[x]?.date===polygon[x]?.latestDate)
    );
    const official=marketHealth.components.bondMarket?.inputs?.officialSlowMacroContext || {};
    const rateMatches=fredSymbols.every(x=>{
      const expected=n(official[x]) ?? n(fred[x]?.value);
      if(expected===null)return rates[x]?.available===false;
      if(n(rates[x]?.value)!==expected)return false;
      return n(official[x])===null ? rates[x]?.date===fred[x]?.date : !rates[x]?.date;
    });
    const scoreMatches=
      groups.creditEtfFragility?.score===marketHealth.components.creditFragility?.score &&
      groups.ratesCurvePressure?.score===marketHealth.components.bondMarket?.score;
    const allSourcesUsable=polygonSymbols.every(x=>polygon[x]?.ok&&n(polygon[x]?.close)!==null) &&
      fredSymbols.every(x=>n(fred[x]?.value)!==null);
    report={
      state:etfMatches&&rateMatches&&scoreMatches&&allSourcesUsable?"PASS":"INCOMPLETE",
      previewOnly:true,at:new Date().toISOString(),
      producerArtifactsGenerated:true,
      sourceMarketHealthAt:marketHealth.generatedAtUtc||marketHealth.finishedAt||null,
      sourceScores:{
        creditFragility:marketHealth.components.creditFragility?.score??null,
        bondMarket:marketHealth.components.bondMarket?.score??null
      },
      detailScores:{
        creditFragility:groups.creditEtfFragility?.score??null,
        bondMarket:groups.ratesCurvePressure?.score??null
      },
      polygon:etfs,fred:rates,etfMatches,rateMatches,scoreMatches,allSourcesUsable,
      officialSlowContextUndated:true,
    };
    console.log("[engine25-credit-acceptance] RESULT",JSON.stringify(report));
  } catch (err) {
    report={state:"FAIL",previewOnly:true,at:new Date().toISOString(),
      error:String(err?.message||err).replace(/apiKey=[^& ]+/gi,"apiKey=REDACTED").slice(0,350)};
    console.error("[engine25-credit-acceptance] failed",report.error);
  }
}
