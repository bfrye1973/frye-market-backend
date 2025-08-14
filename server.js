// server.js
// ------------------------------------------------------
// Frye backend — Express API (Render-ready)
// ------------------------------------------------------

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 3000; // Render will inject PORT

// Add any allowed frontends here (and/or via env ALLOWED_ORIGIN)
const ALLOW_LIST = [
  process.env.ALLOWED_ORIGIN,                 // optional, comma-separated
  'https://frye-dashboard.onrender.com',      // Render frontend
  'http://localhost:5173',                    // local Vite/dev
  'http://localhost:3000',                    // local webpack/dev
].filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // allow server-to-server/health checks (no Origin header)
    if (!origin) return cb(null, true);
    if (ALLOW_LIST.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// ---------- Middleware ----------
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight
app.use(express.json());
app.use(morgan('tiny'));

// ---------- Basic (concrete) routes ----------
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Accept any method for /api/ping so “Cannot GET” never appears
app.all('/api/ping', (req, res) => {
  res.status(200).json({ ok: true, ping: 'pong', method: req.method, ts: Date.now() });
});

// ---------- /api/v1 bundle ----------
const v1 = express.Router();

// helpers
const ok = (res, data) => res.status(200).json({ ok: true, data });
const bad = (res, status = 400, msg = 'Bad request') =>
  res.status(status).json({ ok: false, error: msg });

v1.get('/health', (req, res) =>
  ok(res, { uptime: process.uptime(), ts: Date.now() })
);

v1.all('/ping', (req, res) =>
  ok(res, { ping: 'pong', method: req.method, ts: Date.now() })
);

v1.get('/time', (req, res) =>
  ok(res, { now: new Date().toISOString() })
);

v1.get('/config', (req, res) =>
  ok(res, {
    env: process.env.NODE_ENV || 'production',
    allowedOrigins: (process.env.ALLOWED_ORIGIN || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  })
);

v1.get('/quotes', (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return bad(res, 400, 'Query param "symbol" is required');
  // stubbed quote
  return ok(res, { symbol, price: 123.45, change: 0.12, ts: Date.now() });
});

v1.get('/signal', (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return bad(res, 400, 'Query param "symbol" is required');
  // stubbed signal
  return ok(res, { symbol, signal: 'neutral', confidence: 0.53, ts: Date.now() });
});

// simple echo for POST testing
v1.post('/echo', (req, res) => ok(res, { received: req.body || null, ts: Date.now() }));

app.use('/api/v1', v1);

// ---------- 404 for unknown API routes (keep after routes above) ----------
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: err.message || 'Server error',
  });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  console.log('Allowed origins:', ALLOW_LIST);
});
