"use strict";

/**
 * Engine 24 — News Risk Update Job
 *
 * Purpose:
 * - Reads FINNHUB_API_KEY from Render environment variables.
 * - Calls Finnhub market news endpoint.
 * - Sends headlines into Engine 24 classifier.
 * - Writes result to services/core/data/news-risk.json.
 *
 * Critical:
 * - Do NOT hardcode the Finnhub key.
 * - Do NOT expose the key to frontend.
 * - Do NOT touch Engine 22 / Engine 17 / Engine 15 / Engine 16.
 */

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

import {
  computeNewsRisk,
  DEFAULT_NEWS_RISK
} from "../logic/newsRiskEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_PATH = path.join(DATA_DIR, "news-risk.json");

function writeJsonSafe(filePath, payload) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const tempPath = `${filePath}.tmp`;

  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, filePath);
}

function buildFallback(reasonCode, errorMessage) {
  return {
    ...DEFAULT_NEWS_RISK,
    ok: false,
    active: false,
    riskLevel: "LOW",
    reasonCodes: [reasonCode],
    error: errorMessage || null,
    checkedAt: new Date().toISOString()
  };
}

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers,
        timeout: 10000
      },
      (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(
                `FINNHUB_HTTP_${res.statusCode}: ${String(body).slice(0, 300)}`
              )
            );
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`FINNHUB_BAD_JSON: ${err.message}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("FINNHUB_TIMEOUT"));
    });

    req.on("error", reject);
  });
}

async function main() {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;

    if (!apiKey) {
      const out = buildFallback(
        "MISSING_FINNHUB_API_KEY",
        "FINNHUB_API_KEY is not set in Render environment variables."
      );

      writeJsonSafe(OUTPUT_PATH, out);

      console.log("Engine24 wrote safe fallback: missing FINNHUB_API_KEY");
      console.log(OUTPUT_PATH);
      return;
    }

    const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(apiKey)}`;

    const headlines = await fetchJson(url, {
    "User-Agent": "FryeDashboard-Engine24-NewsRisk"
  });

    const out = computeNewsRisk({
      headlines: Array.isArray(headlines) ? headlines : []
    });

    out.checkedAt = new Date().toISOString();
    out.rawHeadlineCount = Array.isArray(headlines) ? headlines.length : 0;

    writeJsonSafe(OUTPUT_PATH, out);

    console.log("Engine24 news-risk updated");
    console.log(
      JSON.stringify(
        {
          ok: out.ok,
          active: out.active,
          riskLevel: out.riskLevel,
          category: out.category,
          headline: out.headline,
          rawHeadlineCount: out.rawHeadlineCount,
          outputPath: OUTPUT_PATH
        },
        null,
        2
      )
    );
  } catch (err) {
    const message = err && err.message ? err.message : String(err);

    const out = buildFallback("FINNHUB_NEWS_FETCH_FAILED", message);

    writeJsonSafe(OUTPUT_PATH, out);

    console.error("Engine24 failed safely");
    console.error(message);
    console.log(OUTPUT_PATH);
  }
}

main();
