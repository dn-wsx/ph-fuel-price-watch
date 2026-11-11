// Fetches free market data, computes the forecast, writes JSON into /data.
import fs from 'node:fs/promises';
import { CONFIG, FUELS, rootOf, frontContract, windows, manilaToday, addDays, r2, fuelChange, seriesFor, avgChange, calibrate, forecast, confidence, partialSd, basisOf, liveTrack } from './model.mjs';
import { yahoo, usdphp, opinet } from './market.mjs';
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
// Singapore (Platts) prices, a day behind: Opinet's table, merged into what was saved so a bad fetch keeps the old days.
try {
  const sg = await opinet(addDays(today, -150), today);
  const known = new Set(Object.keys(market.series.MOPS92 ?? {}));
  for (const [key, days] of Object.entries(sg)) market.series[key] = trim({ ...market.series[key], ...days }, 110);
  if (known.size) { // when each new Singapore day first shows up on Opinet: between the look before and this look, to time the schedule
    market.opinetSeen = { ...market.opinetSeen };
    for (const d of Object.keys(sg.MOPS92)) if (!known.has(d)) market.opinetSeen[d] = { after: market.opinetChecked ?? null, by: new Date().toISOString() };
    market.opinetSeen = trim(market.opinetSeen, 40);
  }
  market.opinetChecked = new Date().toISOString();
} catch (e) { errors.push(`Opinet: ${e.message}`); }
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
if (!errors.some((e) => /^(RB=F|HO=F|BZ=F|USDPHP|Opinet):/.test(e))) market.updatedAt = new Date().toISOString();
await write('market.json', market);
const S = market.series;

const log = await read('forecast-log.json', {});
const actuals = await read('actuals.json', {});
const ytd = await read('ytd.json', {});
const notices = await read('notices.json', {});
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

// 2. Estimates published in the news. They come from the same Singapore prices, so they are shown beside the number as a
//    cross-check and never change it (on Friday of the 10 Nov 2026 week the model said -12.2 for gasoline, the news -13).
let newsNote = '';
try {
  const found = estimatesFromNews(await fetchNews());
  newsCache.estimates = Object.fromEntries(Object.entries({ ...newsCache.estimates, ...found }).sort().slice(-4));
  newsCache.updatedAt = new Date().toISOString();
} catch (e) { newsNote = `News headlines could not be read (${e.message}).`; console.warn(newsNote); }
await write('news.json', newsCache);
const news = newsCache.estimates[win.target];

// 3. Calibration pairs: what a source says for a COMPLETE week against the actual, for every week with a known actual.
//    Each source is fitted on its own history, so the US-futures fallback gets its own (wider) error and scale.
//    Weeks across a roll whose contract was not saved are skipped rather than trusted.
const pairsOf = (fuel, source) => Object.entries(actuals)
  .filter(([, a]) => typeof a[fuel] === 'number')
  .map(([date, a]) => {
    const rc = fuelChange(fuel, S, S.USDPHP, windows(addDays(date, -1)), CONFIG, source);
    return [date, rc && !rc.unresolved && rc.unseen === 0 && rc.days >= 4 ? rc.raw : null, a[fuel]]; // a finished week; one market holiday is fine
  })
  .filter(([, raw]) => raw != null);
const pairsFor = Object.fromEntries(FUELS.map((fuel) => [fuel, pairsOf(fuel, 'singapore')]));
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
  const cal = calibrate((rc.source === 'singapore' ? pairsFor[fuel] : pairsOf(fuel, rc.source)).map(([, raw, actual]) => [raw, actual]));
  fuels[fuel] = {
    ...forecast(rc.raw, cal, CONFIG, { sd: partialSd(rc.dailySd, rc.unseen) }),
    source: rc.source, proxy: CONFIG.proxies[fuel][CONFIG.sources.indexOf(rc.source)].map(([s, w], _, all) => (all.length > 1 ? `${s} ${w * 100}%` : s)).join(' + '),
    daysOfData: rc.days, calibrationWeeks: cal.n, scale: +cal.scale.toFixed(3),
    ...(typeof news?.[fuel] === 'number' && { news: news[fuel] }),
  };
  minDays = Math.min(minDays, rc.days); calibratedWeeks = Math.max(calibratedWeeks, cal.fitted ? cal.n : 0);
  rolled ||= rc.rolled; unresolved ||= rc.unresolved;
}

const basis = basisOf(Object.values(fuels).map((f) => f.source), errors.some((e) => e.startsWith('Opinet')));
// One snapshot per number of Singapore days seen ("early" = the US-futures look before the week's first day posts), the latest
// run wins, so the live track record can show how the forecast firmed up through the week.
const snapshotKey = basis === 'singapore' ? String(minDays) : 'early';
const snapshots = { ...log[win.target]?.snapshots, [snapshotKey]: { at: new Date().toISOString(), ...Object.fromEntries(Object.entries(fuels).map(([k, f]) => [k, f.value])) } };
log[win.target] = { generatedAt: new Date().toISOString(), model: MODEL_VERSION, ...Object.fromEntries(Object.entries(fuels).map(([k, f]) => [k, { raw: f.raw, value: f.value, low: f.low, high: f.high }])), snapshots };
await write('forecast-log.json', log);

const history = Object.keys(actuals).sort().reverse().slice(0, 26).map((date) => ({
  date,
  fuels: Object.fromEntries(FUELS.map((k) => [k, { actual: actuals[date][k] ?? null, forecast: log[date]?.[k]?.value ?? null }])),
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
  confidence: Object.keys(fuels).length && !unresolved ? confidence(minDays, calibratedWeeks, basis) : 'low',
  rollWarning: unresolved, rollAdjusted: rolled && !unresolved, singaporeData: basis === 'singapore', basis, singaporeThrough: Object.keys(S.MOPS92 ?? {}).sort().at(-1) ?? null,
  fuels, history, accuracy, liveTrack: liveTrack(log, actuals), errors, actualsNote, newsNote,
  news: news ? { updatedAt: newsCache.updatedAt, items: news.items } : null,
  market: {
    mogas: { label: 'Singapore gasoline RON 92 (gasoline)', unit: 'USD/bbl', ...trend('MOPS92') },
    gasoil: { label: 'Singapore gasoil 0.001%S (diesel)', unit: 'USD/bbl', ...trend('MOPSD') },
    jet: { label: 'Singapore kerosene (kerosene)', unit: 'USD/bbl', ...trend('MOPSK') },
    brent: { label: 'Brent crude (context)', unit: 'USD/bbl', ...trend('BZ=F') },
    gasoline: { label: 'US RBOB gasoline futures (fallback only)', unit: 'USD/gal', ...trend('RB=F') },
    diesel: { label: 'US ULSD futures (fallback only)', unit: 'USD/gal', ...trend('HO=F') },
    fx: { label: 'USD/PHP', unit: 'PHP', ...avgChange(S['USDPHP'], win) },
  },
});
console.log(`Forecast for ${win.target} written.`, errors.length ? `Warnings: ${errors.join('; ')}` : '');
