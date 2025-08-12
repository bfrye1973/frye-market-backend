// api/routes.js
import express from 'express';

export function buildRouter() {
  const router = express.Router();

  // Health check route the backend can expose
  router.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  // You can add real endpoints here later, e.g.:
  // router.get('/market-metrics', async (req, res) => { ... });

  return router;
}

export default buildRouter;
