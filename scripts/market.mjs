// Market data: Yahoo Finance futures (unofficial endpoint) and USD/PHP from Frankfurter (ECB rates).
import { barDate, addDays, isWeekend } from './model.mjs';

const NY = 'America/New_York';
const SETTLE_MINUTES = 14 * 60 + 35; // NYMEX settles at 14:30 ET; give Yahoo five minutes
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

function clock(ms, tz = NY) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}

// The most recent weekday whose NYMEX settlement has already happened.
export function latestSettleDate(now = Date.now()) {
  const { date, minutes } = clock(now);
  let d = !isWeekend(date) && minutes >= SETTLE_MINUTES ? date : addDays(date, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

// Daily closes by trade date. Skips bars with no close and anything not settled yet: during the New York evening
// session Yahoo stamps a live quote with the next trade date and leaves the finished day's close empty.
export function settledBars(result, now = Date.now()) {
  const tz = result.meta.exchangeTimezoneName || NY, close = result.indicators.quote[0].close, cutoff = latestSettleDate(now), out = {};
  result.timestamp.forEach((t, i) => {
    const d = barDate(t, tz);
    if (close[i] != null && d && d <= cutoff) out[d] = +close[i].toFixed(4);
  });
  return out;
}

// Price at the 14:30 ET settlement from five-minute bars (the bar starting 14:25 ends at the settlement).
export function intradayClose(result, date) {
  const tz = result.meta.exchangeTimezoneName || NY, close = result.indicators.quote[0].close;
  let best = null;
  result.timestamp.forEach((t, i) => {
    const c = clock(t * 1000, tz);
    if (c.date === date && c.minutes <= 14 * 60 + 25 && close[i] != null) best = +close[i].toFixed(4);
  });
  return best;
}

const chart = async (symbol, range, interval) => (await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`)).chart.result[0];

export async function yahoo(symbol, now = Date.now()) { // daily closes, USD per gallon (barrel for Brent)
  const bars = settledBars(await chart(symbol, '6mo', '1d'), now), want = latestSettleDate(now);
  if (!bars[want] && Object.keys(bars).sort().at(-1) < want) { // the finished day has no close yet: use the 14:30 ET price
    try { const px = intradayClose(await chart(symbol, '5d', '5m'), want); if (px) bars[want] = px; } catch { /* keep what we have */ }
  }
  return bars;
}

export async function usdphp(start) { // ECB reference rates via Frankfurter (business days); matches the BSP weekly average the DOE quotes to within PHP 0.04
  const j = await getJson(`https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=PHP`);
  return Object.fromEntries(Object.entries(j.rates).map(([d, v]) => [d, v.PHP]));
}
