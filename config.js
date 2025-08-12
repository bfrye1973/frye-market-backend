import 'dotenv/config';

export const CONFIG = {
  key: process.env.POLYGON_API_KEY,
  port: Number(process.env.PORT || 5055),
  timeframeSec: Number(process.env.TIMEFRAME_SEC || 300),
  lookbackDays: Number(process.env.LOOKBACK_DAYS || 20),
  redisUrl: process.env.REDIS_URL || null,
};
