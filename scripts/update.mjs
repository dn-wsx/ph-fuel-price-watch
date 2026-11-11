// Fetches free market data, computes the forecast, writes JSON into /data.
import fs from 'node:fs/promises';
import { CONFIG, FUELS, rootOf, frontContract, windows, manilaToday, addDays, r2, fuelChange, seriesFor, avgChange, calibrate, forecast, confidence, partialSd, pickEstimates } from './model.mjs';
import { yahoo, usdphp } from './market.mjs';
import { recordFromDoe, recordFromNotices } from './doe.mjs';
import { estimatesFromNews, fetchNews } from './news.mjs';

const MODEL_VERSION = 2; // bump when the maths changes: saved back-test rows are rebuilt, live forecasts are kept as history
const D = new URL('../data/', import.meta.url);
const read = async (f, fallback) => { try { return JSON.parse(await fs.readFile(new URL(f, D), 'utf8')); } catch { return fallback; } };
const write = (f, o) => fs.writeFile(new URL(f, D), JSON.stringify(o, null, 2) + '\n');
const trim = (s, keep = 140) => Object.fromEntries(Object.entries(s).sort().slice(-keep));

const today = manilaToday();
const win = windows(today);
const market = await read('market.json', { series: {} });
const errors = [];
const sources = {
  'RB=F': () => yahoo('RB=F'), 'HO=F': () => yahoo('HO=F'), 'BZ=F': () => yahoo('BZ=F'),
  'USDPHP': () => usdphp(addDays(today, -190)),
};
for (const [key, load] of Object.entries(sources)) {
  try { market.series[key] = trim(await load()); }
  catch (e) { errors.push(`${key}: ${e.message}`); }
}
if (!market.series['USDPHP'] || !market.series['HO=F']) {
  console.error('Missing required market data and no cache available:', errors);
  process.exit(1);
}
// The contract that is front in the current week, so a futures roll between the two weeks can be compared like for like.
// Expired contracts cannot be fetched again, so what was saved earlier is kept.
for (const symbol of Object.keys(sources).filter((k) => k.endsWith('=F'))) {
  const last = Object.keys(market.series[symbol] ?? {}).sort().at(-1);
  if (!last) continue;
  const code = frontContract(rootOf(symbol), last);
  try { market.series[code] = trim({ ...market.series[code], ...(await yahoo(`${code}.NYM`)) }); }
  catch (e) { errors.push(`${code}: ${e.message}`); }
}
for (const key of Object.keys(market.series)) { // drop contracts that have been dead for months
  if (/^[A-Z]{2}[FGHJKMNQUVXZ]\d\d$/.test(key) && (Object.keys(market.series[key]).sort().at(-1) ?? '') < addDays(today, -120)) delete market.series[key];
}
if (!errors.some((e) => /^(RB=F|HO=F|BZ=F|USDPHP):/.test(e))) market.updatedAt = new Date().toISOString();
await write('market.json', market);
const S = market.series;

const log = await read('forecast-log.json', {});
const actuals = await read('actuals.json', {});
const ytd = await read('ytd.json', {});
const notices = await read('notices.json', {});
const industryAll = await read('industry.json', {});
const newsCache = await read('news.json', { estimates: {} });

// 1. Pull actual weekly adjustments from the DOE: company filings first (posted before Tuesday), then the
//    Oil Monitor (official). Neither ever overwrites values you entered by hand.
let actualsNote = '';
const failures = [];
for (const [name, run] of [
  ['Prior Notice', () => recordFromNotices({ actuals, notices, today })],
  ['Oil Monitor', () => recordFromDoe({ actuals, ytd, today })],
]) {
  try {
    const res = await run();
    if (res.added.length) console.log(`${name}: recorded ${res.added.join(', ')}`);
    if (res.problems.length) console.warn(`${name} notes:`, res.problems.join('; '));
  } catch (e) { failures.push(`${name}: ${e.message}`); console.warn(`${name} failed: ${e.message}`); }
}
await write('actuals.json', Object.fromEntries(Object.entries(actuals).sort()));
await write('ytd.json', ytd);
await write('notices.json', notices);
if (failures.length === 2) actualsNote = `Could not read the DOE's price reports (${failures.join('; ')}). Add actuals by hand via Actions > Run workflow if needed.`;

// 2. Published estimates. Hand-entered ones (data/industry.json) win over estimates read from news headlines.
let newsNote = '';
try {
  const found = estimatesFromNews(await fetchNews());
  newsCache.estimates = Object.fromEntries(Object.entries({ ...newsCache.estimates, ...found }).sort().slice(-4));
  newsCache.updatedAt = new Date().toISOString();
} catch (e) { newsNote = `News headlines could not be read (${e.message}).`; console.warn(newsNote); }
await write('news.json', newsCache);
const manual = industryAll[win.target];
const news = newsCache.estimates[win.target];
const estimates = pickEstimates(manual, news);

