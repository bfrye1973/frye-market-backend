// services/core/jobs/updateEngine25Full.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { buildEngine25SectorHealth } from "../logic/engine25SectorHealth.js";
import { buildEngine25EsTechnicalContext } from "../logic/engine25EsTechnicalContext.js";

import {
  fetchEngine25FredBundle,
  fetchFiscalDataOperatingCashBalance,
  fetchEngine25PolygonBundle,
} from "../logic/engine25DataSources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const MACRO_FILE = path.join(DATA_DIR, "engine25-data-test.json");
const MARKET_FILE = path.join(DATA_DIR, "engine25-market-feeds-test.json");
const FMP_FILE = path.join(DATA_DIR, "engine25-fmp-feeds-test.json");
const SECTOR_FILE = path.join(DATA_DIR, "engine25-sector-health-test.json");
const ES_TECH_FILE = path.join(DATA_DIR, "engine25-es-technical-context.json");

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function safeLatest(sourceBlock, key) {
  return sourceBlock?.results?.[key]?.latest || null;
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

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json;
}

function buildFmpUrl(endpoint, params) {
  const qs = new URLSearchParams(params);
  return `${FMP_BASE_URL}${endpoint}?${qs.toString()}`;
}

async function fetchFmpFeeds(apiKey) {
  const from = todayIso();
  const to = addDaysIso(30);

  const earningsUrl = buildFmpUrl("/earnings-calendar", {
    from,
    to,
    apikey: apiKey,
  });

  const economicUrl = buildFmpUrl("/economic-calendar", {
    from,
    to,
    apikey: apiKey,
  });

  const newsUrl = buildFmpUrl("/news/stock-latest", {
    page: "0",
    limit: "20",
    apikey: apiKey,
  });

  const earningsCalendar = await fetchJson(earningsUrl);
  const economicCalendar = await fetchJson(economicUrl);
  const stockNews = await fetchJson(newsUrl);

  return {
    ok:
      Array.isArray(earningsCalendar) &&
      Array.isArray(economicCalendar) &&
      Array.isArray(stockNews),
    earningsCalendar: {
      ok: Array.isArray(earningsCalendar),
      endpoint: "/earnings-calendar",
      from,
      to,
      count: Array.isArray(earningsCalendar) ? earningsCalendar.length : 0,
      sample: Array.isArray(earningsCalendar) ? earningsCalendar.slice(0, 10) : [],
    },
    economicCalendar: {
      ok: Array.isArray(economicCalendar),
      endpoint: "/economic-calendar",
      from,
      to,
      count: Array.isArray(economicCalendar) ? economicCalendar.length : 0,
      sample: Array.isArray(economicCalendar) ? economicCalendar.slice(0, 20) : [],
    },
    stockNews: {
      ok: Array.isArray(stockNews),
      endpoint: "/news/stock-latest",
      count: Array.isArray(stockNews) ? stockNews.length : 0,
      sample: Array.isArray(stockNews) ? stockNews.slice(0, 10) : [],
    },
  };
}

