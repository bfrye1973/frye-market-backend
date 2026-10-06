// services/core/qa/runEngine29MoveV2LiveValidation.js
//
// Engine 29 MOVE v2 real-live-input validation.
// Runs branch logic against CURRENT public production market inputs without
// merging or deploying this branch.
//
// Inputs:
// - production Engine29 canonical snapshot for current 1H group context,
//   LIQUIDITY/TRAP context, and first-build parent bootstrap
// - production public OHLC routes for live 30m/10m cross-market bars
// - production futures OHLC routes for ES 1H/30m/10m
//
// Persistence proof:
// - build 1 may bootstrap prior parent from production canonical snapshot
// - subsequent builds MUST read prior parent from this validation file's
//   marketCharacter.move.parent before computing the next build

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { ENGINE29_SYMBOL_REGISTRY } from "../logic/engine29/symbolRegistry.js";
import { ENGINE29_EVIDENCE_QUALITY } from "../logic/engine29/constants.js";
import { evaluateFreshness } from "../logic/engine29/data/validateFreshness.js";
import { buildEngine29SymbolStructure } from "../logic/engine29/structure/buildSymbolStructure.js";
import { buildEngine29TacticalCharacter } from "../logic/engine29/tacticalCharacter/buildTacticalCharacter.js";
import { resolveEngine29TacticalState } from "../logic/engine29/aggregate/resolveTacticalState.js";
import { resolveEngine29FastTacticalShift } from "../logic/engine29/aggregate/resolveFastTacticalShift.js";
import { buildEngine29SqueezeTransitionMonitor } from "../logic/engine29/tacticalCharacter/buildSqueezeTransitionMonitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_BASE =
  process.env.ENGINE29_LIVE_VALIDATION_BASE ||
  "https://frye-market-backend-1.onrender.com";

const OUT_FILE =
  process.env.ENGINE29_LIVE_VALIDATION_FILE ||
  path.resolve(__dirname, "../data/engine29-move-v2-live-validation.json");

const BUILD_COUNT = Math.max(
  2,
  Math.min(6, Number(process.env.ENGINE29_LIVE_VALIDATION_BUILDS || 3))
);

const WAIT_MS = Math.max(
  0,
  Math.min(
    5 * 60 * 1000,
    Number(process.env.ENGINE29_LIVE_VALIDATION_WAIT_MS || 120000)
  )
);

