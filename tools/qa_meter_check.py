/* --------------------------- QA: Market Meter math --------------------------- */
// GET /qa/meter  → recompute key metrics from sectorCards and compare to live JSON,
// and print Overall Market light (state, score, components, ema fields)
app.get("/qa/meter", async (_req, res) => {
  try {
    const LIVE_URL =
      process.env.LIVE_URL ||
      "https://frye-market-backend-1.onrender.com/live/intraday";

    const r = await fetch(LIVE_URL, { cache: "no-store" });
    if (!r.ok) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(r.status).send(`Upstream error ${r.status}`);
    }
    const j = await r.json();

    const cards = Array.isArray(j?.sectorCards) ? j.sectorCards : [];

    // recompute from cards
    let NH = 0, NL = 0, UP = 0, DN = 0, rising = 0, offUp = 0, defDn = 0;
    const OFF = new Set(["Information Technology","Communication Services","Consumer Discretionary"]);
    const DEF = new Set(["Consumer Staples","Utilities","Health Care","Real Estate"]);
    const pct = (a, b) => (b === 0 ? 0 : (100 * a) / b);

    for (const c of cards) {
      const nh = +c.nh || 0, nl = +c.nl || 0, up = +c.up || 0, dn = +c.down || 0;
      NH += nh; NL += nl; UP += up; DN += dn;
      const b = pct(nh, nh + nl);
      if (b > 50) rising++;
      const sec = String(c.sector || "");
      if (OFF.has(sec) && b > 50) offUp++;
      if (DEF.has(sec) && b < 50) defDn++;
    }

    const calc = {
      breadth_pct:  pct(NH, NH + NL),
      momentum_pct: pct(UP, UP + DN),
      risingPct:    pct(rising, 11),
      riskOnPct:    pct(offUp + defDn, OFF.size + DEF.size),
    };

    const live = {
      breadth_pct:  +(j?.metrics?.breadth_pct ?? 0),
      momentum_pct: +(j?.metrics?.momentum_pct ?? 0),
      risingPct:    +((j?.intraday?.sectorDirection10m)?.risingPct ?? 0),
      riskOnPct:    +((j?.intraday?.riskOn10m)?.riskOnPct ?? 0),
    };

    const tol = { breadth_pct: 0.25, momentum_pct: 0.25, risingPct: 0.5, riskOnPct: 0.5 };
    const line = (label, a, b, t) => {
      const d = +(a - b).toFixed(2);
      const ok = Math.abs(d) <= t;
      return `${ok ? "✅" : "❌"} ${label.padEnd(12)} live=${a.toFixed(2).padStart(6)}  calc=${b.toFixed(2).padStart(6)}  Δ=${d >= 0 ? "+" : ""}${d.toFixed(2)} (tol ±${t})`;
    };

    const rows = [
      line("Breadth %",  live.breadth_pct,  calc.breadth_pct,  tol.breadth_pct),
      line("Momentum %", live.momentum_pct, calc.momentum_pct, tol.momentum_pct),
      line("Rising %",   live.risingPct,    calc.risingPct,    tol.risingPct),
      line("Risk-On %",  live.riskOnPct,    calc.riskOnPct,    tol.riskOnPct),
    ];
    const pass = rows.every(r => r.startsWith("✅"));
    const stamp = (j?.updated_at || j?.updated_at_utc || "").toString();

    // ---- Overall light (from live JSON) ----
    const overall  = j?.intraday?.overall10m || {};
    const ovState  = String(overall.state ?? "n/a");
    const ovScore  = Number(overall.score ?? NaN);
    const comps    = overall.components || {};
    const emaCross = String(j?.metrics?.ema_cross ?? "n/a");
    const emaDist  = Number(j?.metrics?.ema10_dist_pct ?? NaN);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send([
      `QA Meter Check  (${stamp})`,
      `Source: ${LIVE_URL}`,
      "",
      ...rows,
      "",
      `Overall10m: state=${ovState}  score=${Number.isFinite(ovScore) ? ovScore : "n/a"}`,
      `  ema_cross=${emaCross}  ema10_dist_pct=${Number.isFinite(emaDist) ? emaDist.toFixed(2)+"%" : "n/a"}`,
      `  components:`,
      `    ema10=${comps.ema10 ?? "n/a"}  momentum=${comps.momentum ?? "n/a"}  breadth=${comps.breadth ?? "n/a"}`,
      `    squeeze=${comps.squeeze ?? "n/a"}  liquidity=${comps.liquidity ?? "n/a"}  riskOn=${comps.riskOn ?? "n/a"}`,
      "",
      `Summary: ${pass ? "PASS ✅" : "FAIL ❌"}`,
      ""
    ].join("\n"));
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
});
