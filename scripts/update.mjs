// Fetches free market data, computes the forecast, writes JSON into /data.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CONFIG, FUELS, rootOf, frontContract, windows, manilaToday, addDays, r2, fuelChange, seriesFor, avgChange, calibrate, forecast, confidence, partialSd, basisOf } from './model.mjs';
import { yahoo, usdphp, opinet } from './market.mjs';
import { recordFromDoe, recordFromNotices, benchmarkChecks } from './doe.mjs';
import { estimatesFromNews, announcementsFromNews, fetchNews, ANNOUNCEMENTS_URL } from './news.mjs';
import { mergeActual, sourceFor, confirmed } from './actuals.mjs';
import { appendRecord, observePublication, publishedTrack, walkForward } from './records.mjs';
import { readUrl } from './http.mjs';

export const PUBLIC_FORECAST_URL = 'https://dn-wsx.github.io/ph-fuel-price-watch/data/forecast.json';

const MODEL_VERSION = 2; // bump when the maths changes: saved back-test rows are rebuilt, live forecasts are kept as history
export async function runUpdate({ dataDir = new URL('../data/', import.meta.url), clock = Date.now, now = clock(), today = manilaToday(now), marketLoaders = { yahoo, usdphp, opinet }, fetchImpl = fetch, pdfText, signal = AbortSignal.timeout(240_000) } = {}) {
  const D = dataDir;
  const timestamp = new Date(now).toISOString();
  const read = async (f, fallback) => {
    try { return JSON.parse(await fs.readFile(new URL(f, D), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  };
  const write = (f, o) => fs.writeFile(new URL(f, D), JSON.stringify(o, null, 2) + '\n');
  const trim = (s, keep = 140) => Object.fromEntries(Object.entries(s).sort().slice(-keep));

  const win = windows(today);
  const market = await read('market.json', { series: {} });
  const errors = [];
  const sources = {
    'RB=F': () => marketLoaders.yahoo('RB=F', now, signal), 'HO=F': () => marketLoaders.yahoo('HO=F', now, signal), 'BZ=F': () => marketLoaders.yahoo('BZ=F', now, signal),
    'USDPHP': () => marketLoaders.usdphp(addDays(today, -190), signal),
  };
  const refreshMarkets = Promise.all(Object.entries(sources).map(async ([key, load]) => {
    try {
      const fresh = await load();
      if (!Object.keys(fresh).length || Object.values(fresh).some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('No usable price observations returned');
      market.series[key] = trim(fresh);
    }
    catch (e) { errors.push(`${key}: ${e.message}`); }
  }));
  // Singapore (Platts) prices, a day behind: Opinet's table, merged into what was saved so a bad fetch keeps the old days.
  try {
    const sg = await marketLoaders.opinet(addDays(today, -150), today, signal);
    const known = new Set(Object.keys(market.series.MOPS92 ?? {}));
    for (const [key, days] of Object.entries(sg)) market.series[key] = trim({ ...market.series[key], ...days }, 110);
    if (known.size) { // when each new Singapore day first shows up on Opinet: between the look before and this look, to time the schedule
      market.opinetSeen = { ...market.opinetSeen };
      for (const d of Object.keys(sg.MOPS92)) if (!known.has(d)) market.opinetSeen[d] = { after: market.opinetChecked ?? null, by: timestamp };
      market.opinetSeen = trim(market.opinetSeen, 40);
    }
    market.opinetChecked = timestamp;
  } catch (e) { errors.push(`Opinet: ${e.message}`); }
  await refreshMarkets;
  if (!market.series['USDPHP'] || !market.series['HO=F']) {
    throw new Error(`Missing required market data and no cache available: ${errors.join('; ')}`);
  }
  // The contract that is front in the current week, so a futures roll between the two weeks can be compared like for like.
  // Expired contracts cannot be fetched again, so what was saved earlier is kept.
  await Promise.all(Object.keys(sources).filter((k) => k.endsWith('=F')).map(async (symbol) => {
    const last = Object.keys(market.series[symbol] ?? {}).sort().at(-1);
    if (!last) return;
    const code = frontContract(rootOf(symbol), last);
    try { market.series[code] = trim({ ...market.series[code], ...(await marketLoaders.yahoo(`${code}.NYM`, now, signal)) }); }
    catch (e) { errors.push(`${code}: ${e.message}`); }
  }));
  for (const key of Object.keys(market.series)) { // drop contracts that have been dead for months
    if (/^[A-Z]{2}[FGHJKMNQUVXZ]\d\d$/.test(key) && (Object.keys(market.series[key]).sort().at(-1) ?? '') < addDays(today, -120)) delete market.series[key];
  }
  if (!errors.some((e) => /^(RB=F|HO=F|BZ=F|USDPHP|Opinet):/.test(e))) market.updatedAt = timestamp;
  await write('market.json', market);
  const S = market.series;

  const log = await read('forecast-log.json', {});
  let publicationNote = '';
  try {
    const publicData = (await readUrl(PUBLIC_FORECAST_URL, { format: 'json', fetchImpl, signal, timeoutMs: 15_000, attempts: 1, cache: 'no-store' })).body;
    if (!observePublication(log, publicData, new Date(clock()).toISOString())) publicationNote = 'The public page has no matching saved forecast to verify yet.';
  } catch (e) { publicationNote = `Public forecast verification unavailable (${e.message}); generated records are not treated as published.`; console.warn(publicationNote); }
  const actuals = await read('actuals.json', {});
  const ytd = await read('ytd.json', {});
  const notices = await read('notices.json', {});
  const newsCache = await read('news.json', { estimates: {} });
  const benchmarks = await read('benchmarks.json', {});
  const actualsProblems = [];

  try {
    const announcements = announcementsFromNews(await fetchNews(fetchImpl, ANNOUNCEMENTS_URL, signal), today, actualsProblems);
    for (const [date, entry] of Object.entries(announcements)) {
      const have = actuals[date] ?? {};
      actuals[date] = mergeActual(have, entry, { kind: 'news', source: entry.source, items: entry.items, provisional: true });
    }
  } catch (e) {
    actualsProblems.push(`News announcements could not be read (${e.message}).`);
    console.warn(actualsProblems.at(-1));
  }

  // 1. Pull actual weekly adjustments from the DOE: company filings first (posted before Tuesday), then the
  //    Oil Monitor (official). Neither ever overwrites values you entered by hand.
  let actualsNote = '';
  const failures = [];
  const doeSignal = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  for (const [name, run] of [
    ['Prior Notice', () => recordFromNotices({ actuals, notices, today, fetchImpl, pdfText, signal: doeSignal })],
    ['Oil Monitor', () => recordFromDoe({ actuals, ytd, benchmarks, today, fetchImpl, pdfText, signal: doeSignal })],
  ]) {
    try {
      const res = await run();
      if (res.added.length) console.log(`${name}: recorded ${res.added.join(', ')}`);
      if (res.problems.length) {
        actualsProblems.push(...res.problems.map((p) => `${name}: ${p}`));
        console.warn(`${name} notes:`, res.problems.join('; '));
      }
    } catch (e) { failures.push(`${name}: ${e.message}`); actualsProblems.push(failures.at(-1)); console.warn(`${name} failed: ${e.message}`); }
  }
  await write('actuals.json', Object.fromEntries(Object.entries(actuals).sort()));
  await write('ytd.json', ytd);
  await write('notices.json', notices);
  await write('benchmarks.json', benchmarks);
  if (failures.length === 2) actualsNote = `Could not read the DOE's price reports (${failures.join('; ')}). Add actuals by hand via Actions > Run workflow if needed.`;

  // 2. Estimates published in the news. They come from the same Singapore prices, so they are shown beside the number as a
  //    cross-check and never change it (on Friday of the 10 Nov 2026 week the model said -12.2 for gasoline, the news -13).
  let newsNote = '';
  try {
    const found = estimatesFromNews(await fetchNews(fetchImpl, undefined, signal));
    newsCache.estimates = Object.fromEntries(Object.entries({ ...newsCache.estimates, ...found }).sort().slice(-4));
    newsCache.updatedAt = timestamp;
  } catch (e) { newsNote = `News headlines could not be read (${e.message}).`; console.warn(newsNote); }
  await write('news.json', newsCache);
  const news = newsCache.estimates[win.target];

  // 3. Calibration pairs: what a source says for a COMPLETE week against the actual, for every week with a known actual.
  //    Each source is fitted on its own history, so the US-futures fallback gets its own (wider) error and scale.
  //    Weeks across a roll whose contract was not saved are skipped rather than trusted.
  const pairsOf = (fuel, source) => Object.entries(actuals)
    .filter(([, a]) => confirmed(a, fuel))
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
    if (Object.keys(row).length) log[date] = { backtest: true, model: MODEL_VERSION, generatedAt: timestamp, ...row };
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
  const snapshots = { ...log[win.target]?.snapshots, [snapshotKey]: { at: timestamp, ...Object.fromEntries(Object.entries(fuels).map(([k, f]) => [k, f.value])) } };
  log[win.target] = { generatedAt: timestamp, model: MODEL_VERSION, ...Object.fromEntries(Object.entries(fuels).map(([k, f]) => [k, { raw: f.raw, value: f.value, low: f.low, high: f.high }])), snapshots, ...(log[win.target]?.records && { records: log[win.target].records }) };
  appendRecord(log, {
    target: win.target, generatedAt: timestamp, model: MODEL_VERSION, basis, fuels,
    sourceDates: Object.fromEntries(Object.entries(S).map(([k, prices]) => [k, Object.keys(prices).filter((d) => d <= today).sort().at(-1) ?? null])),
  }, snapshotKey);
  await write('forecast-log.json', log);

  const history = Object.keys(actuals).sort().reverse().slice(0, 26).map((date) => ({
    date,
    fuels: Object.fromEntries(FUELS.map((k) => [k, { actual: actuals[date][k] ?? null, forecast: log[date]?.[k]?.value ?? null, ...sourceFor(actuals[date], k) }])),
    backtest: log[date]?.backtest === true,
    provisional: actuals[date].provisional === true,
    source: actuals[date].source ?? 'Recorded adjustment',
    sourceUrl: actuals[date].sourceUrl ?? null,
    items: actuals[date].items ?? [],
  }));

  // How far the model alone (scale 1, no published estimate) was from the actual over the weeks that can be rebuilt.
  const accuracy = Object.fromEntries(FUELS.map((fuel) => {
    const errs = pairsFor[fuel].map(([, raw, actual]) => Math.abs(raw - actual));
    return [fuel, { weeks: errs.length, mae: errs.length ? r2(errs.reduce((a, b) => a + b, 0) / errs.length) : null, worst: errs.length ? r2(Math.max(...errs)) : null }];
  }));

  // Latest price as quoted, but the week-on-week change uses the same contract on both sides, so the table matches the model.
  const through = (symbol) => Object.keys(S[symbol] ?? {}).filter((d) => d <= today).sort().at(-1) ?? null;
  const trend = (symbol) => ({ ...avgChange(S[symbol] ?? {}, win), pct: avgChange(seriesFor(symbol, S, win).prices, win).pct, through: through(symbol) });
  await write('forecast.json', {
    sample: false, model: MODEL_VERSION, generatedAt: timestamp, asOf: today, target: win.target, window: { current: win.cur, previous: win.prev },
    confidence: Object.keys(fuels).length && !unresolved ? confidence(minDays, calibratedWeeks, basis) : 'low',
    rollWarning: unresolved, rollAdjusted: rolled && !unresolved, singaporeData: basis === 'singapore', basis, singaporeThrough: Object.keys(S.MOPS92 ?? {}).sort().at(-1) ?? null,
    fuels, history, accuracy, liveTrack: publishedTrack(log, actuals), publicationNote,
    walkForward: Object.fromEntries(FUELS.map((f) => [f, walkForward(pairsFor[f])])),
    errors, actualsNote, actualsProblems, newsNote,
    benchmark: { checkedAt: timestamp, checks: benchmarkChecks(benchmarks, S) },
    publicationTiming: { observations: Object.values(market.opinetSeen ?? {}).filter((s) => s.after && Date.parse(s.by) > Date.parse(s.after)).length, schedule: 'Retained until several weeks of publication observations are available.' },
    news: news ? { updatedAt: newsCache.updatedAt, items: news.items } : null,
    market: {
      mogas: { label: 'Singapore gasoline RON 92 (gasoline)', unit: 'USD/bbl', ...trend('MOPS92') },
      gasoil: { label: 'Singapore gasoil 0.001%S (diesel)', unit: 'USD/bbl', ...trend('MOPSD') },
      jet: { label: 'Singapore kerosene (kerosene)', unit: 'USD/bbl', ...trend('MOPSK') },
      brent: { label: 'Brent crude (context)', unit: 'USD/bbl', ...trend('BZ=F') },
      gasoline: { label: 'US RBOB gasoline futures (fallback only)', unit: 'USD/gal', ...trend('RB=F') },
      diesel: { label: 'US ULSD futures (fallback only)', unit: 'USD/gal', ...trend('HO=F') },
      fx: { label: 'USD/PHP', unit: 'PHP', ...avgChange(S['USDPHP'], win), through: through('USDPHP') },
    },
  });
  console.log(`Forecast for ${win.target} written.`, errors.length ? `Warnings: ${errors.join('; ')}` : '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const deadline = setTimeout(() => { console.error('Updater exceeded five minutes.'); process.exit(1); }, 300_000);
  try { await runUpdate(); } finally { clearTimeout(deadline); }
}
