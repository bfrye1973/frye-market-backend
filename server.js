// server.js — full, production-ready minimal API server

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

// ---------------------------
// Config
// ---------------------------
const PORT = process.env.PORT || 5055;

// Frontends allowed to call this API
const ALLOWED_ORIGINS = [
  'http://localhost:3001',                 // local frontend (dev)
  'https://frye-dashboard.onrender.com',   // live frontend on Render
];

// ---------------------------
// App setup
// ---------------------------
const app = express();

// Trust Render's proxy headers (X-Forwarded-*)
app.set('trust proxy', 1);

// Security + performance
app.disable('x-powered-by');
app.use(helmet());
app.use(compression());

// Force HTTPS in production (Render sends x-forwarded-proto)
app.use((req, res, next) => {
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

// ---------------------------
// CORS
// ---------------------------
//
// We use a function origin check so:
//  - browser requests must come from one of ALLOWED_ORIGINS
//  - non-browser/no-origin (curl, server-to-server, health checks) are allowed
//
const corsOptions = {
  origin(origin, cb) {
    // Allow server-to-server, curl, and health checks (no Origin header)
    if (!origin) return cb(null, true);

    if (ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }

    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Handle preflight globally
app.options('*', cors(corsOptions));

// ---------------------------
// Body parsing
// ---------------------------
app.use(express.json());

// ---------------------------
// Routes
// ---------------------------

// Health check (used by Render + your frontend)
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Simple version info (handy for debugging live)
app.get('/api/version', (req, res) => {
  res.json({
    name: 'market-backend',
    version: process.env.COMMIT_SHA || 'local-dev',
    time: new Date().toISOString(),
  });
});

// Example placeholder where you can add more API routes:
// app.get('/api/metrics', (req, res) => { ... });

// Catch-all for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---------------------------
// Start
// ---------------------------
app.listen(PORT, () => {
  console.log(`Backend server running on ${PORT}`);
});
