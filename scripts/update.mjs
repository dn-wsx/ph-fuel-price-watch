// Fetches free market data, computes the forecast, writes JSON into /data.
import fs from 'node:fs/promises';
import { CONFIG, windows, manilaToday, addDays, rawChange, avgChange, calibrate, forecast, confidence } from './model.mjs';

const D = new URL('../data/', import.meta.url);
const read = async (f, fallback) => { try { return JSON.parse(await fs.readFile(new URL(f, D), 'utf8')); } catch { return fallback; } };
const write = (f, o) => fs.writeFile(new URL(f, D), JSON.stringify(o, null, 2) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 ph-fuel-price-watch' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { if (i >= 2) throw e; await sleep(2000 * (i + 1)); }
  }
}

async function yahoo(symbol) { // unofficial endpoint: daily closes, USD per gallon (barrel for BZ=F)
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`);
  const r = j.chart.result[0], off = r.meta.gmtoffset || 0, out = {};
  r.timestamp.forEach((t, i) => {
    const c = r.indicators.quote[0].close[i];
    if (c != null) out[new Date((t + off) * 1000).toISOString().slice(0, 10)] = +c.toFixed(4);
  });
  return out;
}

async function usdphp(start) { // ECB reference rates via Frankfurter (business days)
  const j = await getJson(`https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=PHP`);
  return Object.fromEntries(Object.entries(j.rates).map(([d, v]) => [d, v.PHP]));
}

const trim = (s, keep = 70) => Object.fromEntries(Object.entries(s).sort().slice(-keep));

const today = manilaToday();
const win = windows(today);
const market = await read('market.json', { series: {} });
const errors = [];
const sources = {
  'RB=F': () => yahoo('RB=F'), 'HO=F': () => yahoo('HO=F'), 'BZ=F': () => yahoo('BZ=F'),
  'USDPHP': () => usdphp(addDays(today, -75)),
};
for (const [key, load] of Object.entries(sources)) {
  try { market.series[key] = trim(await load()); }
  catch (e) { errors.push(`${key}: ${e.message}`); }
}
if (!market.series['USDPHP'] || !market.series['RB=F'] || !market.series['HO=F']) {
  console.error('Missing required market data and no cache available:', errors);
  process.exit(1);
}
if (errors.length === 0) market.updatedAt = new Date().toISOString();
await write('market.json', market);

const log = await read('forecast-log.json', {});
const actuals = await read('actuals.json', {});
const industryAll = await read('industry.json', {});
const industry = industryAll[win.target];

const fuels = {};
let minDays = 5, calibratedWeeks = 0;
for (const [fuel, symbol] of Object.entries(CONFIG.proxies)) {
  const rc = rawChange(market.series[symbol], market.series.USDPHP, win);
  if (!rc) { errors.push(`${fuel}: not enough price data for ${win.cur[0]}..${win.cur[1]}`); continue; }
  const pairs = Object.entries(actuals)
    .map(([d, a]) => [log[d]?.[fuel]?.raw, a[fuel]])
    .filter(([r, a]) => typeof r === 'number' && typeof a === 'number');
  const cal = calibrate(pairs);
  fuels[fuel] = { ...forecast(rc.raw, cal, industry?.[fuel]), proxy: symbol, daysOfData: rc.days, calibrationWeeks: cal.n, scale: +cal.scale.toFixed(3) };
  minDays = Math.min(minDays, rc.days); calibratedWeeks = Math.max(calibratedWeeks, cal.fitted ? cal.n : 0);
}

log[win.target] = { generatedAt: new Date().toISOString(), ...Object.fromEntries(Object.entries(fuels).map(([k, f]) => [k, { raw: f.raw, value: f.value, low: f.low, high: f.high }])) };
await write('forecast-log.json', log);

const history = Object.keys(actuals).sort().reverse().slice(0, 26).map((date) => ({
  date,
  fuels: Object.fromEntries(Object.keys(CONFIG.proxies).map((k) => [k, { actual: actuals[date][k] ?? null, forecast: log[date]?.[k]?.value ?? null }])),
}));

const S = market.series;
await write('forecast.json', {
  sample: false, generatedAt: new Date().toISOString(), asOf: today, target: win.target, window: { current: win.cur, previous: win.prev },
  confidence: Object.keys(fuels).length ? confidence(minDays, calibratedWeeks) : 'low',
  fuels, history, errors,
  industry: industry ? { source: industry.source ?? null, url: industry.url ?? null } : null,
  market: {
    gasoline: { label: 'US RBOB gasoline futures (gasoline proxy)', unit: 'USD/gal', ...avgChange(S['RB=F'], win) },
    diesel: { label: 'US ULSD futures (diesel and kerosene proxy)', unit: 'USD/gal', ...avgChange(S['HO=F'], win) },
    brent: { label: 'Brent crude (context only)', unit: 'USD/bbl', ...avgChange(S['BZ=F'] ?? {}, win) },
    fx: { label: 'USD/PHP', unit: 'PHP', ...avgChange(S['USDPHP'], win) },
  },
});
console.log(`Forecast for ${win.target} written.`, errors.length ? `Warnings: ${errors.join('; ')}` : '');
