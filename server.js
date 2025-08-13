// server.js (backend entry)
const express = require('express');
const cors = require('cors');

const app = express();

// Exact frontend origins you use
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://frye-market-frontend.onrender.com'
];

// CORS before routes
app.use(cors({
  origin: (origin, cb) => {
    // allow tools/no-origin (curl/health checks) and allowed web origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  credentials: true,
}));

app.use(express.json());

// Canary endpoint (must never fail)
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

// …your other routes go here…

// Error handler LAST
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
