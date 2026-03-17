// src/pages/rows/RowChart/overlays/Engine17Overlay.jsx
// Engine 17 visual overlay layer for Lightweight Charts
//
// Draws:
// - liquidity zones
// - fib levels
// - pullback zones
// - anchors with better naming hierarchy
// - current day high / low with timestamps
// - exhaustion reversal marker (highest priority)
// - signal provenance markers
// - soft debug forward risk map
// - regime background tint
//
// Notes:
// - Uses overlayData passed in from RowChart; no fetching here
// - Follows existing overlay lifecycle: seed / update / destroy

export default function Engine17Overlay({
  chart,
  priceSeries,
  chartContainer,
  overlayData,

  showLiquidityZones = true,
  showMarketStructure = true,
  showSignals = true,
  showSignalProvenance = false,
  showForwardRiskMap = false,
  showRegimeBackground = false,
}) {
  if (!chart || !priceSeries || !chartContainer) {
    return { seed() {}, update() {}, destroy() {} };
  }

  let canvas = null;
  const ts = chart.timeScale();

  const BAND_LABEL_FONT = 22;
  const LINE_LABEL_FONT = 24;
  const MARKER_FONT = 24;
  const BIG_MARKER_FONT = 28;

  const LEFT_LABEL_X_PCT = 0.2;
  const MID_LABEL_X_PCT = 0.5;

  function ensureCanvas() {
    if (canvas) return canvas;

    const cnv = document.createElement("canvas");
    cnv.className = "overlay-canvas engine17-overlay";
    Object.assign(cnv.style, {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      zIndex: 81,
    });

    chartContainer.appendChild(cnv);
    canvas = cnv;
    return canvas;
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = chartContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }

  function priceToY(price) {
    const y = priceSeries.priceToCoordinate(Number(price));
    return Number.isFinite(y) ? y : null;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function markerColorForSignal(kind) {
    if (kind === "BREAKOUT_READY") return "#22c55e";
    if (kind === "BREAKDOWN_READY") return "#ef4444";
    if (kind === "IMPULSE_VOLUME_CONFIRMED") return "#a78bfa";
    return "#f3f4f6";
  }

  function getAnchorTimeLabel(kind) {
    const a = overlayData?.fib?.anchors || {};
    if (!a) return null;

    switch (kind) {
      case "PREMARKET_LOW":
        return a.premarketLowTime || null;
      case "PREMARKET_HIGH":
        return a.premarketHighTime || null;
      case "SESSION_HIGH":
        return a.sessionHighTime || null;
      case "SESSION_LOW":
        return a.sessionLowTime || null;
      case "FIB_ANCHOR_A":
        return a.anchorATime || null;
      case "FIB_ANCHOR_B":
        return a.anchorBTime || null;
      default:
        return null;
    }
  }

  function getAnchorDisplay(a) {
    const timeLabel = getAnchorTimeLabel(a.kind);
    const base = a.label || a.kind;

    switch (a.kind) {
      case "FIB_ANCHOR_A":
        return {
          text: timeLabel
            ? `Impulse Base (Fib A) ${Number(a.price).toFixed(2)} (${timeLabel})`
            : `Impulse Base (Fib A) ${Number(a.price).toFixed(2)}`,
          color: "#f8fafc",
          big: true,
        };
      case "FIB_ANCHOR_B":
        return {
          text: timeLabel
            ? `Impulse High (Fib B) ${Number(a.price).toFixed(2)} (${timeLabel})`
            : `Impulse High (Fib B) ${Number(a.price).toFixed(2)}`,
          color: "#f8fafc",
          big: true,
        };
      case "SESSION_HIGH":
        return {
          text: timeLabel
            ? `Session High ${Number(a.price).toFixed(2)} (${timeLabel})`
            : `Session High ${Number(a.price).toFixed(2)}`,
          color: "rgba(255,255,255,0.85)",
          big: false,
        };
      case "SESSION_LOW":
        return {
          text: timeLabel
            ? `Session Low ${Number(a.price).toFixed(2)} (${timeLabel})`
            : `Session Low ${Number(a.price).toFixed(2)}`,
          color: "rgba(255,255,255,0.78)",
          big: false,
        };
      case "PREMARKET_HIGH":
        return {
          text: timeLabel
            ? `Premarket High ${Number(a.price).toFixed(2)} (${timeLabel})`
            : `Premarket High ${Number(a.price).toFixed(2)}`,
          color: "rgba(203,213,225,0.72)",
          big: false,
        };
      case "PREMARKET_LOW":
        return {
          text: timeLabel
            ? `Premarket Low ${Number(a.price).toFixed(2)} (${timeLabel})`
            : `Premarket Low ${Number(a.price).toFixed(2)}`,
          color: "rgba(203,213,225,0.72)",
          big: false,
        };
      default:
        return {
          text: timeLabel ? `${base} (${timeLabel})` : base,
          color: "#e5e7eb",
          big: false,
        };
    }
  }

  function buildDayLevelLabels() {
    const a = overlayData?.fib?.anchors || {};
    const out = [];

    if (Number.isFinite(a?.sessionHigh)) {
      const t = a.sessionHighTime ? ` (${a.sessionHighTime})` : "";
      out.push({
        price: a.sessionHigh,
        text: `DAY HIGH ${Number(a.sessionHigh).toFixed(2)}${t}`,
        color: "#22c55e",
      });
    }

    if (Number.isFinite(a?.premarketLow)) {
      const t = a.premarketLowTime ? ` (${a.premarketLowTime})` : "";
      out.push({
        price: a.premarketLow,
        text: `DAY LOW ${Number(a.premarketLow).toFixed(2)}${t}`,
        color: "#ef4444",
      });
    }

    return out;
  }

  function drawBand(
    ctx,
    w,
    lo,
    hi,
    fill,
    stroke,
    dash = [],
    strokeWidth = 1,
    label = ""
  ) {
    const y1 = priceToY(lo);
    const y2 = priceToY(hi);
    if (y1 == null || y2 == null) return;

    const top = Math.min(y1, y2);
    const h = Math.max(2, Math.abs(y2 - y1));

    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(0, top, w, h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash(dash);
    ctx.strokeRect(1, top + 1, Math.max(1, w - 2), Math.max(1, h - 2));
    ctx.restore();

    if (label) {
      ctx.save();
      ctx.font = `${BAND_LABEL_FONT}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const tw = ctx.measureText(label).width;
      const bx = Math.max(24, Math.floor(w * 0.14));
      const by = Math.max(16, top + 8);
      const bw = tw + 30;
      const bh = Math.max(32, Math.floor(BAND_LABEL_FONT * 1.45));

      ctx.fillStyle = "rgba(0,0,0,0.80)";
      ctx.strokeStyle = "rgba(255,255,255,0.20)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx, by, bw, bh, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#f3f4f6";
      ctx.fillText(label, bx + 15, by + Math.floor(bh * 0.72));
      ctx.restore();
    }
  }

  function drawHLine(
    ctx,
    w,
    price,
    color,
    label,
    dash = [],
    lineWidth = 1.5,
    xLabel = null
  ) {
    const y = priceToY(price);
    if (y == null) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.restore();

    if (label) {
      ctx.save();
      ctx.font = `${LINE_LABEL_FONT}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const text = `${label}  ${Number(price).toFixed(2)}`;
      const tw = ctx.measureText(text).width;
      const bw = tw + 30;
      const bh = Math.max(36, Math.floor(LINE_LABEL_FONT * 1.45));

      const bx =
        xLabel == null
          ? Math.max(24, Math.floor(w * MID_LABEL_X_PCT))
          : xLabel;

      const by = y - bh / 2;

      ctx.fillStyle = "rgba(0,0,0,0.82)";
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx, by, bw, bh, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.fillText(text, bx + 15, by + Math.floor(bh * 0.72));
      ctx.restore();
    }
  }

  function drawMarker(ctx, w, price, text, color, align = "right", big = false) {
    const y = priceToY(price);
    if (y == null) return;

    const fontPx = big ? BIG_MARKER_FONT : MARKER_FONT;
    const padX = big ? 18 : 16;

    ctx.save();
    ctx.font = `${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = Math.max(big ? 42 : 38, Math.floor(fontPx * 1.45));

    const bx =
      align === "left"
        ? Math.max(24, Math.floor(w * LEFT_LABEL_X_PCT))
        : Math.max(24, w - bw - 18);

    const by = y - bh / 2;

    ctx.fillStyle = "rgba(0,0,0,0.84)";
    ctx.strokeStyle = color;
    ctx.lineWidth = big ? 2 : 1.5;
    roundRect(ctx, bx, by, bw, bh, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillText(text, bx + padX, by + Math.floor(bh * 0.72));
    ctx.restore();
  }

  function getRegimeTint() {
    const fib = overlayData?.fib || {};
    const strategyType = fib.strategyType || "";
    const context = fib.context || "";
    const badges = Array.isArray(overlayData?.badges) ? overlayData.badges : [];
    const state = badges.find((b) => b.kind === "STATE")?.value || "";
    const volume = badges.find((b) => b.kind === "VOLUME")?.value || "";

    if (strategyType === "EXHAUSTION") {
      if (fib.exhaustionShort) return "rgba(239,68,68,0.07)";
      if (fib.exhaustionLong) return "rgba(34,197,94,0.07)";
    }

    if (
      context === "LONG_CONTEXT" &&
      state !== "BELOW_PULLBACK" &&
      volume === "CONFIRMED"
    ) {
      return "rgba(16,185,129,0.06)";
    }
    if (
      context === "SHORT_CONTEXT" &&
      state !== "BELOW_PULLBACK" &&
      volume === "CONFIRMED"
    ) {
      return "rgba(239,68,68,0.06)";
    }
    if (state === "DEEP_PULLBACK" || state === "IN_PULLBACK") {
      return "rgba(245,158,11,0.05)";
    }
    return null;
  }

  function buildSoftRiskMap() {
    const fib = overlayData?.fib;
    if (
      !fib?.levels ||
      !Number.isFinite(fib?.anchorA) ||
      !Number.isFinite(fib?.anchorB)
    ) {
      return null;
    }

    const context = fib.context;
    const span = Math.abs(fib.anchorB - fib.anchorA);
    if (!(span > 0)) return null;

    if (context === "LONG_CONTEXT") {
      return {
        stop: fib.levels.r786,
        t1: fib.anchorB + span * 0.382,
        t2: fib.anchorB + span * 0.618,
      };
    }

    if (context === "SHORT_CONTEXT") {
      return {
        stop: fib.levels.r786,
        t1: fib.anchorB - span * 0.382,
        t2: fib.anchorB - span * 0.618,
      };
    }

    return null;
  }

  function drawExhaustion(ctx, w) {
    const fib = overlayData?.fib;
    if (!fib?.exhaustionDetected || !fib?.exhaustionActive) return;

    const price = Number(fib.exhaustionBarPrice);
    if (!Number.isFinite(price)) return;

    const y = priceToY(price);
    if (y == null) return;

    const isShort = fib.exhaustionShort === true;
    const isLong = fib.exhaustionLong === true;
    const color = isShort ? "#ef4444" : isLong ? "#22c55e" : "#f3f4f6";
    const timeText = fib.exhaustionBarTime ? ` (${fib.exhaustionBarTime})` : "";
    const text = isShort
      ? `EXHAUSTION SHORT @ ${price.toFixed(2)}${timeText}`
      : isLong
      ? `EXHAUSTION LONG @ ${price.toFixed(2)}${timeText}`
      : `EXHAUSTION @ ${price.toFixed(2)}${timeText}`;

    const x = Math.floor(w * 0.74);

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    if (isShort) {
      ctx.beginPath();
      ctx.moveTo(x, y - 24);
      ctx.lineTo(x - 13, y - 2);
      ctx.lineTo(x - 5, y - 2);
      ctx.lineTo(x - 5, y + 18);
      ctx.lineTo(x + 5, y + 18);
      ctx.lineTo(x + 5, y - 2);
      ctx.lineTo(x + 13, y - 2);
      ctx.closePath();
      ctx.fill();
    } else if (isLong) {
      ctx.beginPath();
      ctx.moveTo(x, y + 24);
      ctx.lineTo(x - 13, y + 2);
      ctx.lineTo(x - 5, y + 2);
      ctx.lineTo(x - 5, y - 18);
      ctx.lineTo(x + 5, y - 18);
      ctx.lineTo(x + 5, y + 2);
      ctx.lineTo(x + 13, y + 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();

    drawMarker(ctx, w, price, text, color, "right", true);
  }

  function draw() {
    if (!overlayData?.ok) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const cnv = ensureCanvas();
    resizeCanvas();

    const rect = chartContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const ctx = cnv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cnv.width, cnv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;

    if (showRegimeBackground) {
      const tint = getRegimeTint();
      if (tint) {
        ctx.save();
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }

    if (showLiquidityZones) {
      const zones = Array.isArray(overlayData?.zones) ? overlayData.zones : [];
      zones.forEach((z) => {
        if (!Number.isFinite(z?.lo) || !Number.isFinite(z?.hi)) return;
        drawBand(
          ctx,
          w,
          z.lo,
          z.hi,
          "rgba(0,220,200,0.10)",
          "rgba(0,220,200,0.80)",
          [8, 7],
          1,
          z.label || "Negotiated Zone"
        );
        if (Number.isFinite(z?.mid)) {
          drawHLine(ctx, w, z.mid, "rgba(0,220,200,0.30)", "", [10, 8], 1);
        }
      });
    }

    if (showMarketStructure) {
      const fib = overlayData?.fib;
      const lv = fib?.levels || {};

      if (
        Number.isFinite(fib?.primaryZone?.lo) &&
        Number.isFinite(fib?.primaryZone?.hi)
      ) {
        drawBand(
          ctx,
          w,
          fib.primaryZone.lo,
          fib.primaryZone.hi,
          "rgba(59,130,246,0.10)",
          "rgba(59,130,246,0.75)",
          [6, 5],
          1,
          "Primary Pullback"
        );
      }

      if (
        Number.isFinite(fib?.secondaryZone?.lo) &&
        Number.isFinite(fib?.secondaryZone?.hi)
      ) {
        drawBand(
          ctx,
          w,
          fib.secondaryZone.lo,
          fib.secondaryZone.hi,
          "rgba(245,158,11,0.10)",
          "rgba(245,158,11,0.80)",
          [6, 5],
          1,
          "Secondary Pullback"
        );
      }

      if (Number.isFinite(lv?.r382)) {
        drawHLine(ctx, w, lv.r382, "#7dd3fc", "Fib 38.2", [], 1.5);
      }
      if (Number.isFinite(lv?.r500)) {
        drawHLine(ctx, w, lv.r500, "#93c5fd", "Fib 50.0", [], 1.5);
      }
      if (Number.isFinite(lv?.r618)) {
        drawHLine(ctx, w, lv.r618, "#60a5fa", "Fib 61.8", [], 1.8);
      }
      if (Number.isFinite(lv?.r786)) {
        drawHLine(ctx, w, lv.r786, "#ef4444", "Inv 78.6", [12, 8], 2);
      }

      const anchors = Array.isArray(overlayData?.anchors) ? overlayData.anchors : [];
      anchors.forEach((a) => {
        if (!Number.isFinite(a?.price)) return;
        const display = getAnchorDisplay(a);
        drawMarker(ctx, w, a.price, display.text, display.color, "left", display.big);
      });

      const dayLabels = buildDayLevelLabels();
      dayLabels.forEach((d) => {
        drawMarker(ctx, w, d.price, d.text, d.color, "right", true);
      });
    }

    // Highest priority visual
    drawExhaustion(ctx, w);

    if (showSignals) {
      const fib = overlayData?.fib;
      const signals = Array.isArray(overlayData?.signals) ? overlayData.signals : [];

      signals.forEach((s) => {
        if (!Number.isFinite(s?.price)) return;

        if (fib?.exhaustionDetected && fib?.exhaustionActive) return;

        const label = showSignalProvenance
          ? `E16 • ${s.label || s.kind}`
          : (s.label || s.kind);

        drawMarker(
          ctx,
          w,
          s.price,
          label,
          markerColorForSignal(s.kind),
          "right"
        );
      });
    }

    if (showForwardRiskMap) {
      const risk = buildSoftRiskMap();
      if (risk) {
        if (Number.isFinite(risk.stop)) {
          drawHLine(ctx, w, risk.stop, "#ef4444", "SOFT STOP", [12, 8], 2);
        }
        if (Number.isFinite(risk.t1)) {
          drawHLine(ctx, w, risk.t1, "#22c55e", "SOFT T1", [16, 8], 1.8);
        }
        if (Number.isFinite(risk.t2)) {
          drawHLine(ctx, w, risk.t2, "#10b981", "SOFT T2", [16, 8], 1.8);
        }
      }
    }
  }

  const visibleCb = () => draw();
  ts.subscribeVisibleTimeRangeChange?.(visibleCb);

  function seed() {
    draw();
  }

  function update() {
    draw();
  }

  function destroy() {
    try {
      ts.unsubscribeVisibleTimeRangeChange?.(visibleCb);
    } catch {}
    try {
      if (canvas && canvas.parentNode === chartContainer) {
        chartContainer.removeChild(canvas);
      }
    } catch {}
    canvas = null;
  }

  return { seed, update, destroy };
}
