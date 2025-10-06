// services/core/server.js
// ...existing imports...
import { ohlcRouter } from "./routes/ohlc.js";
import liveRouter from "./routes/live.js";               // ⬅️ ADD THIS

// ... existing code ...

// --- API routes ---
app.use("/api/v1/ohlc", ohlcRouter);
app.use("/live", liveRouter);                             // ⬅️ ADD THIS

// ... rest unchanged ...