const CONFIRM_SYMBOLS = [
  "SPY",
  "QQQ",
  "IWM",
  "MDY",
  "RSP",
  "SMH",
  "SOX",
  "XLK",
  "HYG",
  "JNK",
  "LQD",
  "XLF",
  "KRE",
  "VIX",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMs(time) {
  const n = Number(time);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

function normalizeBars(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((bar) => {
      const time = toMs(bar?.time ?? bar?.t);
      const open = Number(bar?.open ?? bar?.o);
      const high = Number(bar?.high ?? bar?.h);
      const low = Number(bar?.low ?? bar?.l);
      const close = Number(bar?.close ?? bar?.c);
      const volume = Number(bar?.volume ?? bar?.v ?? 0);

      if (![time, open, high, low, close].every(Number.isFinite)) {
        return null;
      }

      return {
        time,
        date: new Date(time).toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

async function getJson(url, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "cache-control": "no-store",
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} from ${url}: ${JSON.stringify(json).slice(0, 400)}`
      );
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStockBars(symbol, timeframe, limit) {
  const url = new URL("/api/v1/ohlc", BACKEND_BASE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("limit", String(limit));
  return normalizeBars(await getJson(url.toString()));
}

async function fetchFuturesBars(timeframe, limit) {
  const url = new URL("/api/v1/futures/ohlc", BACKEND_BASE);
  url.searchParams.set("symbol", "ES");
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("limit", String(limit));

  const json = await getJson(url.toString());
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json?.bars)
      ? json.bars
      : [];

  return {
    bars: normalizeBars(rows),
    resolvedSymbol: json?.resolvedSymbol || json?.symbol || "ES",
  };
}

function sourceSymbolFor(canonical) {
  const definition = ENGINE29_SYMBOL_REGISTRY[canonical];
  const primary = definition?.primary || null;
  const fallback = definition?.fallback || null;

  if (primary?.provider === "POLYGON" && primary?.symbol) {
    return {
      symbol: primary.symbol,
      isProxy: Boolean(primary.isProxy),
      proxyFor: primary.proxyFor || null,
      evidenceQuality:
        primary.evidenceQuality || ENGINE29_EVIDENCE_QUALITY.DIRECT,
    };
  }

  if (fallback?.provider === "POLYGON" && fallback?.symbol) {
    return {
      symbol: fallback.symbol,
      isProxy: Boolean(fallback.isProxy),
      proxyFor: fallback.proxyFor || canonical,
      evidenceQuality:
        fallback.evidenceQuality || ENGINE29_EVIDENCE_QUALITY.PROXY,
    };
  }

  return null;
}

async function buildCrossMarketInputs(now) {
  const symbols = {};

  for (const canonical of CONFIRM_SYMBOLS) {
    const definition = ENGINE29_SYMBOL_REGISTRY[canonical];
    const source = sourceSymbolFor(canonical);

    if (!definition || !source) continue;

    let bars30 = [];
    let bars10 = [];
    let usedSource = source;

    try {
      [bars30, bars10] = await Promise.all([
        fetchStockBars(source.symbol, "30m", 240),
        fetchStockBars(source.symbol, "10m", 240),
      ]);
    } catch (primaryError) {
      const fallback = definition?.fallback;

      if (
        fallback?.provider === "POLYGON" &&
        fallback?.symbol &&
        fallback.symbol !== source.symbol
      ) {
        usedSource = {
          symbol: fallback.symbol,
          isProxy: Boolean(fallback.isProxy),
          proxyFor: fallback.proxyFor || canonical,
          evidenceQuality:
            fallback.evidenceQuality || ENGINE29_EVIDENCE_QUALITY.PROXY,
        };

        [bars30, bars10] = await Promise.all([
          fetchStockBars(usedSource.symbol, "30m", 240),
          fetchStockBars(usedSource.symbol, "10m", 240),
        ]);
      } else {
        throw primaryError;
      }
    }

    const latest30 = bars30.at(-1) || null;
    const latest10 = bars10.at(-1) || null;

    const entry = {
      canonicalSymbol: canonical,
      label: definition.label,
      group: definition.group,
      subgroup: definition.subgroup || null,
      stressDirection: definition.stressDirection,
      provider: "PRODUCTION_PUBLIC_OHLC_ROUTE",
      sourceSymbol: usedSource.symbol,
      sourceSeriesId: null,
      isProxy: usedSource.isProxy,
      proxyFor: usedSource.proxyFor,
      evidenceQuality: usedSource.evidenceQuality,
      available: bars30.length > 0,
      structural: null,
      tactical: null,
      fastTactical: {
        timeframe: "30m",
        sourceTimeframe: "30m",
        count: bars30.length,
        latest: latest30,
        bars: bars30,
        freshness: evaluateFreshness({
          latestTime: latest30?.time,
          timeframe: "30m",
          now,
        }),
      },
      liveMonitor: {
        timeframe: "10m",
        sourceTimeframe: "10m",
        count: bars10.length,
        latest: latest10,
        bars: bars10,
        freshness: evaluateFreshness({
          latestTime: latest10?.time,
          timeframe: "10m",
          now,
        }),
      },
      errors: [],
    };

    const structured = buildEngine29SymbolStructure(entry, { now });
    symbols[canonical] = {
      ...structured,
      liveMonitor: entry.liveMonitor,
      liveMonitorAvailable: bars10.length > 0,
    };
  }

  return {
    structureBundle: {
      dataDegraded: false,
      symbols,
    },
    marketDataBundle: {
      generatedAt: new Date(now).toISOString(),
      symbols: Object.fromEntries(
        Object.entries(symbols).map(([canonical, structured]) => [
          canonical,
          {
            canonicalSymbol: canonical,
            liveMonitor: structured.liveMonitor || null,
          },
        ])
      ),
    },
  };
}

async function buildEsAnchor(now) {
  const [oneHour, thirtyMinute, tenMinute] = await Promise.all([
    fetchFuturesBars("1h", 500),
    fetchFuturesBars("30m", 500),
    fetchFuturesBars("10m", 500),
  ]);

  const definition = {
    canonicalSymbol: "ES",
    label: "E-mini S&P 500 Futures",
    group: "TACTICAL_ANCHOR",
    subgroup: "ES_FUTURES",
    stressDirection: "LOWER",
  };

  const latest1h = oneHour.bars.at(-1) || null;
  const latest30 = thirtyMinute.bars.at(-1) || null;
  const latest10 = tenMinute.bars.at(-1) || null;

  const entry = {
    ...definition,
    provider: "PRODUCTION_PUBLIC_FUTURES_OHLC_ROUTE",
    sourceSymbol:
      tenMinute.resolvedSymbol ||
      thirtyMinute.resolvedSymbol ||
      oneHour.resolvedSymbol ||
      null,
    sourceSeriesId: null,
    isProxy: false,
    proxyFor: null,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.DIRECT,
    available: true,
    structural: null,
    tactical: {
      timeframe: "1H",
      sourceTimeframe: "1H",
      bars: oneHour.bars,
      latest: latest1h,
      freshness: evaluateFreshness({
        latestTime: latest1h?.time,
        timeframe: "1H",
        now,
      }),
    },
    fastTactical: {
      timeframe: "30m",
      sourceTimeframe: "30m",
      bars: thirtyMinute.bars,
      latest: latest30,
      freshness: evaluateFreshness({
        latestTime: latest30?.time,
        timeframe: "30m",
        now,
      }),
    },
    liveMonitor: {
      timeframe: "10m",
      sourceTimeframe: "10m",
      bars: tenMinute.bars,
      latest: latest10,
      freshness: evaluateFreshness({
        latestTime: latest10?.time,
        timeframe: "10m",
        now,
      }),
    },
    errors: [],
  };

  const structure = buildEngine29SymbolStructure(entry, { now });

  return {
    version: "engine29.liveValidation.esAnchor.v1",
    timestamp: new Date(now).toISOString(),
    resolvedSymbol: entry.sourceSymbol,
    source: "PRODUCTION_PUBLIC_FUTURES_OHLC_ROUTE",
    tacticalFreshness: entry.tactical.freshness,
    fastTacticalFreshness: entry.fastTactical.freshness,
    liveMonitorFreshness: entry.liveMonitor.freshness,
    tacticalAvailable: Boolean(structure?.tactical),
    fastTacticalAvailable: Boolean(structure?.fastTactical),
    liveMonitorAvailable: Boolean(latest10),
    liveMonitor: entry.liveMonitor,
    macroContext: {
      authority: "NOT_USED_IN_MOVE_V2_LIVE_VALIDATION",
      twoHour: { bars: [] },
      fourHour: { bars: [] },
    },
    structure,
  };
}

function readValidationPriorParent() {
  try {
    if (!fs.existsSync(OUT_FILE)) return null;
    const prior = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    return prior?.marketCharacter?.move?.parent || null;
  } catch {
    return null;
  }
}

function writeAtomic(value) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, OUT_FILE);
}

function compactCharacter(character) {
  return {
    type: character?.type ?? null,
    squeezeActive: character?.squeeze?.active === true,
    squeezeDirection: character?.squeeze?.direction ?? null,
    squeezeCounterToParent: character?.squeeze?.counterToParent === true,
    broadConfirmation: {
      state: character?.broadConfirmation?.state ?? null,
      targetDirection:
        character?.broadConfirmation?.targetDirection ?? null,
      confirmed:
        character?.broadConfirmation?.confirmed === true,
      independentBlocksConfirmed:
        character?.broadConfirmation?.independentBlocksConfirmed ?? null,
    },
    participationQuality:
      character?.participationQuality ?? null,
  };
}

async function runOneBuild(index) {
  const now = Date.now();

  const production = await getJson(
    new URL("/api/v1/engine29/cross-market-stress", BACKEND_BASE).toString()
  );

  const productionData = production?.data || production || {};
  const productionParent =
    productionData?.marketCharacter?.move?.parent ||
    productionData?.moveCharacter?.directionalMoveParent ||
    null;

  const fileParent = readValidationPriorParent();
  const priorParent = fileParent || productionParent || null;
  const priorSource = fileParent
    ? "CANONICAL_VALIDATION_FILE"
    : productionParent
      ? "PRODUCTION_CANONICAL_BOOTSTRAP"
      : "NONE";

  const [{ structureBundle, marketDataBundle }, esAnchor] = await Promise.all([
    buildCrossMarketInputs(now),
    buildEsAnchor(now),
  ]);

  const groupBundle = {
    groups: productionData?.groups || {},
    summary: productionData?.groups?.summary || null,
    dataDegraded: productionData?.dataDegraded === true,
  };

  const move = buildEngine29TacticalCharacter(
    structureBundle,
    groupBundle,
    {
      now,
      esAnchor,
      priorMoveParent: priorParent,
    }
  );

  const oneHour = resolveEngine29TacticalState(
    groupBundle,
    move
  );

  const fast = resolveEngine29FastTacticalShift(
    move
  );

  const liveCondition =
    buildEngine29SqueezeTransitionMonitor(
      marketDataBundle,
      {
        parentMoveCharacter: move,
        fastTacticalState: fast.state,
        esLiveMonitor: esAnchor?.liveMonitor || null,
      }
    );

  const liquidity =
    productionData?.marketCharacter?.liquidity ||
    productionData?.trapDetection?.liquidity ||
    { state: "NO_LIQUIDITY_EVENT" };

  const trap =
    productionData?.marketCharacter?.trap ||
    productionData?.trapDetection?.trap ||
    {
      state: "NO_ACTIVE_TRAP",
      side: "NONE",
    };

  const validation = {
    version: "engine29.moveV2.liveValidation.v1",
    timestamp: new Date(now).toISOString(),
    buildNumber: index,
    inputSource: "CURRENT_PRODUCTION_PUBLIC_MARKET_INPUTS",
    priorParentSource: priorSource,

    candidate: move?.directionalMove || null,

    marketCharacter: {
      move: {
        parent: move?.parent || move?.directionalMoveParent || null,
        character: move?.character || null,
        liveCondition: {
          timeframe: liveCondition?.timeframe ?? "10m",
          persistenceWindow:
            liveCondition?.persistenceWindow ?? "20m",
          authority:
            liveCondition?.authority ?? "DIAGNOSTIC_ONLY",
          direction:
            liveCondition?.direction ?? null,
          state:
            liveCondition?.state ?? null,
          contextVsParent:
            liveCondition?.contextVsParent ?? null,
          participation:
            liveCondition?.participation ?? null,
        },
        moveCharacter: move?.moveCharacter ?? "NO_ACTIVE_MOVE",
        direction: move?.direction ?? "FLAT",
      },
      liquidity,
      trap,
    },

    oneHour,
    fastTactical: fast,

    dataQuality: {
      productionDataDegraded:
        productionData?.dataDegraded === true,
      esResolvedSymbol:
        esAnchor?.resolvedSymbol ?? null,
      es30mFreshness:
        esAnchor?.fastTacticalFreshness ?? null,
      es10mFreshness:
        esAnchor?.liveMonitorFreshness ?? null,
      crossMarketSymbolCount:
        Object.keys(structureBundle?.symbols || {}).length,
    },
  };

  writeAtomic(validation);

  const quote = {
    timestamp: validation.timestamp,
    buildNumber: index,
    priorParentSource: priorSource,

    candidate: {
      active: validation.candidate?.active === true,
      direction: validation.candidate?.direction ?? null,
      rawDirection: validation.candidate?.rawDirection ?? null,
      returnPct: validation.candidate?.returnPct ?? null,
      thresholdPct: validation.candidate?.thresholdPct ?? null,
      alignedFraction:
        validation.candidate?.alignedFraction ?? null,
      efficiency:
        validation.candidate?.efficiency ?? null,
      latestClose:
        validation.candidate?.latestClose ?? null,
      latestTime:
        validation.candidate?.latestTime ?? null,
      stale:
        validation.candidate?.stale === true,
      available:
        validation.candidate?.available === true,
    },

    parent: {
      state:
        validation.marketCharacter.move.moveCharacter,
      direction:
        validation.marketCharacter.move.direction,
      active:
        validation.marketCharacter.move.parent?.active === true,
      reason:
        validation.marketCharacter.move.parent?.reason ?? null,
      persistedWithoutFreshQualification:
        validation.marketCharacter.move.parent
          ?.persistedWithoutFreshQualification === true,
      establishedAt:
        validation.marketCharacter.move.parent?.establishedAt ?? null,
      lastQualifiedAt:
        validation.marketCharacter.move.parent?.lastQualifiedAt ?? null,
      invalidationRetracementPct:
        validation.marketCharacter.move.parent
          ?.invalidationRetracementPct ?? null,
      invalidationThresholdPct:
        validation.marketCharacter.move.parent
          ?.invalidationThresholdPct ?? null,
    },

    character:
      compactCharacter(validation.marketCharacter.move.character),

    liveCondition:
      validation.marketCharacter.move.liveCondition,

    oneHour: {
      state: oneHour?.state ?? null,
      authority: oneHour?.authority ?? null,
    },

    fastTactical: {
      state: fast?.state ?? null,
      authority: fast?.authority ?? null,
    },

    liquidity: {
      state: liquidity?.state ?? null,
      side: liquidity?.side ?? null,
      auctionResult: liquidity?.auctionResult ?? null,
    },

    trap: {
      state: trap?.state ?? null,
      side: trap?.side ?? null,
    },

    dataQuality: validation.dataQuality,
  };

  console.log("LIVE_BUILD_QUOTE " + JSON.stringify(quote));

  // Hard architecture invariants.
  const parentDirection =
    validation.marketCharacter.move.parent?.active === true
      ? validation.marketCharacter.move.parent?.direction
      : "FLAT";

  if (validation.marketCharacter.move.direction !== parentDirection) {
    throw new Error(
      `LEGACY_DIRECTION_NOT_PARENT_DERIVED build=${index}`
    );
  }

  if (
    validation.marketCharacter.move.moveCharacter ===
      "POSSIBLE_UPSIDE_SQUEEZE" ||
    validation.marketCharacter.move.moveCharacter ===
      "POSSIBLE_DOWNSIDE_SQUEEZE" ||
    validation.marketCharacter.move.moveCharacter ===
      "BROAD_MOVE_CONFIRMED"
  ) {
    throw new Error(
      `LEGACY_MOVE_RECREATED_OLD_AUTHORITY build=${index}`
    );
  }

  if (
    liveCondition?.authority !== "DIAGNOSTIC_ONLY"
  ) {
    throw new Error(
      `LIVE_CONDITION_AUTHORITY_REGRESSION build=${index}`
    );
  }

  return quote;
}

async function main() {
  console.log(
    `[engine29-live-validation] START builds=${BUILD_COUNT} waitMs=${WAIT_MS}`
  );

  const quotes = [];

  for (let i = 1; i <= BUILD_COUNT; i += 1) {
    quotes.push(await runOneBuild(i));

    if (i < BUILD_COUNT && WAIT_MS > 0) {
      await sleep(WAIT_MS);
    }
  }

  const persistedCase = quotes.find(
    (q) =>
      q?.candidate?.active === false &&
      q?.parent?.active === true &&
      q?.parent?.persistedWithoutFreshQualification === true
  );

  const readbackProof = quotes.slice(1).every(
    (q) => q.priorParentSource === "CANONICAL_VALIDATION_FILE"
  );

  console.log(
    "LIVE_VALIDATION_SUMMARY " +
      JSON.stringify({
        builds: quotes.length,
        persistedInactiveCandidateCaseObserved:
          Boolean(persistedCase),
        persistedInactiveCandidateCaseBuild:
          persistedCase?.buildNumber ?? null,
        canonicalReadbackOnSubsequentBuilds:
          readbackProof,
        outputFile: OUT_FILE,
      })
  );

  if (!readbackProof) {
    throw new Error(
      "CANONICAL_PARENT_READBACK_NOT_PROVEN_ON_CONSECUTIVE_BUILDS"
    );
  }
}

main().catch((error) => {
  console.error(
    "[engine29-live-validation] FAIL",
    error?.stack || error?.message || String(error)
  );
  process.exit(1);
});
