// config.js
export const CONFIG = {
  port: Number(process.env.PORT || 5055),
  polygonKey: process.env.POLYGON_API_KEY || "",
  timeframeSec: Number(process.env.TIMEFRAME_SEC || 300),
  lookbackDays: Number(process.env.LOOKBACK_DAYS || 20),
  redisUrl: process.env.REDIS_URL || "",
};

export default CONFIG;
