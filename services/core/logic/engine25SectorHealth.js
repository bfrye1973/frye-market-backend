// services/core/logic/engine25SectorHealth.js

const DEFAULT_BACKEND_BASE =
  process.env.ENGINE25_BACKEND_BASE ||
  process.env.CORE_BASE ||
  "https://frye-market-backend-1.onrender.com";

const INTRADAY_URL = `${DEFAULT_BACKEND_BASE}/live/intraday`;
const EOD_URL = `${DEFAULT_BACKEND_BASE}/live/eod`;

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(Number(value))) return 50;
  return Math.max(min, Math.min(max, Math.round(Number(value))));
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return 50;
  return clamp(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

function scoreDirect(value, badBelow, goodAbove) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n >= goodAbove) return 100;
  if (n <= badBelow) return 0;
  return clamp(((n - badBelow) / (goodAbove - badBelow)) * 100);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 500)}`);
  }

  return json;
}

function classifySectorCard(card, mode = "intraday") {
  const breadth = toNumber(card?.breadth_pct);
  const momentum = toNumber(card?.momentum_pct);

  if (mode === "eod") {
    if (breadth >= 60 && momentum >= 60) return "bullish";
    if (breadth <= 40 && momentum <= 40) return "bearish";
    return "neutral";
  }

  if (breadth >= 52 && momentum >= 52) return "bullish";
  if (breadth <= 48 && momentum <= 48) return "bearish";
  return "neutral";
}

function normalizeSectorCard(card, mode = "intraday") {
  const nh = toNumber(card?.nh, 0);
  const nl = toNumber(card?.nl, 0);
  const up = toNumber(card?.up, 0);
  const down = toNumber(card?.down, 0);
  const breadth = toNumber(card?.breadth_pct, 50);
  const momentum = toNumber(card?.momentum_pct, 50);
  const bias = classifySectorCard(card, mode);

  return {
    sector: String(card?.sector || "UNKNOWN"),
    mode,
    breadth_pct: breadth,
    momentum_pct: momentum,
    nh,
    nl,
    up,
    down,
    netHighsLows: nh - nl,
    bias,
    color:
      bias === "bullish" ? "green" : bias === "bearish" ? "red" : "yellow",
  };
}

function summarizeSectorCards(cards, mode = "intraday") {
  const normalized = Array.isArray(cards)
    ? cards.map((card) => normalizeSectorCard(card, mode))
    : [];

  const bullish = normalized.filter((card) => card.bias === "bullish");
  const bearish = normalized.filter((card) => card.bias === "bearish");
  const neutral = normalized.filter((card) => card.bias === "neutral");

  const avgBreadth = avg(normalized.map((card) => card.breadth_pct));
  const avgMomentum = avg(normalized.map((card) => card.momentum_pct));

  const totalNetHighsLows = normalized.reduce(
    (sum, card) => sum + Number(card.netHighsLows || 0),
    0
  );

  const totalUp = normalized.reduce((sum, card) => sum + Number(card.up || 0), 0);
  const totalDown = normalized.reduce(
    (sum, card) => sum + Number(card.down || 0),
    0
  );

  const bearishRatio =
    normalized.length > 0 ? bearish.length / normalized.length : 0;

  const bullishRatio =
    normalized.length > 0 ? bullish.length / normalized.length : 0;

  return {
    mode,
    count: normalized.length,
    bullishCount: bullish.length,
    neutralCount: neutral.length,
    bearishCount: bearish.length,
    bullishRatio,
    bearishRatio,
    avgBreadth,
    avgMomentum,
    totalNetHighsLows,
    totalUp,
    totalDown,
    cards: normalized,
    weakestSectors: [...normalized]
      .sort((a, b) => {
        const aScore = avg([a.breadth_pct, a.momentum_pct]);
        const bScore = avg([b.breadth_pct, b.momentum_pct]);
        return aScore - bScore;
      })
      .slice(0, 5),
    strongestSectors: [...normalized]
      .sort((a, b) => {
        const aScore = avg([a.breadth_pct, a.momentum_pct]);
        const bScore = avg([b.breadth_pct, b.momentum_pct]);
        return bScore - aScore;
      })
      .slice(0, 5),
  };
}

function computeDistributionPressure({ intradaySummary, eodSummary }) {
  const intradayBearishPressure = clamp(intradaySummary.bearishRatio * 100);
  const eodBearishPressure = clamp(eodSummary.bearishRatio * 100);

  const intradayBreadthPressure = 100 - scoreDirect(
    intradaySummary.avgBreadth,
    35,
    65
  );

  const eodBreadthPressure = 100 - scoreDirect(eodSummary.avgBreadth, 35, 65);

  const intradayMomentumPressure = 100 - scoreDirect(
    intradaySummary.avgMomentum,
    35,
    65
  );

  const eodMomentumPressure = 100 - scoreDirect(eodSummary.avgMomentum, 35, 65);

  const netHighsLowsPressure =
    eodSummary.totalNetHighsLows < 0
      ? clamp(Math.min(100, Math.abs(eodSummary.totalNetHighsLows) / 5))
      : 0;

  const rawPressure = avg([
    intradayBearishPressure,
    eodBearishPressure,
    intradayBreadthPressure,
    eodBreadthPressure,
    intradayMomentumPressure,
    eodMomentumPressure,
    netHighsLowsPressure,
  ]);

  // Engine 25 convention: higher component score is healthier.
  const score = clamp(100 - rawPressure);

  const warnings = [];

  if (eodSummary.bearishCount >= 5) {
    warnings.push(`${eodSummary.bearishCount} EOD sectors are bearish`);
  }

  if (intradaySummary.bearishCount >= 5) {
    warnings.push(`${intradaySummary.bearishCount} intraday sectors are bearish`);
  }

  if (eodSummary.avgBreadth < 45) {
    warnings.push("EOD sector breadth is weak");
  }

  if (eodSummary.avgMomentum < 45) {
    warnings.push("EOD sector momentum is weak");
  }

  if (eodSummary.totalNetHighsLows < 0) {
    warnings.push("EOD sector net highs/lows are negative");
  }

  let label = "DISTRIBUTION_PRESSURE_LOW";

  if (score < 40) label = "DISTRIBUTION_PRESSURE_HIGH";
  else if (score < 60) label = "DISTRIBUTION_PRESSURE_ELEVATED";
  else if (score < 75) label = "DISTRIBUTION_PRESSURE_WATCH";

  return {
    score,
    label,
    rawPressure,
    inputs: {
      intradayBearishPressure,
      eodBearishPressure,
      intradayBreadthPressure,
      eodBreadthPressure,
      intradayMomentumPressure,
      eodMomentumPressure,
      netHighsLowsPressure,
      intradaySummary: {
        count: intradaySummary.count,
        bullishCount: intradaySummary.bullishCount,
        neutralCount: intradaySummary.neutralCount,
        bearishCount: intradaySummary.bearishCount,
        avgBreadth: intradaySummary.avgBreadth,
        avgMomentum: intradaySummary.avgMomentum,
        totalNetHighsLows: intradaySummary.totalNetHighsLows,
        weakestSectors: intradaySummary.weakestSectors,
      },
      eodSummary: {
        count: eodSummary.count,
        bullishCount: eodSummary.bullishCount,
        neutralCount: eodSummary.neutralCount,
        bearishCount: eodSummary.bearishCount,
        avgBreadth: eodSummary.avgBreadth,
        avgMomentum: eodSummary.avgMomentum,
        totalNetHighsLows: eodSummary.totalNetHighsLows,
        weakestSectors: eodSummary.weakestSectors,
      },
    },
    warnings,
  };
}

function computeBreadthParticipation({ intradaySummary, eodSummary }) {
  const breadthScore = avg([
    scoreDirect(intradaySummary.avgBreadth, 35, 65),
    scoreDirect(eodSummary.avgBreadth, 35, 65),
  ]);

  const momentumScore = avg([
    scoreDirect(intradaySummary.avgMomentum, 35, 65),
    scoreDirect(eodSummary.avgMomentum, 35, 65),
  ]);

  const sectorParticipationScore = avg([
    clamp(intradaySummary.bullishRatio * 100),
    clamp(eodSummary.bullishRatio * 100),
    clamp(100 - intradaySummary.bearishRatio * 100),
    clamp(100 - eodSummary.bearishRatio * 100),
  ]);

  const netHighsLowsScore =
    eodSummary.totalNetHighsLows >= 0
      ? 70
      : clamp(50 - Math.min(50, Math.abs(eodSummary.totalNetHighsLows) / 5));

  const score = avg([
    breadthScore,
    momentumScore,
    sectorParticipationScore,
    netHighsLowsScore,
  ]);

  const warnings = [];

  if (score < 50) {
    warnings.push("Breadth participation is weak");
  }

  if (eodSummary.bearishCount > eodSummary.bullishCount) {
    warnings.push("More EOD sectors are bearish than bullish");
  }

  let label = "BREADTH_PARTICIPATION_HEALTHY";

  if (score < 40) label = "BREADTH_PARTICIPATION_WEAK";
  else if (score < 55) label = "BREADTH_PARTICIPATION_MIXED_WEAKENING";
  else if (score < 70) label = "BREADTH_PARTICIPATION_MIXED";

  return {
    score,
    label,
    inputs: {
      breadthScore,
      momentumScore,
      sectorParticipationScore,
      netHighsLowsScore,
      intraday: {
        avgBreadth: intradaySummary.avgBreadth,
        avgMomentum: intradaySummary.avgMomentum,
        bullishCount: intradaySummary.bullishCount,
        neutralCount: intradaySummary.neutralCount,
        bearishCount: intradaySummary.bearishCount,
        totalNetHighsLows: intradaySummary.totalNetHighsLows,
      },
      eod: {
        avgBreadth: eodSummary.avgBreadth,
        avgMomentum: eodSummary.avgMomentum,
        bullishCount: eodSummary.bullishCount,
        neutralCount: eodSummary.neutralCount,
        bearishCount: eodSummary.bearishCount,
        totalNetHighsLows: eodSummary.totalNetHighsLows,
      },
    },
    warnings,
  };
}

export async function buildEngine25SectorHealth() {
  const [intraday, eod] = await Promise.all([
    fetchJson(INTRADAY_URL),
    fetchJson(EOD_URL),
  ]);

  const intradayCards = Array.isArray(intraday?.sectorCards)
    ? intraday.sectorCards
    : [];

  const eodCards = Array.isArray(eod?.sectorCards) ? eod.sectorCards : [];

  const intradaySummary = summarizeSectorCards(intradayCards, "intraday");
  const eodSummary = summarizeSectorCards(eodCards, "eod");

  const distributionPressure = computeDistributionPressure({
    intradaySummary,
    eodSummary,
  });

  const breadthParticipation = computeBreadthParticipation({
    intradaySummary,
    eodSummary,
  });

  return {
    ok: intradaySummary.count > 0 || eodSummary.count > 0,
    engine: "engine25.sectorHealth.v0.1",
    backendBase: DEFAULT_BACKEND_BASE,
    updatedAt: new Date().toISOString(),
    sources: {
      intraday: {
        ok: intradaySummary.count > 0,
        url: INTRADAY_URL,
        updatedAt:
          intraday?.updated_at_utc ||
          intraday?.updated_at ||
          intraday?.meta?.updated_at_utc ||
          null,
        sectorCardsCount: intradaySummary.count,
      },
      eod: {
        ok: eodSummary.count > 0,
        url: EOD_URL,
        updatedAt:
          eod?.updated_at_utc ||
          eod?.updated_at ||
          eod?.meta?.updated_at_utc ||
          null,
        sectorCardsCount: eodSummary.count,
      },
    },
    intradaySummary,
    eodSummary,
    distributionPressure,
    breadthParticipation,
  };
}
