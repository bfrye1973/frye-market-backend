import axios from 'axios';
import { CONFIG } from '../config.js';

const api = axios.create({
  baseURL: 'https://api.polygon.io',
  timeout: 20000,
  params: { apiKey: CONFIG.key },
});

export async function aggsDaily(ticker, from, to) {
  const { data } = await api.get(`/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}`, {
    params: { adjusted: true, sort: 'asc', limit: 50000 }
  });
  return data?.results ?? [];
}

export async function aggsIntraday(ticker, from, to, interval='1/minute') {
  const [n, unit] = interval.split('/');
  const { data } = await api.get(`/v2/aggs/ticker/${ticker}/range/${n}/${unit}/${from}/${to}`, {
    params: { adjusted: true, sort: 'asc', limit: 50000 }
  });
  return data?.results ?? [];
}
