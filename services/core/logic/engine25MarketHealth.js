// src/pages/rows/RowChart/overlays/Engine25MarketHealthTimeline.jsx

import React, { useEffect, useState } from "react";

const RAW_API_BASE =
  (typeof window !== "undefined" && (window.__API_BASE__ || "")) ||
  process.env.REACT_APP_API_BASE ||
  process.env.REACT_APP_API_URL ||
  "https://frye-market-backend-1.onrender.com";

const API_ROOT = RAW_API_BASE.replace(/\/+$/, "").replace(/\/api$/, "");
const ENGINE25_ROUTE = `${API_ROOT}/api/v1/engine25/full-dashboard`;

const PANEL_FONT = "Arial, Helvetica, sans-serif";

/*
  Font policy:
  The old readable card used 17px for most rows/body text.
  Keep the small chart readable; do not shrink the main read below 17px.
*/
const FS = {
  headerTitle: 17,
  headerMeta: 17,
  score: 54,
  permission: 17,
  sectionTitle: 17,
  row: 17,
  miniLabel: 14,
  miniValue: 17,
  note: 16,
  button: 15,
  loading: 17,
};

/* =========================
   Formatters
========================= */

function cleanLabel(value) {
  return String(value || "—")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactLabel(value) {
  return cleanLabel(value).toUpperCase();
}

function scoreColor(score, inverse = false) {
  const n = Number(score);

  if (!Number.isFinite(n)) return "#94a3b8";

  if (inverse) {
    if (n < 30) return "#22c55e";
    if (n < 50) return "#f59e0b";
    if (n < 70) return "#ef4444";
    return "#7f1d1d";
  }

  if (n >= 70) return "#22c55e";
  if (n >= 50) return "#eab308";
  if (n >= 35) return "#f97316";
  return "#ef4444";
}

function labelColor(label, score) {
  const text = String(label || "").toUpperCase();

  if (
    text.includes("WEAK") ||
    text.includes("RISK_OFF") ||
    text.includes("NO_BLIND") ||
    text.includes("DISTRIBUTION_ACTIVE") ||
    text.includes("AT_RISK") ||
    text.includes("BLOCKED") ||
    text.includes("LOST")
  ) {
    return "#ef4444";
  }

  if (
    text.includes("WATCH") ||
    text.includes("MIXED") ||
    text.includes("A_PLUS") ||
    text.includes("SECONDARY") ||
    text.includes("RECLAIM")
  ) {
    return "#fbbf24";
  }

  if (
    text.includes("EXPANDING") ||
    text.includes("SUPPORTIVE") ||
    text.includes("CONFIRMED") ||
    text.includes("ACCUMULATION")
  ) {
    return "#22c55e";
  }

  return scoreColor(score);
}

function intradayColor(label, score) {
  const text = String(label || "").toUpperCase();
  const n = Number(score);

  if (text.includes("DISTRIBUTION_ACTIVE")) return "#ef4444";
  if (text.includes("DAMAGE_ELEVATED")) return "#f97316";
  if (text.includes("DAMAGE_WATCH")) return "#fbbf24";
  if (Number.isFinite(n)) return scoreColor(n);

  return "#94a3b8";
}

function macroStateColor(value) {
  const text = String(value || "").toUpperCase();

  if (
    text.includes("MACRO_SHOCK") ||
    text.includes("NEGATIVE") ||
    text.includes("SHOCK") ||
    text.includes("HIGH") ||
    text.includes("EXTREME")
  ) {
    return "#ef4444";
  }

  if (
    text.includes("HEADWIND") ||
    text.includes("WARNING") ||
    text.includes("ELEVATED") ||
    text.includes("MODERATE")
  ) {
    return "#fbbf24";
  }

  if (text.includes("SUPPORTIVE")) {
    return "#22c55e";
  }

  return "#94a3b8";
}

function fmtScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n);
}

function fmtScoreDecimal(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

function fmtChange(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n > 0) return `+${n}`;
  return String(n);
}

function shortLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value ?? "required";
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function rowByLabel(rows, label) {
  return rows.find((row) => row?.label === label) || null;
}

function fmtEventTimeArizona(value) {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return "TIME UNKNOWN";

  try {
    return `${new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Phoenix",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(ms))} AZ`;
  } catch {
    return "TIME UNKNOWN";
  }
}

function isActiveMaterialNewsEvent(event, nowMs = Date.now()) {
  if (!event || event.material !== true) return false;

  const expiresMs = Date.parse(event?.expiresAt || "");
  if (!Number.isFinite(expiresMs) || nowMs >= expiresMs) return false;

  const status = String(event?.status || "").toUpperCase();
  if (status === "EVENT_EXPIRED") return false;

  return true;
}

function newsEventColor(event) {
  const severity = String(event?.severity || "").toUpperCase();

  if (severity === "HIGH" || severity === "EXTREME") return "#ef4444";
  if (severity === "MODERATE") return "#fbbf24";
  return "#94a3b8";
}

