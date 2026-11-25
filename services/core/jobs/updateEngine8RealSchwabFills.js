// services/core/jobs/updateEngine8RealSchwabFills.js
// One-shot Engine 8 read-only Schwab REAL fill observer.
//
// Dry-run is the default.
// Delivery requires:
// ENGINE8_REAL_FILL_DELIVERY_ENABLED=1
// CORE_BASE=https://frye-market-backend-1.onrender.com
//
// A one-shot delivery run is treated as restart/recovery mode so it can
// safely resume from the durable Engine 8 watermark.

import {
  observeSchwabRealFills,
} from "../logic/trading/schwab/engine8RealFillObserver.js";

try {
  const out = await observeSchwabRealFills({
    recoveryMode:
      process.env.ENGINE8_REAL_FILL_DELIVERY_ENABLED === "1",
  });

  console.log(JSON.stringify(out, null, 2));

  if (out.ok !== true) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    "[engine8 real fill observer] failed:",
    error?.stack || error
  );
  process.exitCode = 1;
}
