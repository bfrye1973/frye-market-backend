// server.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 5173;

// Allowed frontends (edit if needed)
const ALLOW_LIST = [
  process.env.ALLOWED_ORIGIN,                    // optional, from env
  'https://frye-dashboard.onrender.com',         // Render frontend
  'http://localhost:5173',                       // local Vite/dev
  'http://localhost:3000',                       // local webpack/dev
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOW_LIST.includes(origin)) return callback(null, true);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(morgan('tiny'));

// ---------- Base API Routes ----------
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/ping', (req, res) => {
  res.status(200).json({
    ok: true,
    ping: 'pong',
    ts: Date.now()
  });
});

// ---------- v1 API (stable namespace) ----------
const v1 = express.Router();

function ok(res, data) {
  return res.status(200).json({ ok: true, data });
}

function bad(res, status = 400, msg = 'Bad request') {
  return res.status(status).json({ ok: false, error: msg });
}

v1.get('/health', (req, res) => ok(res, { uptime: process.uptime(), ts: Date.now() }));

v1.get('/ping', (req, res) => ok(res, { ping: 'pong', ts: Date.now() }));

v1.get('/time', (req, res) => ok(res, { now: new Date().toISOString() }));

v1.get('/config', (req, res) => ok(res, {
  env: process.env.NODE_ENV || 'production',
  allowedOrigins: ALLOW_LIST
}));

v1.get('/quotes', (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return bad(res, 400, 'Query param "symbol" is required');
  return ok(res, { symbol, price: 123.45, change: 0.12, ts: Date.now() });
});

v1.get('/signal', (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!symbol) return bad(res, 400, 'Query param "symbol" is required');
  return ok(res, { symbol, signal: 'neutral', confidence: 0.53, ts: Date.now() });
});

app.use('/api/v1', v1);

// ---------- 404 Handler for /api ----------
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ---------- Global Error Handler ----------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ ok: false, error: err.message || 'Server error' });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  console.log('Allowed origins:', ALLOW_LIST);
});
