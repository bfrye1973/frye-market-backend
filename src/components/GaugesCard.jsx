import React, { useEffect, useState } from "react";

const API =
  (typeof process !== "undefined" && process.env && (
    process.env.API_BASE_URL ||
    process.env.REACT_APP_API_BASE_URL ||
    process.env.VITE_API_BASE_URL
  )) || "https://frye-market-backend-1.onrender.com";

export default function GaugesCard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setErr("");
        const r = await fetch(`${API}/api/v1/gauges`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(await r.json());
      } catch (e) {
        setErr(e.message || String(e));
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  if (err) return <div style={{ color: "crimson" }}>Gauges error: {err}</div>;
  if (!data) return <div>Loading gauges…</div>;

  const { asOf, indices = {}, breadth = {} } = data;

  const row = (k, v) => (
    <tr key={k}>
      <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{k}</td>
      <td style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #eee" }}>{v.nh ?? "-"}</td>
      <td style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #eee" }}>{v.nl ?? "-"}</td>
      <td style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #eee" }}>
        {(v.net ?? 0)}{typeof v.deltaNet === "number" ? ` (${v.deltaNet >= 0 ? "+" : ""}${v.deltaNet})` : ""}
      </td>
    </tr>
  );

  return (
    <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 12, maxWidth: 980, background: "#fff" }}>
      <h3 style={{ marginTop: 0 }}>Market Gauges — {asOf || "—"}</h3>

      <div style={{ marginBottom: 8, fontSize: 13, color: "#444" }}>
        <b>Indices:</b>{" "}
        {Object.entries(indices).map(([k, v], i) => (
          <span key={k}>
            {k} {v}
            {i < Object.keys(indices).length - 1 ? " • " : ""}
          </span>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #eee" }}>Group</th>
            <th style={{ padding: 6, borderBottom: "1px solid #eee" }}>10NH</th>
            <th style={{ padding: 6, borderBottom: "1px solid #eee" }}>10NL</th>
            <th style={{ padding: 6, borderBottom: "1px solid #eee" }}>Net (Δ)</th>
          </tr>
        </thead>
        <tbody>
          {breadth.total ? row("Total", breadth.total) : null}
          {Object.entries(breadth)
            .filter(([k]) => k !== "total")
            .map(([k, v]) => row(k, v))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
        Source: private Google Sheet CSV via backend
      </div>
    </div>
  );
}