function confirmationSummaryForEvent(event, intradayMacro) {
  const eventType = String(event?.eventType || "").toUpperCase();
  const confirmation = intradayMacro?.marketConfirmation || {};
  const geopolitics = intradayMacro?.components?.geopolitics || null;
  const treasuryLiquidity =
    intradayMacro?.components?.treasuryLiquidity || null;

  if (
    eventType === "GEOPOLITICAL_OIL_SUPPLY_RISK" ||
    eventType === "ENERGY_SUPPLY_EVENT" ||
    (eventType === "GEOPOLITICAL_ESCALATION" && event?.oilSupplyRisk === true)
  ) {
    const confirmed =
      geopolitics?.marketConfirmed === true ||
      confirmation?.oilConfirmed === true;

    return {
      label: "CL / BZ",
      value: confirmed ? "CONFIRMED" : "NOT CONFIRMED",
      confirmed,
      note:
        geopolitics?.reasonCodes?.[0] ||
        (confirmed
          ? "Oil market confirmation active."
          : "Awaiting CL / BZ confirmation."),
    };
  }

  if (
    eventType === "TREASURY_RATES_RISK" ||
    (eventType === "FINANCIAL_STRESS_EVENT" &&
      event?.treasuryLiquidityRisk === true)
  ) {
    const confirmed =
      confirmation?.ratesConfirmed === true ||
      confirmation?.tltConfirmed === true;

    return {
      label: "ZN / ZB / TLT",
      value: confirmed ? "CONFIRMED" : "NOT CONFIRMED",
      confirmed,
      note:
        treasuryLiquidity?.reasonCodes?.[0] ||
        (confirmed
          ? "Rates / TLT confirmation active."
          : "Awaiting ZN / ZB / TLT confirmation."),
    };
  }

  return {
    label: "V0.1",
    value: "NO DEDICATED CONFIRMATION FAMILY",
    confirmed: false,
    note:
      "Context only in v0.1. No dedicated market-confirmation family is assigned.",
  };
}

/* =========================
   UI helpers
========================= */

function engine25Border() {
  return "rgba(96,165,250,0.45)";
}

function engine25Background() {
  return "rgba(15,23,42,0.38)";
}

function sectionBorder(label, score) {
  const color = labelColor(label, score);

  if (color === "#22c55e") return "rgba(34,197,94,0.50)";
  if (color === "#fbbf24") return "rgba(251,191,36,0.55)";
  if (color === "#f97316") return "rgba(249,115,22,0.55)";
  if (color === "#ef4444") return "rgba(244,63,94,0.62)";

  return engine25Border();
}

function sectionBackground(label, score) {
  const color = labelColor(label, score);

  if (color === "#22c55e") return "rgba(20,83,45,0.13)";
  if (color === "#fbbf24") return "rgba(113,63,18,0.14)";
  if (color === "#f97316") return "rgba(124,45,18,0.16)";
  if (color === "#ef4444") return "rgba(127,29,29,0.16)";

  return engine25Background();
}

