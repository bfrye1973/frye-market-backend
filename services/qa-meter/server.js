// QA Meter microservice (ESM) — totally separate from Core
import express from "express";

// ensure fetch
let _f = globalThis.fetch;
if (typeof _f !== "function") {
  const { default: nodeFetch } = await import("node-fetch");
  globalThis.fetch = nodeFetch;
}

const app = express();
const PORT = process.env.PORT || 3000;

// CORS (dashboard + local)
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000"
]);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ALLOW.has(o)) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const RAW_OWNER  = process.env.RAW_OWNER  || "bfrye1973";
const RAW_REPO   = process.env.RAW_REPO   || "frye-market-backend";
const RAW_BRANCH = process.env.RAW_BRANCH || "main";
const PATH_INTRADAY = process.env.RAW_PATH_INTRADAY || "data-live-10min/data/outlook_intraday.json";

const rawUrl = p => `https://raw.githubusercontent.com/${RAW_OWNER}/${RAW_REPO}/${RAW_BRANCH}/${p}?t=${Date.now()}`;

app.get("/__up", (_req,res)=>res.type("text").send("UP"));
app.get("/healthz", (_req,res)=>res.json({ ok:true, service:"qa-meter", ts:new Date().toISOString() }));

// GET /qa/meter — recompute and print
app.get("/qa/meter", async (_req,res) => {
  try {
    const r = await fetch(rawUrl(PATH_INTRADAY), { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok:false, error:`raw ${r.status}` });
    const j = await r.json();

    const cards = Array.isArray(j?.sectorCards) ? j.sectorCards : [];
    let NH=0,NL=0,UP=0,DN=0,rising=0,offUp=0,defDn=0;
    const OFF = new Set(["Information Technology","Communication Services","Consumer Discretionary"]);
    const DEF = new Set(["Consumer Staples","Utilities","Health Care","Real Estate"]);
    const pct = (a,b)=> b===0?0:(100*a/b);

    for (const c of cards) {
      const nh=+c.nh||0, nl=+c.nl||0, up=+c.up||0, dn=+c.down||0;
      NH+=nh; NL+=nl; UP+=up; DN+=dn;
      const b=pct(nh, nh+nl);
      if (b>50) rising++;
      const sec=String(c.sector||"");
      if (OFF.has(sec) && b>50) offUp++;
      if (DEF.has(sec) && b<50) defDn++;
    }

    const calc = {
      breadth_pct: pct(NH,NH+NL),
      momentum_pct: pct(UP,UP+DN),
      risingPct: pct(rising,11),
      riskOnPct: pct(offUp+defDn, OFF.size+DEF.size),
    };

    const live = {
      breadth_pct: +(j?.metrics?.breadth_pct ?? 0),
      momentum_pct: +(j?.metrics?.momentum_pct ?? 0),
      risingPct: +((j?.intraday?.sectorDirection10m)?.risingPct ?? 0),
      riskOnPct: +((j?.intraday?.riskOn10m)?.riskOnPct ?? 0),
    };

    const tol = { breadth_pct:0.25, momentum_pct:0.25, risingPct:0.5, riskOnPct:0.5 };
    const line=(label,a,b,t)=> {
      const d=+((a-b)).toFixed(2);
      const ok=Math.abs(d)<=t;
      return `${ok?"✅":"❌"} ${label.padEnd(12)} live=${a.toFixed(2).padStart(6)}  calc=${b.toFixed(2).padStart(6)}  Δ=${d>=0?"+":""}${d.toFixed(2)} (tol ±${t})`;
    };

    const rows = [
      line("Breadth %",  live.breadth_pct,  calc.breadth_pct,  tol.breadth_pct),
      line("Momentum %", live.momentum_pct, calc.momentum_pct, tol.momentum_pct),
      line("Rising %",   live.risingPct,    calc.risingPct,    tol.risingPct),
      line("Risk-On %",  live.riskOnPct,    calc.riskOnPct,    tol.riskOnPct),
    ];
    const pass = rows.every(r=>r.startsWith("✅"));
    const stamp = (j?.updated_at || j?.updated_at_utc || "").toString();

    const overall = j?.intraday?.overall10m || {};
    const comps   = overall.components || {};
    const emaCross= String(j?.metrics?.ema_cross ?? "n/a");
    const emaDist = Number(j?.metrics?.ema10_dist_pct ?? NaN);

    res.type("text").send([
      `QA Meter Check  (${stamp})`,
      `Source: ${rawUrl(PATH_INTRADAY).replace(/\?.*$/,"")}`,
      "",
      ...rows,
      "",
      `Overall10m: state=${String(overall.state ?? "n/a")}  score=${Number.isFinite(+overall.score)?overall.score:"n/a"}`,
      `  ema_cross=${emaCross}  ema10_dist_pct=${Number.isFinite(emaDist)?emaDist.toFixed(2)+"%":"n/a"}`,
      `  components:`,
      `    ema10=${comps.ema10??"n/a"}  momentum=${comps.momentum??"n/a"}  breadth=${comps.breadth??"n/a"}`,
      `    squeeze=${comps.squeeze??"n/a"}  liquidity=${comps.liquidity??"n/a"}  riskOn=${comps.riskOn??"n/a"}`,
      "",
      `Summary: ${pass?"PASS ✅":"FAIL ❌"}`,
      ""
    ].join("\n"));
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

app.use((req,res)=>res.status(404).json({ ok:false, error:"Not Found", path:req.path }));

app.listen(PORT, ()=> console.log(`[qa-meter] listening on :${PORT}`));
