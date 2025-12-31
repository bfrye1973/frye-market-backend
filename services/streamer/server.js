// services/streamer/server.js

import express from "express";
import streamRouter from "./routes/stream.js";

const app = express();
app.disable("x-powered-by");
app.set("etag", false);

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "streamer" }));

app.use("/stream", streamRouter);

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] streamer listening on :${PORT}`);
});