function SectionBox({ title, children, borderColor, titleColor, background }) {
  return (
    <div
      style={{
        fontFamily: PANEL_FONT,
        border: `1px solid ${borderColor || engine25Border()}`,
        borderRadius: 10,
        padding: "8px 10px",
        background: background || engine25Background(),
        textAlign: "left",
      }}
    >
      {title && (
        <div
          style={{
            fontFamily: PANEL_FONT,
            fontSize: FS.sectionTitle,
            fontWeight: 900,
            color: titleColor || "#60a5fa",
            marginBottom: 5,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
      )}

      {children}
    </div>
  );
}

function CompareRow({ label, value, color = "#dbeafe" }) {
  return (
    <div
      style={{
        fontFamily: PANEL_FONT,
        display: "flex",
        justifyContent: "space-between",
        gap: 9,
        fontSize: FS.row,
        lineHeight: 1.42,
        color: "#dbeafe",
        fontWeight: 650,
      }}
    >
      <span>{label}</span>
      <span style={{ color, fontWeight: 900, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function MiniRead({ label, value, color = "#dbeafe" }) {
  return (
    <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: FS.miniLabel,
          color: "#94a3b8",
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: FS.miniValue,
          lineHeight: 1.25,
          color,
          fontWeight: 950,
          textTransform: "uppercase",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function NoteText({ children, color = "#dbeafe" }) {
  return (
    <div
      style={{
        marginTop: 4,
        color,
        fontWeight: 650,
        fontSize: FS.note,
        lineHeight: 1.38,
        whiteSpace: "pre-line",
      }}
    >
      {children}
    </div>
  );
}

/* =========================
   Jump Alert Logic
========================= */

function buildJumpAlert(rows) {
  const comparisonRows = Array.isArray(rows) ? rows : [];

  const composite = rowByLabel(comparisonRows, "Composite");
  const composite1d = Number(composite?.oneDayChange);
  const composite3d = Number(composite?.threeDayChange);

  let status = "NO MAJOR JUMP";
  let color = "#94a3b8";
  let border = "rgba(148,163,184,0.38)";
  let background = "rgba(15,23,42,0.38)";

  if (Number.isFinite(composite1d) && composite1d >= 8) {
    status = "FAST 1D UPGRADE";
    color = "#22c55e";
    border = "rgba(34,197,94,0.45)";
    background = "rgba(20,83,45,0.13)";
  } else if (Number.isFinite(composite3d) && composite3d >= 10) {
    status = "BULLISH MARKET HEALTH UPGRADE";
    color = "#22c55e";
    border = "rgba(34,197,94,0.45)";
    background = "rgba(20,83,45,0.13)";
  } else if (Number.isFinite(composite1d) && composite1d <= -8) {
    status = "FAST 1D WARNING";
    color = "#ef4444";
    border = "rgba(244,63,94,0.60)";
    background = "rgba(127,29,29,0.16)";
  } else if (Number.isFinite(composite3d) && composite3d <= -10) {
    status = "MARKET HEALTH DOWNGRADE";
    color = "#ef4444";
    border = "rgba(244,63,94,0.60)";
    background = "rgba(127,29,29,0.16)";
  } else if (
    (Number.isFinite(composite1d) && Math.abs(composite1d) >= 5) ||
    (Number.isFinite(composite3d) && Math.abs(composite3d) >= 7)
  ) {
    status = "WATCHING CHANGE";
    color = "#fbbf24";
    border = "rgba(251,191,36,0.52)";
    background = "rgba(113,63,18,0.14)";
  }

  const driverLabels = [
    "Macro Aware",
    "Breadth",
    "Distribution",
    "Market Trend",
    "Credit Fragility",
    "AI Leadership",
  ];

  const drivers = driverLabels
    .map((label) => {
      const row = rowByLabel(comparisonRows, label);
      const one = Number(row?.oneDayChange);
      const three = Number(row?.threeDayChange);
      const displayChange = Number.isFinite(three) ? three : one;

      if (!row || !Number.isFinite(displayChange)) return null;

      const isDistribution = label === "Distribution";
      const improvement = isDistribution ? -displayChange : displayChange;

      return {
        label,
        change: displayChange,
        improvement,
        abs: Math.abs(displayChange),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 3);

  return {
    status,
    color,
    border,
    background,
    composite1d,
    composite3d,
    drivers,
  };
}

/* =========================
   Zone detail helpers
========================= */

function buildZoneDetailRead({
  zoneDecisionRead,
  zoneClassification,
  accumulation,
  distribution,
}) {
  const label = String(zoneDecisionRead?.label || "").toUpperCase();
  const accumulationState = String(accumulation?.state || "").toUpperCase();
  const distributionState = String(distribution?.state || "").toUpperCase();

  const institutionalValue = label.includes("INSTITUTIONAL_SUPPORT_AT_RISK")
    ? "PRIMARY SUPPORT AT RISK"
    : "PRIMARY ZONE CONTROLS";

  const negotiatedValue = label.includes("AT_RISK")
    ? "RECLAIM NEEDED"
    : "WATCH VALUE ACCEPTANCE";

  const shelfValue =
    zoneDecisionRead?.secondaryShelfDefense?.value === true ||
    accumulationState.includes("SECONDARY_SHELF")
      ? "BLUE SHELF DEFENSE — SECONDARY ONLY"
      : "NOT CONFIRMED";

  const accumulationValue =
    accumulationState.includes("NO_CONFIRMED") || !accumulationState
      ? "NOT CONFIRMED UNTIL RECLAIM"
      : compactLabel(accumulation?.state);

  const distributionValue = distributionState.includes("DISTRIBUTION_ACTIVE")
    ? "ACTIVE AT ZONE"
    : compactLabel(distribution?.state || "UNKNOWN");

  let plain =
    "Yellow institutional zone controls the primary read. Blue accumulation shelf can defend, but it does not confirm accumulation until negotiated value / institutional value is reclaimed.";

  if (zoneClassification?.plainEnglish) {
    plain = String(zoneClassification.plainEnglish);
  }

  return {
    institutionalValue,
    negotiatedValue,
    shelfValue,
    accumulationValue,
    distributionValue,
    plain,
  };
}

/* =========================
   Main Export
========================= */

export default function Engine25MarketHealthTimeline({
  visible = true,
  symbol = "ES",
}) {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("LOADING");
  const [error, setError] = useState(null);

  const isES = String(symbol || "").toUpperCase() === "ES";

  useEffect(() => {
    if (!visible || !isES) return;

    let cancelled = false;

    async function load() {
      try {
        setStatus("LOADING");
        setError(null);

        const res = await fetch(ENGINE25_ROUTE, { cache: "no-store" });
        const json = await res.json();

        if (!res.ok || json?.ok === false) {
          throw new Error(
            json?.error || `Engine25 full dashboard HTTP ${res.status}`
          );
        }

        if (!cancelled) {
          setPayload(json);
          setStatus("READY");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setStatus("ERROR");
        }
      }
    }

    load();

    const timer = setInterval(load, 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible, isES]);

  if (!visible || !isES) return null;

  const headline = payload?.headline || {};
  const intraday = payload?.intradayProxyDamage || null;
  const liveEsPermission = payload?.liveEsPermission || null;

  const marketInternals = payload?.marketInternals || null;
  const hasMarketInternals = Boolean(
    marketInternals?.symbol === "ES" &&
      Number.isFinite(Number(marketInternals?.esMarketMeter?.masterScore))
  );

  const marketInternalsMasterScore = Number(
    marketInternals?.esMarketMeter?.masterScore
  );
  const marketInternalsMasterState =
    marketInternals?.esMarketMeter?.masterState || null;

  const marketInternalsAlignment = marketInternals?.alignment || null;

  const intradayMacro = payload?.intradayMacro || null;
  const hasIntradayMacro = Boolean(
    intradayMacro?.ok === true && intradayMacro?.state
  );

  const macroRates = intradayMacro?.components?.rates || null;
  const macroTlt = intradayMacro?.components?.tlt || null;
  const macroOil = intradayMacro?.components?.oil || null;
  const macroGeopolitics = intradayMacro?.components?.geopolitics || null;

  const newsEvents = payload?.newsEvents || null;
  const newsEventRows = Array.isArray(newsEvents?.events)
    ? newsEvents.events
        .filter((event) => isActiveMaterialNewsEvent(event))
        .sort(
          (a, b) =>
            Date.parse(b?.observedAt || "") - Date.parse(a?.observedAt || "")
        )
    : [];

  const hasNewsEvents = newsEventRows.length > 0;
  const newsFeedUnavailable =
    newsEvents?.ok === false ||
    (Array.isArray(newsEvents?.warnings) &&
      newsEvents.warnings.includes("MASSIVE_BENZINGA_NEWS_UNAVAILABLE"));

  const creditStressDetail = payload?.creditStressDetail || null;
  const macroCreditHealth =
    creditStressDetail?.groups?.macroCreditStress || null;
  const macroCreditScore = Number(macroCreditHealth?.score);
  const macroCreditHealthLabel = Number.isFinite(macroCreditScore)
    ? macroCreditScore >= 75
      ? "LOW STRESS / HEALTHY"
      : macroCreditScore >= 50
        ? "NORMAL / WATCH"
        : "HIGH STRESS"
    : "UNAVAILABLE";
  const macroCreditColor = scoreColor(macroCreditScore);
  const macroCreditSaturated =
    Number.isFinite(macroCreditScore) && macroCreditScore >= 100;

  const creditFinancialScores = [
    Number(payload?.creditStressDetail?.scores?.creditStress),
    Number(payload?.creditStressDetail?.scores?.creditFragility),
    Number(payload?.creditStressDetail?.scores?.bondMarket),
    Number(payload?.creditStressDetail?.scores?.liquidity),
  ].filter(Number.isFinite);

  const creditFinancialOverallScore = creditFinancialScores.length
    ? creditFinancialScores.reduce((sum, value) => sum + value, 0) /
      creditFinancialScores.length
    : null;

  const creditFinancialOverallLabel = Number.isFinite(
    creditFinancialOverallScore
  )
    ? creditFinancialOverallScore >= 75
      ? "HEALTHY"
      : creditFinancialOverallScore >= 55
        ? "MIXED / WATCH"
        : "STRESSED"
    : "UNAVAILABLE";

  const creditFinancialOverallColor = Number.isFinite(
    creditFinancialOverallScore
  )
    ? creditFinancialOverallScore >= 75
      ? "#22c55e"
      : creditFinancialOverallScore >= 55
        ? "#fbbf24"
        : "#ef4444"
    : "#94a3b8";

  const sectorBreadth = payload?.sectorBreadth || null;
  const tactical1h = sectorBreadth?.tactical1h || null;
  const regime4h = sectorBreadth?.regime4h || null;
  const combinedSector = sectorBreadth?.combinedRead || null;

  const zoneDecisionRead = payload?.zoneDecisionRead || null;
  const zoneClassification = payload?.zoneClassification || null;
  const finalClass = zoneClassification?.finalZoneClassification || null;
  const accumulation = zoneClassification?.accumulationRead || null;
  const distribution = zoneClassification?.distributionRead || null;

  const changes = Array.isArray(payload?.underTheHood?.rows)
    ? payload.underTheHood.rows
    : [];
  const jumpAlert = buildJumpAlert(changes);

  const score = Number(headline.score);
  const stateColor = scoreColor(score);
  const permission = headline.permissionText || cleanLabel(headline.permission);
  const size = headline.size ?? headline.liveSize ?? "—";

  const intradayScore = Number(intraday?.score);
  const intradayLabel = intraday?.label || null;
  const intradayPermission =
    liveEsPermission?.mode || headline?.livePermission || null;
  const intradaySize =
    liveEsPermission?.sizeMultiplier ?? headline?.liveSize ?? null;
  const hasIntradayRead = Boolean(intraday && intradayLabel);

  const sectorColor = labelColor(combinedSector?.label, combinedSector?.score);

  const zoneDetail = buildZoneDetailRead({
    zoneDecisionRead,
    zoneClassification,
    accumulation,
    distribution,
  });

  return (
    <div
      style={{
        fontFamily: PANEL_FONT,
        position: "absolute",
        top: 126,
        left: 820,
        zIndex: 118,
        width: 760,
        maxWidth: "760px",
        maxHeight: "calc(100vh - 150px)",
        overflowY: "auto",
        borderRadius: 14,
        border: `1px solid ${engine25Border()}`,
        background: "rgba(6,10,20,0.95)",
        padding: "12px 14px",
        color: "#e5e7eb",
        backdropFilter: "blur(4px)",
        pointerEvents: "auto",
        textAlign: "left",
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        display: "grid",
        gap: 8,
      }}
      title="Engine 25 Market Health Timeline"
    >
      <div
        style={{
          border: `1px solid ${engine25Border()}`,
          borderRadius: 10,
          padding: "8px 10px",
          background: "rgba(30,64,175,0.13)",
          display: "grid",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                fontSize: FS.headerTitle,
                fontWeight: 900,
                color: "#60a5fa",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              Engine 25 Market Health
            </div>

            <div
              style={{
                fontSize: FS.headerMeta,
                lineHeight: 1.42,
                color: "#dbeafe",
                fontWeight: 650,
                marginTop: 3,
              }}
            >
              Macro · Distribution · Breadth · Zones
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.open("/engine25-full", "_blank");
            }}
            style={{
              fontFamily: PANEL_FONT,
              background: "rgba(15,23,42,0.92)",
              border: "1px solid rgba(125,211,252,0.35)",
              color: "#bae6fd",
              borderRadius: 8,
              padding: "6px 9px",
              fontSize: FS.button,
              fontWeight: 900,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            title="Open full Engine 25 dashboard"
          >
            Open Full Chart
          </button>
        </div>

        {status === "ERROR" ? (
          <div
            style={{
              color: "#fecaca",
              fontSize: FS.loading,
              lineHeight: 1.42,
              fontWeight: 700,
            }}
          >
            Engine 25 error: {error}
          </div>
        ) : status === "LOADING" && !payload ? (
          <div
            style={{
              color: "#cbd5e1",
              fontSize: FS.loading,
              lineHeight: 1.42,
              fontWeight: 700,
            }}
          >
            Loading Engine 25…
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  fontSize: FS.score,
                  lineHeight: 1,
                  fontWeight: 900,
                  color: stateColor,
                }}
              >
                {fmtScore(headline.score)}
              </div>

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 20,
                    lineHeight: 1.3,
                    fontWeight: 850,
                    color: "#f8fafc",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {cleanLabel(headline.label || headline.state)}
                </div>

                <div
                  style={{
                    fontSize: FS.headerMeta,
                    lineHeight: 1.42,
                    color: "#cbd5e1",
                    fontWeight: 650,
                    marginTop: 3,
                  }}
                >
                  EOD{" "}
                  {headline.latestEodDate ||
                    headline.cashProxyDate ||
                    headline.date ||
                    "—"}{" "}
                  · ES {headline.esClose ?? "—"}
                </div>
              </div>
            </div>

            <div
              style={{
                border: "1px solid rgba(251,191,36,0.52)",
                background: "rgba(113,63,18,0.14)",
                borderRadius: 10,
                padding: "8px 10px",
                fontSize: FS.permission,
                lineHeight: 1.42,
                color: "#fbbf24",
                fontWeight: 950,
                textTransform: "uppercase",
              }}
            >
              {permission} · Size {size}
            </div>
          </>
        )}
      </div>

      {payload && status !== "ERROR" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(250px, 0.92fr) minmax(0, 1.28fr)",
            gap: 10,
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <SectionBox
              title="News / Macro Diagnostic"
              titleColor={
                hasNewsEvents
                  ? newsEventColor(newsEventRows[0])
                  : newsFeedUnavailable
                    ? "#ef4444"
                    : "#94a3b8"
              }
              borderColor={
                hasNewsEvents
                  ? newsEventColor(newsEventRows[0])
                  : newsFeedUnavailable
                    ? "rgba(244,63,94,0.62)"
                    : "rgba(148,163,184,0.38)"
              }
              background={engine25Background()}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gap: 5 }}>
                  <div
                    style={{
                      fontSize: FS.miniLabel,
                      color: "#94a3b8",
                      fontWeight: 950,
                      textTransform: "uppercase",
                      letterSpacing: "0.03em",
                    }}
                  >
                    News Event
                  </div>

                  {newsFeedUnavailable ? (
                    <>
                      <CompareRow
                        label="Status"
                        value="NEWS FEED UNAVAILABLE"
                        color="#ef4444"
                      />
                      <NoteText color="#cbd5e1">
                        Existing Engine 25 market context remains active.
                      </NoteText>
                    </>
                  ) : hasNewsEvents ? (
                    newsEventRows.map((event) => {
                      const confirmation = confirmationSummaryForEvent(
                        event,
                        intradayMacro
                      );

                      return (
                        <div
                          key={event.eventId || event.benzingaId}
                          style={{
                            borderTop: "1px solid rgba(148,163,184,0.20)",
                            paddingTop: 6,
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <CompareRow
                            label={`News · ${fmtEventTimeArizona(event.observedAt)}`}
                            value={`${compactLabel(
                              event.eventType
                            )} · ${compactLabel(event.severity)}`}
                            color={newsEventColor(event)}
                          />

                          <NoteText color="#dbeafe">
                            {event.headlineSummary || "No headline summary"}
                          </NoteText>

                          <CompareRow
                            label="Material"
                            value={event.material === true ? "YES" : "NO"}
                            color={event.material === true ? "#fbbf24" : "#94a3b8"}
                          />

                          {event.primaryEntity && (
                            <CompareRow
                              label="Entity"
                              value={event.primaryEntity}
                              color="#cbd5e1"
                            />
                          )}

                          <div
                            style={{
                              marginTop: 3,
                              fontSize: FS.miniLabel,
                              color: "#94a3b8",
                              fontWeight: 950,
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            Market Confirmation
                          </div>

                          <CompareRow
                            label={confirmation.label}
                            value={confirmation.value}
                            color={
                              confirmation.confirmed ? "#22c55e" : "#94a3b8"
                            }
                          />

                          <NoteText color="#94a3b8">
                            {cleanLabel(confirmation.note)}
                          </NoteText>
                        </div>
                      );
                    })
                  ) : (
                    <CompareRow
                      label="Status"
                      value="NO ACTIVE MATERIAL NEWS EVENT"
                      color="#94a3b8"
                    />
                  )}
                </div>
              </div>
            </SectionBox>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {hasIntradayRead && (
              <SectionBox
                title="Live Read"
                titleColor={intradayColor(intradayLabel, intradayScore)}
                borderColor={intradayColor(intradayLabel, intradayScore)}
                background="rgba(127,29,29,0.18)"
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <CompareRow
                    label="Intraday"
                    value={`${compactLabel(intradayLabel)} · ${fmtScore(
                      intradayScore
                    )}`}
                    color={intradayColor(intradayLabel, intradayScore)}
                  />

                  <CompareRow
                    label="Permission"
                    value={`${compactLabel(intradayPermission)}${
                      intradaySize !== null && intradaySize !== undefined
                        ? ` · Size ${intradaySize}`
                        : ""
                    }`}
                    color={intradayColor(intradayLabel, intradayScore)}
                  />
                </div>
              </SectionBox>
            )}

            <SectionBox
              title="Engine 25 Interpretation"
              titleColor={macroStateColor(intradayMacro?.state)}
              borderColor={macroStateColor(intradayMacro?.state)}
              background={engine25Background()}
            >
              {hasIntradayMacro ? (
                <div style={{ display: "grid", gap: 5 }}>
                  <CompareRow
                    label="Overall"
                    value={`${compactLabel(
                      intradayMacro.state
                    )} · ${compactLabel(intradayMacro.severity)}`}
                    color={macroStateColor(
                      `${intradayMacro.state} ${intradayMacro.severity}`
                    )}
                  />

                  <CompareRow
                    label="Equity Impact"
                    value={compactLabel(intradayMacro.equityImpact)}
                    color={macroStateColor(intradayMacro.equityImpact)}
                  />

                  <CompareRow
                    label="Macro Shock"
                    value={intradayMacro.macroShock === true ? "YES" : "NO"}
                    color={
                      intradayMacro.macroShock === true ? "#ef4444" : "#94a3b8"
                    }
                  />

                  <CompareRow
                    label="Data Status"
                    value={compactLabel(
                      intradayMacro?.freshness?.status || "UNKNOWN"
                    )}
                    color={
                      String(
                        intradayMacro?.freshness?.status || ""
                      ).toUpperCase() === "FRESH"
                        ? "#22c55e"
                        : "#fbbf24"
                    }
                  />

                  {Array.isArray(intradayMacro.reasonCodes) &&
                    intradayMacro.reasonCodes.length > 0 && (
                      <NoteText color="#94a3b8">
                        {intradayMacro.reasonCodes
                          .map((code) => cleanLabel(code))
                          .join(" · ")}
                      </NoteText>
                    )}
                </div>
              ) : (
                <>
                  <CompareRow
                    label="Status"
                    value="INTRADAY MACRO UNAVAILABLE"
                    color="#94a3b8"
                  />
                  <NoteText color="#94a3b8">
                    No current Engine 25 macro confirmation data.
                  </NoteText>
                </>
              )}
            </SectionBox>

            <SectionBox
              title="Market Internals"
              titleColor={
                hasMarketInternals
                  ? labelColor(marketInternalsAlignment?.overall)
                  : "#94a3b8"
              }
              borderColor={
                hasMarketInternals
                  ? sectionBorder(marketInternalsAlignment?.overall)
                  : "rgba(148,163,184,0.38)"
              }
              background={
                hasMarketInternals
                  ? sectionBackground(marketInternalsAlignment?.overall)
                  : engine25Background()
              }
            >
              {hasMarketInternals ? (
                <div style={{ display: "grid", gap: 5 }}>
                  <CompareRow
                    label="Master ES"
                    value={`${fmtScoreDecimal(
                      marketInternalsMasterScore,
                      1
                    )} · ${compactLabel(marketInternalsMasterState)}`}
                    color={labelColor(marketInternalsMasterState)}
                  />

                  <CompareRow
                    label="1H ES / Sectors"
                    value={compactLabel(marketInternalsAlignment?.oneHour)}
                    color={
                      ["DATA_STALE", "DATA_UNAVAILABLE"].includes(
                        String(marketInternalsAlignment?.oneHour || "").toUpperCase()
                      )
                        ? "#94a3b8"
                        : labelColor(marketInternalsAlignment?.oneHour)
                    }
                  />

                  <CompareRow
                    label="4H ES / Sectors"
                    value={compactLabel(marketInternalsAlignment?.fourHour)}
                    color={
                      ["DATA_STALE", "DATA_UNAVAILABLE"].includes(
                        String(marketInternalsAlignment?.fourHour || "").toUpperCase()
                      )
                        ? "#94a3b8"
                        : labelColor(marketInternalsAlignment?.fourHour)
                    }
                  />

                  <CompareRow
                    label="EOD ES / Sectors"
                    value={compactLabel(marketInternalsAlignment?.eod)}
                    color={
                      ["DATA_STALE", "DATA_UNAVAILABLE"].includes(
                        String(marketInternalsAlignment?.eod || "").toUpperCase()
                      )
                        ? "#94a3b8"
                        : labelColor(marketInternalsAlignment?.eod)
                    }
                  />

                  <CompareRow
                    label="Overall"
                    value={compactLabel(marketInternalsAlignment?.overall)}
                    color={
                      ["DATA_STALE", "DATA_UNAVAILABLE"].includes(
                        String(marketInternalsAlignment?.overall || "").toUpperCase()
                      )
                        ? "#94a3b8"
                        : labelColor(marketInternalsAlignment?.overall)
                    }
                  />
                </div>
              ) : (
                <CompareRow
                  label="Status"
                  value="UNAVAILABLE"
                  color="#94a3b8"
                />
              )}
            </SectionBox>

            <SectionBox
              title="Intraday Macro"
              titleColor={macroStateColor(intradayMacro?.state)}
              borderColor={macroStateColor(intradayMacro?.state)}
              background={sectionBackground(
                intradayMacro?.state,
                intradayMacro?.severity
              )}
            >
              {hasIntradayMacro ? (
                <div style={{ display: "grid", gap: 5 }}>
                  <CompareRow
                    label="Overall"
                    value={`${compactLabel(intradayMacro.state)} · ${compactLabel(
                      intradayMacro.severity
                    )}`}
                    color={macroStateColor(
                      `${intradayMacro.state} ${intradayMacro.severity}`
                    )}
                  />

                  <CompareRow
                    label="Rates"
                    value={compactLabel(macroRates?.state)}
                    color={macroStateColor(macroRates?.state)}
                  />

                  <CompareRow
                    label="TLT"
                    value={compactLabel(macroTlt?.state)}
                    color={macroStateColor(macroTlt?.state)}
                  />

                  <CompareRow
                    label="Oil"
                    value={compactLabel(macroOil?.state)}
                    color={macroStateColor(macroOil?.state)}
                  />

                  <CompareRow
                    label="Geopolitics"
                    value={compactLabel(macroGeopolitics?.state)}
                    color={macroStateColor(macroGeopolitics?.state)}
                  />

                  <CompareRow
                    label="Macro Shock"
                    value={intradayMacro?.macroShock === true ? "YES" : "NO"}
                    color={
                      intradayMacro?.macroShock === true ? "#ef4444" : "#94a3b8"
                    }
                  />
                </div>
              ) : (
                <CompareRow
                  label="Status"
                  value="UNAVAILABLE"
                  color="#94a3b8"
                />
              )}
            </SectionBox>

            <SectionBox
              title="Credit / Financial Health"
              titleColor={creditFinancialOverallColor}
              borderColor={
                creditFinancialOverallColor === "#22c55e"
                  ? "rgba(34,197,94,0.50)"
                  : creditFinancialOverallColor === "#fbbf24"
                    ? "rgba(251,191,36,0.55)"
                    : creditFinancialOverallColor === "#ef4444"
                      ? "rgba(244,63,94,0.62)"
                      : "rgba(148,163,184,0.38)"
              }
              background={
                creditFinancialOverallColor === "#22c55e"
                  ? "rgba(20,83,45,0.13)"
                  : creditFinancialOverallColor === "#fbbf24"
                    ? "rgba(113,63,18,0.14)"
                    : creditFinancialOverallColor === "#ef4444"
                      ? "rgba(127,29,29,0.16)"
                      : engine25Background()
              }
            >
              <div style={{ display: "grid", gap: 5 }}>
                <CompareRow
                  label="Overall Credit / Financial"
                  value={`${fmtScore(
                    creditFinancialOverallScore
                  )} · ${creditFinancialOverallLabel}`}
                  color={creditFinancialOverallColor}
                />

                <CompareRow
                  label="System Credit Health"
                  value={`${fmtScore(macroCreditHealth?.score)} · ${
                    Number.isFinite(macroCreditScore) && macroCreditScore >= 75
                      ? "HEALTHY"
                      : Number.isFinite(macroCreditScore) && macroCreditScore >= 50
                        ? "WATCH"
                        : Number.isFinite(macroCreditScore)
                          ? "STRESSED"
                          : "UNAVAILABLE"
                  }`}
                  color={macroCreditColor}
                />

                <CompareRow
                  label="Credit Fragility"
                  value={`${fmtScore(
                    payload?.creditStressDetail?.scores?.creditFragility
                  )} · ${
                    Number(payload?.creditStressDetail?.scores?.creditFragility) >= 70
                      ? "HEALTHY"
                      : Number(payload?.creditStressDetail?.scores?.creditFragility) >= 50
                        ? "WATCH"
                        : Number.isFinite(
                            Number(payload?.creditStressDetail?.scores?.creditFragility)
                          )
                          ? "FRAGILE"
                          : "UNAVAILABLE"
                  }`}
                  color={scoreColor(
                    payload?.creditStressDetail?.scores?.creditFragility
                  )}
                />

                <CompareRow
                  label="Bond Market"
                  value={`${fmtScore(
                    payload?.creditStressDetail?.scores?.bondMarket
                  )} · ${
                    Number(payload?.creditStressDetail?.scores?.bondMarket) >= 70
                      ? "HEALTHY"
                      : Number(payload?.creditStressDetail?.scores?.bondMarket) >= 50
                        ? "MIXED"
                        : Number.isFinite(
                            Number(payload?.creditStressDetail?.scores?.bondMarket)
                          )
                          ? "STRESSED"
                          : "UNAVAILABLE"
                  }`}
                  color={scoreColor(
                    payload?.creditStressDetail?.scores?.bondMarket
                  )}
                />

                <CompareRow
                  label="Liquidity"
                  value={`${fmtScore(
                    payload?.creditStressDetail?.scores?.liquidity
                  )} · ${
                    Number(payload?.creditStressDetail?.scores?.liquidity) >= 70
                      ? "HEALTHY"
                      : Number(payload?.creditStressDetail?.scores?.liquidity) >= 50
                        ? "MIXED"
                        : Number.isFinite(
                            Number(payload?.creditStressDetail?.scores?.liquidity)
                          )
                          ? "TIGHT"
                          : "UNAVAILABLE"
                  }`}
                  color={scoreColor(
                    payload?.creditStressDetail?.scores?.liquidity
                  )}
                />

                {macroCreditSaturated && (
                  <NoteText color="#fbbf24">
                    HEALTH SCORE CAPPED AT 100 — RAW CREDIT DATA STILL MONITORED
                  </NoteText>
                )}
              </div>
            </SectionBox>

            {combinedSector && (
              <SectionBox
                title="Sector Breadth"
                titleColor={sectorColor}
                borderColor={sectionBorder(
                  combinedSector?.label,
                  combinedSector?.score
                )}
                background={sectionBackground(
                  combinedSector?.label,
                  combinedSector?.score
                )}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    <MiniRead
                      label="1H Tactical"
                      value={`${cleanLabel(
                        tactical1h?.classification?.label
                      )} · ${fmtScoreDecimal(
                        tactical1h?.classification?.score,
                        2
                      )}`}
                      color={labelColor(
                        tactical1h?.classification?.label,
                        tactical1h?.classification?.score
                      )}
                    />

                    <MiniRead
                      label="4H Regime"
                      value={`${cleanLabel(
                        regime4h?.classification?.label
                      )} · ${fmtScoreDecimal(
                        regime4h?.classification?.score,
                        2
                      )}`}
                      color={labelColor(
                        regime4h?.classification?.label,
                        regime4h?.classification?.score
                      )}
                    />
                  </div>

                  <CompareRow
                    label="Combined"
                    value={`${compactLabel(
                      combinedSector.label
                    )} · ${fmtScoreDecimal(combinedSector.score, 2)}`}
                    color={sectorColor}
                  />

                  <CompareRow
                    label="Impact"
                    value={compactLabel(combinedSector.permissionImpact)}
                    color={sectorColor}
                  />
                </div>
              </SectionBox>
            )}

            {zoneDecisionRead?.available && (
              <SectionBox
                title="Zone Context"
                titleColor={labelColor(finalClass?.state || zoneDecisionRead.label)}
                borderColor={sectionBorder(
                  finalClass?.state || zoneDecisionRead.label
                )}
                background={sectionBackground(
                  finalClass?.state || zoneDecisionRead.label
                )}
              >
                <div style={{ display: "grid", gap: 6 }}>
                  <CompareRow
                    label="State"
                    value={compactLabel(zoneDecisionRead.label)}
                    color={labelColor(zoneDecisionRead.label)}
                  />

                  <CompareRow
                    label="Accumulation"
                    value={zoneDetail.accumulationValue}
                    color={labelColor(zoneDetail.accumulationValue)}
                  />

                  <CompareRow
                    label="Distribution"
                    value={zoneDetail.distributionValue}
                    color={labelColor(zoneDetail.distributionValue)}
                  />
                </div>
              </SectionBox>
            )}

            <SectionBox
              title="Engine 25 Jump Alert"
              titleColor={jumpAlert.color}
              borderColor={jumpAlert.border}
              background={jumpAlert.background}
            >
              <div style={{ display: "grid", gap: 5 }}>
                <CompareRow
                  label="Status"
                  value={jumpAlert.status}
                  color={jumpAlert.color}
                />

                <CompareRow
                  label="Composite"
                  value={`1D ${fmtChange(jumpAlert.composite1d)} · 3D ${fmtChange(
                    jumpAlert.composite3d
                  )}`}
                  color={jumpAlert.color}
                />

                {jumpAlert.drivers.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gap: 3,
                      fontSize: FS.note,
                      lineHeight: 1.35,
                      color: "#dbeafe",
                      fontWeight: 650,
                    }}
                  >
                    <div style={{ color: "#94a3b8", fontWeight: 900 }}>
                      Biggest Drivers
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        columnGap: 10,
                        rowGap: 3,
                      }}
                    >
                      {jumpAlert.drivers.map((driver) => (
                        <span key={driver.label}>
                          {driver.label}:{" "}
                          <span
                            style={{
                              color:
                                driver.improvement >= 0 ? "#22c55e" : "#ef4444",
                              fontWeight: 900,
                            }}
                          >
                            {fmtChange(driver.change)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionBox>
          </div>
        </div>
      )}
    </div>
  );
}