async function writeMacroFile() {
  const fredApiKey = process.env.FRED_API_KEY;

  if (!fredApiKey) {
    throw new Error("Missing FRED_API_KEY");
  }

  console.log("\n[Engine25Full] Fetching FRED + FiscalData...");

  const fred = await fetchEngine25FredBundle({
    apiKey: fredApiKey,
    observationStart: "2015-01-01",
  });

  const fiscalData = await fetchFiscalDataOperatingCashBalance({
    pageSize: 5000,
    recordStart: "2015-01-01",
  });

  const output = {
    ok: fred.seriesLoaded > 0 && fiscalData.ok,
    engine: "engine25.marketHealth.v0.dataFetchTest",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    sources: {
      fred: {
        ok: fred.ok,
        source: fred.source,
        observationStart: fred.observationStart,
        seriesRequested: fred.seriesRequested,
        seriesLoaded: fred.seriesLoaded,
        errors: fred.errors,
        latest: {
          UNRATE: safeLatest(fred, "UNRATE"),
          ICSA: safeLatest(fred, "ICSA"),
          CCSA: safeLatest(fred, "CCSA"),
          PAYEMS: safeLatest(fred, "PAYEMS"),
          NFCI: safeLatest(fred, "NFCI"),
          STLFSI4: safeLatest(fred, "STLFSI4"),
          BAMLH0A0HYM2: safeLatest(fred, "BAMLH0A0HYM2"),
          DGS10: safeLatest(fred, "DGS10"),
          DGS2: safeLatest(fred, "DGS2"),
          T10Y2Y: safeLatest(fred, "T10Y2Y"),
          T10Y3M: safeLatest(fred, "T10Y3M"),
          WALCL: safeLatest(fred, "WALCL"),
          RRPONTSYD: safeLatest(fred, "RRPONTSYD"),
          WRESBAL: safeLatest(fred, "WRESBAL"),
          M2SL: safeLatest(fred, "M2SL"),
          CPIAUCSL: safeLatest(fred, "CPIAUCSL"),
          PPIACO: safeLatest(fred, "PPIACO"),
        },
      },
      fiscalData: {
        ok: fiscalData.ok,
        source: fiscalData.source,
        dataset: fiscalData.dataset,
        table: fiscalData.table,
        endpoint: fiscalData.endpoint,
        recordStart: fiscalData.recordStart,
        selectedAccountType:
          fiscalData.selectedAccountType || fiscalData.latest?.account_type || null,
        balanceField:
          fiscalData.balanceField ||
          (fiscalData.latest?.effective_balance === fiscalData.latest?.open_today_bal
            ? "open_today_bal"
            : "close_today_bal"),
        count: fiscalData.count,
        validCount: fiscalData.validCount,
        latestRecordDate:
          fiscalData.latestRecordDate || fiscalData.latest?.record_date || null,
        latest: fiscalData.latest,
      },
    },
    quickRead: {
      laborMarketHealth: {
        unemploymentRate: safeLatest(fred, "UNRATE"),
        initialClaims: safeLatest(fred, "ICSA"),
        continuingClaims: safeLatest(fred, "CCSA"),
        nonfarmPayrolls: safeLatest(fred, "PAYEMS"),
      },
      financialStressCredit: {
        nfci: safeLatest(fred, "NFCI"),
        stLouisFinancialStress: safeLatest(fred, "STLFSI4"),
        highYieldSpread: safeLatest(fred, "BAMLH0A0HYM2"),
      },
      fedBondMarket: {
        tenYearYield: safeLatest(fred, "DGS10"),
        twoYearYield: safeLatest(fred, "DGS2"),
        tenMinusTwo: safeLatest(fred, "T10Y2Y"),
        tenMinusThreeMonth: safeLatest(fred, "T10Y3M"),
      },
      liquidityConditions: {
        fedBalanceSheet: safeLatest(fred, "WALCL"),
        reverseRepo: safeLatest(fred, "RRPONTSYD"),
        bankReserves: safeLatest(fred, "WRESBAL"),
        m2MoneySupply: safeLatest(fred, "M2SL"),
        treasuryOperatingCashBalance: fiscalData.latest,
      },
      inflation: {
        cpi: safeLatest(fred, "CPIAUCSL"),
        ppi: safeLatest(fred, "PPIACO"),
      },
    },
    errors: [],
  };

  fs.writeFileSync(MACRO_FILE, JSON.stringify(output, null, 2));

  console.log(
    `[Engine25Full] Macro OK=${output.ok} | FRED ${fred.seriesLoaded}/${fred.seriesRequested} | Fiscal rows ${fiscalData.validCount}`
  );
}

async function writeMarketFile() {
  const polygonApiKey = process.env.POLYGON_API_KEY;

  if (!polygonApiKey) {
    throw new Error("Missing POLYGON_API_KEY");
  }

  console.log("\n[Engine25Full] Fetching Polygon market feeds...");

  const today = todayIso();

  const polygon = await fetchEngine25PolygonBundle({
    apiKey: polygonApiKey,
    from: "2015-01-01",
    to: today,
  });

  const output = {
    ok: polygon.symbolsLoaded > 0 && polygon.errors.length === 0,
    engine: "engine25.marketHealth.v0.marketFeedsTest",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    sources: {
      polygon: {
        ok: polygon.ok,
        source: polygon.source,
        from: polygon.from,
        to: polygon.to,
        symbolsRequested: polygon.symbolsRequested,
        symbolsLoaded: polygon.symbolsLoaded,
        errors: polygon.errors,
      },
    },
    quickRead: {
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
      },
      creditFragility: {
        HYG: summarizeSymbol(polygon, "HYG"),
        JNK: summarizeSymbol(polygon, "JNK"),
        LQD: summarizeSymbol(polygon, "LQD"),
        KRE: summarizeSymbol(polygon, "KRE"),
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
    },
    errors: [],
  };

  fs.writeFileSync(MARKET_FILE, JSON.stringify(output, null, 2));

  console.log(
    `[Engine25Full] Market OK=${output.ok} | Polygon ${polygon.symbolsLoaded}/${polygon.symbolsRequested} | Errors ${polygon.errors.length}`
  );
}

