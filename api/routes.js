import express from 'express';
import { Store } from '../data/store.js';

export function buildRouter() {
  const r = express.Router();
  r.get('/health', (_,res)=> res.json({ ok:true, time: new Date().toISOString() }));
  r.get('/market-metrics', (_,res)=> res.json(Store.getMetrics() || { sectors:[] }));
  return r;
}