// 3. Calibration pairs: what the model says for a COMPLETE week against the actual, for every week with a known actual.
//    Weeks across a roll whose contract was not saved are skipped rather than trusted.
const pastWeek = (date, fuel) => {
  const rc = fuelChange(fuel, S, S.USDPHP, windows(addDays(date, -1)));
  return rc && !rc.unresolved && rc.days >= 5 ? rc.raw : null;
};
const pairsFor = Object.fromEntries(FUELS.map((fuel) => [fuel, Object.entries(actuals)
  .filter(([, a]) => typeof a[fuel] === 'number')
  .map(([date, a]) => [date, pastWeek(date, fuel), a[fuel]])
  .filter(([, raw]) => raw != null)]));
// Back-test rows (what the model would have said) are rebuilt every run; forecasts that were made live are kept as history.
for (const date of Object.keys(actuals)) {
  if (log[date] && !log[date].backtest) continue;
  const row = Object.fromEntries(FUELS.flatMap((fuel) => { const hit = pairsFor[fuel].find(([d]) => d === date); return hit ? [[fuel, { raw: r2(hit[1]), value: r2(hit[1]) }]] : []; }));
  if (Object.keys(row).length) log[date] = { backtest: true, model: MODEL_VERSION, generatedAt: new Date().toISOString(), ...row };
  else delete log[date];
}

const fuels = {};
let minDays = 5, calibratedWeeks = 0, rolled = false, unresolved = false;
for (const fuel of FUELS) {
  const rc = fuelChange(fuel, S, S.USDPHP, win);
  if (!rc) { errors.push(`${fuel}: not enough price data for ${win.cur[0]}..${win.cur[1]}`); continue; }
  const cal = calibrate(pairsFor[fuel].map(([, raw, actual]) => [raw, actual]));
  const e = estimates[fuel];
  const weight = e?.kind === 'manual' ? CONFIG.industryWeight : CONFIG.newsWeight;
  fuels[fuel] = {
    ...forecast(rc.raw, cal, e?.range ?? null, CONFIG, { weight, sd: partialSd(rc.dailySd, rc.days) }),
    proxy: CONFIG.proxies[fuel].map(([s, w]) => (CONFIG.proxies[fuel].length > 1 ? `${s} ${w * 100}%` : s)).join(' + '),
    daysOfData: rc.days, calibrationWeeks: cal.n, scale: +cal.scale.toFixed(3),
    ...(e && { estimate: { kind: e.kind, weight } }),
  };
  minDays = Math.min(minDays, rc.days); calibratedWeeks = Math.max(calibratedWeeks, cal.fitted ? cal.n : 0);
  rolled ||= rc.rolled; unresolved ||= rc.unresolved;
}

log[win.target] = { generatedAt: new Date().toISOString(), model: MODEL_VERSION, ...Object.fromEntries(Object.entries(fuels).map(([k, f]) => [k, { raw: f.raw, value: f.value, low: f.low, high: f.high, ...(f.published != null && { published: f.published, publishedBy: f.estimate.kind }) }])) };
await write('forecast-log.json', log);

const history = Object.keys(actuals).sort().reverse().slice(0, 26).map((date) => ({
  date,
  fuels: Object.fromEntries(FUELS.map((k) => [k, { actual: actuals[date][k] ?? null, forecast: log[date]?.[k]?.value ?? null, published: log[date]?.[k]?.published ?? null }])),
  backtest: log[date]?.backtest === true,
}));

// How far the model alone (scale 1, no published estimate) was from the actual over the weeks that can be rebuilt.
const accuracy = Object.fromEntries(FUELS.map((fuel) => {
  const errs = pairsFor[fuel].map(([, raw, actual]) => Math.abs(raw - actual));
  return [fuel, { weeks: errs.length, mae: errs.length ? r2(errs.reduce((a, b) => a + b, 0) / errs.length) : null, worst: errs.length ? r2(Math.max(...errs)) : null }];
}));

// Latest price as quoted, but the week-on-week change uses the same contract on both sides, so the table matches the model.
const trend = (symbol) => ({ ...avgChange(S[symbol] ?? {}, win), pct: avgChange(seriesFor(symbol, S, win).prices, win).pct });
await write('forecast.json', {
  sample: false, model: MODEL_VERSION, generatedAt: new Date().toISOString(), asOf: today, target: win.target, window: { current: win.cur, previous: win.prev },
  confidence: Object.keys(fuels).length && !unresolved ? (FUELS.every((f) => fuels[f]?.estimate) ? 'medium' : confidence(minDays, calibratedWeeks)) : 'low', // a published estimate for every fuel carries the Singapore view
  rollWarning: unresolved, rollAdjusted: rolled && !unresolved,
  fuels, history, accuracy, errors, actualsNote, newsNote,
  industry: manual ? { source: manual.source ?? null, url: manual.url ?? null } : null,
  news: news ? { updatedAt: newsCache.updatedAt, items: news.items } : null,
  market: {
    brent: { label: 'Brent crude (main gasoline proxy)', unit: 'USD/bbl', ...trend('BZ=F') },
    gasoline: { label: 'US RBOB gasoline futures (minor gasoline proxy)', unit: 'USD/gal', ...trend('RB=F') },
    diesel: { label: 'US ULSD futures (diesel and kerosene proxy)', unit: 'USD/gal', ...trend('HO=F') },
    fx: { label: 'USD/PHP', unit: 'PHP', ...avgChange(S['USDPHP'], win) },
  },
});
console.log(`Forecast for ${win.target} written.`, errors.length ? `Warnings: ${errors.join('; ')}` : '');