async function writeFmpFile() {
  const fmpApiKey = process.env.FMP_API_KEY;

  if (!fmpApiKey) {
    throw new Error("Missing FMP_API_KEY");
  }

  console.log("\n[Engine25Full] Fetching FMP feeds...");

  const fmp = await fetchFmpFeeds(fmpApiKey);

  const output = {
    ok: fmp.ok,
    engine: "engine25.marketHealth.v0.fmpFeedsTest",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    sources: {
      fmp: {
        ok: fmp.ok,
        earningsCalendar: {
          ok: fmp.earningsCalendar.ok,
          endpoint: fmp.earningsCalendar.endpoint,
          from: fmp.earningsCalendar.from,
          to: fmp.earningsCalendar.to,
          count: fmp.earningsCalendar.count,
        },
        economicCalendar: {
          ok: fmp.economicCalendar.ok,
          endpoint: fmp.economicCalendar.endpoint,
          from: fmp.economicCalendar.from,
          to: fmp.economicCalendar.to,
          count: fmp.economicCalendar.count,
        },
        stockNews: {
          ok: fmp.stockNews.ok,
          endpoint: fmp.stockNews.endpoint,
          count: fmp.stockNews.count,
        },
      },
    },
    quickRead: {
      earningsCalendar: fmp.earningsCalendar.sample,
      economicCalendar: fmp.economicCalendar.sample,
      stockNews: fmp.stockNews.sample,
    },
    errors: [],
  };

  fs.writeFileSync(FMP_FILE, JSON.stringify(output, null, 2));

  console.log(
    `[Engine25Full] FMP OK=${output.ok} | Earnings ${fmp.earningsCalendar.count} | Economic ${fmp.economicCalendar.count} | News ${fmp.stockNews.count}`
  );
}

async function writeSectorHealthFile() {
  console.log("\n[Engine25Full] Fetching sector health / distribution pressure...");

  const sectorHealth = await buildEngine25SectorHealth();

  fs.writeFileSync(SECTOR_FILE, JSON.stringify(sectorHealth, null, 2));

  console.log(
    `[Engine25Full] SectorHealth OK=${sectorHealth.ok} | Distribution ${sectorHealth.distributionPressure.score}/${sectorHealth.distributionPressure.label} | Breadth ${sectorHealth.breadthParticipation.score}/${sectorHealth.breadthParticipation.label}`
  );
}

async function writeEsTechnicalContextFile() {
  console.log("\n[Engine25Full] Fetching ES technical context...");

  const esTechnicalContext = await buildEngine25EsTechnicalContext({
    symbol: "ES",
  });

  fs.writeFileSync(ES_TECH_FILE, JSON.stringify(esTechnicalContext, null, 2));

  console.log(
    `[Engine25Full] ESTechnical OK=${esTechnicalContext.ok} | State ${esTechnicalContext.technicalRead.state} | Permission ${esTechnicalContext.technicalRead.permission} | SizeCap ${esTechnicalContext.technicalRead.sizeCap}`
  );
}

function runNodeJob(jobPath) {
  execFileSync(process.execPath, [jobPath], {
    cwd: CORE_DIR,
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  ensureDataDir();

  console.log("========================================");
  console.log("Engine 25 Full Update");
  console.log("Fetch → Validate → Score");
  console.log("========================================");

  await writeMacroFile();
  await writeMarketFile();
  await writeFmpFile();
  await writeSectorHealthFile();
  await writeEsTechnicalContextFile(); 

  console.log("\n[Engine25Full] Validating feeds...");
  runNodeJob("jobs/validateEngine25Feeds.js");

  console.log("\n[Engine25Full] Computing market health...");
  runNodeJob("jobs/updateEngine25MarketHealth.js");

  console.log("\n[Engine25Full] Building ES zone-aware read...");
  runNodeJob("jobs/buildEngine25EsZoneAwareRead.js");

  console.log("\n[Engine25Full] Snapshotting sector-card proxy breadth...");
  runNodeJob("jobs/snapshotEngine25SectorCardBreadth.js");

  console.log("\n[Engine25Full] Building zone accumulation/distribution classification...");
  runNodeJob("jobs/buildEngine25ZoneClassification.js");

  console.log("[Engine25Full] Building ES overlay...");
  runNodeJob("jobs/buildEngine25EsOverlay.js");

  console.log("\n========================================");
  console.log("Engine 25 Full Update Complete");
  console.log("Wrote:");
  console.log("- data/engine25-data-test.json");
  console.log("- data/engine25-market-feeds-test.json");
  console.log("- data/engine25-fmp-feeds-test.json");
  console.log("- data/engine25-sector-health-test.json");
  console.log("- data/engine25-es-technical-context.json");  
  console.log("- data/engine25-feed-validation.json");
  console.log("- data/engine25-market-health.json");
  console.log("- data/engine25-es-zone-aware-read.json");
  console.log("- data/engine25-sector-card-breadth-snapshots.json");
  console.log("- data/engine25-zone-classification.json");
  console.log("- data/engine25-es-overlay.json");  
  console.log("========================================");
}

main().catch((err) => {
  console.error("[Engine25Full] FAILED:");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
