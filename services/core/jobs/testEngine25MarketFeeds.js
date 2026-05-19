// services/core/jobs/testEngine25MarketFeeds.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  fetchEngine25PolygonBundle,
} from "../logic/engine25DataSources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-market-feeds-test.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function summarizeSymbol(bundle, symbol) {
  const item = bundle?.results?.[symbol];

  if (!item || !item.ok) {
    return {
      ok: false,
      symbol,
      error: item?.error || "Missing symbol result",
    };
  }

  return {
    ok: true,
    symbol,
    label: item.label,
    component: item.component,
    count: item.count,
    latestDate: item.latest?.date || null,
    close: item.metrics?.close ?? null,
    ema10: item.metrics?.ema10 ?? null,
    ema20: item.metrics?.ema20 ?? null,
    ema50: item.metrics?.ema50 ?? null,
    ema200: item.metrics?.ema200 ?? null,
    aboveEma10: item.metrics?.aboveEma10 ?? null,
    aboveEma20: item.metrics?.aboveEma20 ?? null,
    aboveEma50: item.metrics?.aboveEma50 ?? null,
    aboveEma200: item.metrics?.aboveEma200 ?? null,
    pctChange5d: item.metrics?.pctChange5d ?? null,
    pctChange20d: item.metrics?.pctChange20d ?? null,
    pctChange50d: item.metrics?.pctChange50d ?? null,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const polygonApiKey = process.env.POLYGON_API_KEY;

  const output = {
    ok: false,
    engine: "engine25.marketHealth.v0.marketFeedsTest",
    startedAt,
    finishedAt: null,
    sources: {
      polygon: null,
    },
    quickRead: {},
    errors: [],
  };

  try {
    if (!polygonApiKey) {
      throw new Error("Missing POLYGON_API_KEY environment variable");
    }

    console.log("========================================");
    console.log("Engine 25 Market Feed Test");
    console.log("Testing Polygon daily bars");
    console.log("========================================");

    const today = new Date().toISOString().slice(0, 10);

    console.log("\nFetching Polygon market bundle...");
    const polygon = await fetchEngine25PolygonBundle({
      apiKey: polygonApiKey,
      from: "2015-01-01",
      to: today,
    });

    output.sources.polygon = {
      ok: polygon.ok,
      source: polygon.source,
      from: polygon.from,
      to: polygon.to,
      symbolsRequested: polygon.symbolsRequested,
      symbolsLoaded: polygon.symbolsLoaded,
      errors: polygon.errors,
    };

    output.quickRead = {
      marketTrend: {
        SPY: summarizeSymbol(polygon, "SPY"),
        QQQ: summarizeSymbol(polygon, "QQQ"),
        IWM: summarizeSymbol(polygon, "IWM"),
        DIA: summarizeSymbol(polygon, "DIA"),
      },
      volatility: {
        UVXY: summarizeSymbol(polygon, "UVXY"),
      },
      macroProxies: {
        TLT: summarizeSymbol(polygon, "TLT"),
        UUP: summarizeSymbol(polygon, "UUP"),
        GLD: summarizeSymbol(polygon, "GLD"),
        USO: summarizeSymbol(polygon, "USO"),
      creditFragility: {
        HYG: summarizeSymbol(polygon, "HYG"),
        JNK: summarizeSymbol(polygon, "JNK"),
        LQD: summarizeSymbol(polygon, "LQD"),
        KRE: summarizeSymbol(polygon, "KRE"),
      }, 
      },
      sectorRotation: {
        XLK: summarizeSymbol(polygon, "XLK"),
        XLY: summarizeSymbol(polygon, "XLY"),
        XLF: summarizeSymbol(polygon, "XLF"),
        XLI: summarizeSymbol(polygon, "XLI"),
        XLE: summarizeSymbol(polygon, "XLE"),
        XLV: summarizeSymbol(polygon, "XLV"),
        XLP: summarizeSymbol(polygon, "XLP"),
        XLU: summarizeSymbol(polygon, "XLU"),
        XLRE: summarizeSymbol(polygon, "XLRE"),
        XLB: summarizeSymbol(polygon, "XLB"),
        SMH: summarizeSymbol(polygon, "SMH"),
        IGV: summarizeSymbol(polygon, "IGV"),
      },
      aiLeadership: {
        NVDA: summarizeSymbol(polygon, "NVDA"),
        MSFT: summarizeSymbol(polygon, "MSFT"),
        AVGO: summarizeSymbol(polygon, "AVGO"),
        AMD: summarizeSymbol(polygon, "AMD"),
        META: summarizeSymbol(polygon, "META"),
        GOOGL: summarizeSymbol(polygon, "GOOGL"),
        AMZN: summarizeSymbol(polygon, "AMZN"),
        TSM: summarizeSymbol(polygon, "TSM"),
        ARM: summarizeSymbol(polygon, "ARM"),
        PLTR: summarizeSymbol(polygon, "PLTR"),
      },
    };

    output.ok = polygon.symbolsLoaded > 0;
    output.finishedAt = new Date().toISOString();

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Market Feed Test Complete");
    console.log("OK:", output.ok);
    console.log("Polygon loaded:", polygon.symbolsLoaded, "/", polygon.symbolsRequested);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          polygonLoaded: polygon.symbolsLoaded,
          polygonRequested: polygon.symbolsRequested,
          polygonErrors: polygon.errors.length,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );
  } catch (err) {
    output.ok = false;
    output.finishedAt = new Date().toISOString();
    output.errors.push({
      message: err.message,
      stack: err.stack,
    });

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.error("Engine 25 Market Feed Test Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
