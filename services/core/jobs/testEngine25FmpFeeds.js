// services/core/jobs/testEngine25FmpFeeds.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-fmp-feeds-test.json");

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

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from FMP: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`FMP HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json;
}

function buildUrl(endpoint, params) {
  const qs = new URLSearchParams(params);
  return `${FMP_BASE_URL}${endpoint}?${qs.toString()}`;
}

async function fetchEarningsCalendar(apiKey) {
  const from = todayIso();
  const to = addDaysIso(30);

  const url = buildUrl("/earnings-calendar", {
    from,
    to,
    apikey: apiKey,
  });

  const data = await fetchJson(url);

  return {
    ok: Array.isArray(data),
    endpoint: "/earnings-calendar",
    from,
    to,
    count: Array.isArray(data) ? data.length : 0,
    sample: Array.isArray(data) ? data.slice(0, 10) : data,
  };
}

async function fetchEconomicCalendar(apiKey) {
  const from = todayIso();
  const to = addDaysIso(30);

  const url = buildUrl("/economic-calendar", {
    from,
    to,
    apikey: apiKey,
  });

  const data = await fetchJson(url);

  return {
    ok: Array.isArray(data),
    endpoint: "/economic-calendar",
    from,
    to,
    count: Array.isArray(data) ? data.length : 0,
    sample: Array.isArray(data) ? data.slice(0, 20) : data,
  };
}

async function fetchStockNews(apiKey) {
  const url = buildUrl("/news/stock-latest", {
    page: "0",
    limit: "20",
    apikey: apiKey,
  });

  const data = await fetchJson(url);

  return {
    ok: Array.isArray(data),
    endpoint: "/news/stock-latest",
    count: Array.isArray(data) ? data.length : 0,
    sample: Array.isArray(data) ? data.slice(0, 10) : data,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const apiKey = process.env.FMP_API_KEY;

  const output = {
    ok: false,
    engine: "engine25.marketHealth.v0.fmpFeedsTest",
    startedAt,
    finishedAt: null,
    sources: {
      fmp: null,
    },
    quickRead: {},
    errors: [],
  };

  try {
    if (!apiKey) {
      throw new Error("Missing FMP_API_KEY environment variable");
    }

    console.log("========================================");
    console.log("Engine 25 FMP Feed Test");
    console.log("Testing earnings calendar, economic calendar, and stock news");
    console.log("========================================");

    const earningsCalendar = await fetchEarningsCalendar(apiKey);
    const economicCalendar = await fetchEconomicCalendar(apiKey);
    const stockNews = await fetchStockNews(apiKey);

    output.sources.fmp = {
      ok: earningsCalendar.ok && economicCalendar.ok && stockNews.ok,
      earningsCalendar: {
        ok: earningsCalendar.ok,
        endpoint: earningsCalendar.endpoint,
        from: earningsCalendar.from,
        to: earningsCalendar.to,
        count: earningsCalendar.count,
      },
      economicCalendar: {
        ok: economicCalendar.ok,
        endpoint: economicCalendar.endpoint,
        from: economicCalendar.from,
        to: economicCalendar.to,
        count: economicCalendar.count,
      },
      stockNews: {
        ok: stockNews.ok,
        endpoint: stockNews.endpoint,
        count: stockNews.count,
      },
    };

    output.quickRead = {
      earningsCalendar: earningsCalendar.sample,
      economicCalendar: economicCalendar.sample,
      stockNews: stockNews.sample,
    };

    output.ok = output.sources.fmp.ok;
    output.finishedAt = new Date().toISOString();

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 FMP Feed Test Complete");
    console.log("OK:", output.ok);
    console.log("Earnings rows:", earningsCalendar.count);
    console.log("Economic rows:", economicCalendar.count);
    console.log("News rows:", stockNews.count);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          earningsRows: earningsCalendar.count,
          economicRows: economicCalendar.count,
          newsRows: stockNews.count,
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

    console.error("Engine 25 FMP Feed Test Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
