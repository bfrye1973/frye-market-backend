// server.js — production-ready Express server with strict CORS + health route

const express = require('express');
const cors = require('cors');

const app = express();

// --------------------
// Port
// --------------------
const PORT = process.env.PORT || 5055;

// --------------------
// Allowed frontends (CORS allowlist)
//   - Keep ONLY the domains that should be allowed to call your backend.
//   - localhost is for your local dev frontend.
//   - The Render URL is your live frontend.
// --------------------
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'https://frye-dashboard.onrender.com',
];

// --------------------
// CORS configuration
// --------------------
const corsOptions = {
  origin(origin, cb) {
    // Allow server-to-server/curl/health checks (no Origin header).
    if (!origin) return cb(null, true);

    // Allow only our frontends.
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

    // Everything else is blocked.
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// Apply CORS and handle preflight
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --------------------
// Body parsing
// --------------------
app.use(express.json());

// --------------------
// Health check
// --------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// --------------------
// (Add your API routes here)
// Example:
// app.get('/api/example', (req, res) => {
//   res.json({ message: 'It works!' });
// });

// --------------------
// 404 for unknown /api/* routes
// --------------------
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --------------------
// Basic error handler (keeps responses JSON)
// --------------------
app.use((err, req, res, next) => {
  console.error(err && err.stack ? err.stack : err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
  });
});

// --------------------
// Start server
// --------------------
app.listen(PORT, () => {
  console.log(`Market backend up on http://localhost:${PORT}`);
});
